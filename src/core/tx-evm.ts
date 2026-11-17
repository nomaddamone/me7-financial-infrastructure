import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { isValidEvmAddress, toChecksumAddress } from './evm.ts';

/** An EIP-1559 (type 2) transaction: the format every current EVM chain accepts. */
export interface EvmTransaction {
  chainId: bigint;
  nonce: bigint;
  /** Tip to the block producer, in wei per gas. */
  maxPriorityFeePerGas: bigint;
  /** Most we agree to pay in total, in wei per gas. */
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  /** Amount in wei. */
  value: bigint;
  data?: Uint8Array;
}

/** Gas used by a plain coin transfer to an ordinary address. */
export const EVM_TRANSFER_GAS = 21000n;

type Rlp = Uint8Array | Rlp[];

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Big-endian bytes with no leading zeros; zero is the empty string, as RLP requires. */
function quantity(n: bigint): Uint8Array {
  if (n < 0n) throw new RangeError('Negative quantity');
  if (n === 0n) return new Uint8Array(0);
  const hex = n.toString(16);
  return hexToBytes(hex.length % 2 ? `0${hex}` : hex);
}

function lengthPrefix(length: number, offset: number): Uint8Array {
  if (length < 56) return Uint8Array.of(offset + length);
  const size = quantity(BigInt(length));
  return concat([Uint8Array.of(offset + 55 + size.length), size]);
}

export function rlpEncode(item: Rlp): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && (item[0] ?? 0) < 0x80) return item;
    return concat([lengthPrefix(item.length, 0x80), item]);
  }
  const body = concat(item.map(rlpEncode));
  return concat([lengthPrefix(body.length, 0xc0), body]);
}

function fields(tx: EvmTransaction): Rlp[] {
  if (!isValidEvmAddress(tx.to)) throw new Error('Invalid recipient address');
  if (tx.maxPriorityFeePerGas > tx.maxFeePerGas) throw new Error('Tip is higher than the fee cap');
  return [
    quantity(tx.chainId),
    quantity(tx.nonce),
    quantity(tx.maxPriorityFeePerGas),
    quantity(tx.maxFeePerGas),
    quantity(tx.gasLimit),
    hexToBytes(tx.to.slice(2)),
    quantity(tx.value),
    tx.data ?? new Uint8Array(0),
    [], // access list
  ];
}

/**
 * The bytes that get signed: the type byte 2, then the transaction's fields.
 * A hardware wallet is handed exactly this and shows it on its own screen.
 */
export function evmSigningPayload(tx: EvmTransaction): Uint8Array {
  return concat([Uint8Array.of(2), rlpEncode(fields(tx))]);
}

/**
 * Put a signature made elsewhere (by a hardware wallet) onto the transaction.
 * Returns the raw bytes to broadcast and the transaction hash, both 0x-hex.
 */
export function assembleEvmTransaction(
  tx: EvmTransaction,
  signature: { yParity: number; r: Uint8Array; s: Uint8Array },
): { raw: string; hash: string } {
  if (signature.yParity !== 0 && signature.yParity !== 1) throw new Error('Bad signature parity');
  if (signature.r.length !== 32 || signature.s.length !== 32) throw new Error('Bad signature size');
  const r = BigInt(`0x${bytesToHex(signature.r)}`);
  const s = BigInt(`0x${bytesToHex(signature.s)}`);
  const raw = concat([Uint8Array.of(2), rlpEncode([...fields(tx), quantity(BigInt(signature.yParity)), quantity(r), quantity(s)])]);
  return { raw: `0x${bytesToHex(raw)}`, hash: `0x${bytesToHex(keccak_256(raw))}` };
}

/** The address that made a signature over this transaction. Used to check a hardware wallet signed with the expected key. */
export function recoverEvmSigner(tx: EvmTransaction, signature: { yParity: number; r: Uint8Array; s: Uint8Array }): Uint8Array {
  const digest = keccak_256(evmSigningPayload(tx));
  const compact = concat([Uint8Array.of(signature.yParity), signature.r, signature.s]);
  const publicKey = secp256k1.recoverPublicKey(compact, digest, { prehash: false });
  const point = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return keccak_256(point.subarray(1)).subarray(12);
}

/** Sign a transaction. Returns the raw bytes to broadcast and the transaction hash, both 0x-hex. */
export function signEvmTransaction(tx: EvmTransaction, privateKey: Uint8Array): { raw: string; hash: string } {
  const digest = keccak_256(evmSigningPayload(tx));
  // 'recovered' = recovery id (0 or 1) followed by r and s; prehash is off because we hash with keccak ourselves.
  const sig = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  return assembleEvmTransaction(tx, { yParity: sig[0] ?? 0, r: sig.slice(1, 33), s: sig.slice(33, 65) });
}

/** Read RLP back into its items. Strict: anything a careful encoder would not have written is refused. */
export function rlpDecode(data: Uint8Array): Rlp {
  const read = (at: number): { item: Rlp; end: number } => {
    const first = data[at];
    if (first === undefined) throw new Error('Malformed RLP');
    const length = (from: number, size: number): number => {
      if (size < 1 || size > 4 || from + size > data.length || data[from] === 0) throw new Error('Malformed RLP');
      let n = 0;
      for (let i = 0; i < size; i++) n = n * 256 + (data[from + i] as number);
      if (n < 56) throw new Error('Malformed RLP');
      return n;
    };
    const slice = (from: number, size: number) => {
      if (from + size > data.length) throw new Error('Malformed RLP');
      return data.subarray(from, from + size);
    };
    if (first < 0x80) return { item: data.subarray(at, at + 1), end: at + 1 };
    if (first < 0xb8) {
      const body = slice(at + 1, first - 0x80);
      if (body.length === 1 && (body[0] as number) < 0x80) throw new Error('Malformed RLP');
      return { item: body, end: at + 1 + body.length };
    }
    if (first < 0xc0) {
      const size = first - 0xb7;
      const n = length(at + 1, size);
      return { item: slice(at + 1 + size, n), end: at + 1 + size + n };
    }
    const size = first < 0xf8 ? 0 : first - 0xf7;
    const n = size === 0 ? first - 0xc0 : length(at + 1, size);
    const end = at + 1 + size + n;
    if (end > data.length) throw new Error('Malformed RLP');
    const list: Rlp[] = [];
    for (let next = at + 1 + size; next < end; ) {
      const one = read(next);
      list.push(one.item);
      next = one.end;
      if (next > end) throw new Error('Malformed RLP');
    }
    return { item: list, end };
  };
  const { item, end } = read(0);
  if (end !== data.length) throw new Error('Malformed RLP');
  return item;
}

/**
 * Read a signed transaction (0x-hex, as it is broadcast) back into its parts, with the address
 * that signed it. Only the kind this wallet makes is understood: type 2, no access list.
 * Reading and writing it again gives the same bytes, or it is refused.
 */
export function readSignedEvmTransaction(raw: string): { tx: EvmTransaction; from: string; hash: string } {
  if (!/^0x02([0-9a-fA-F]{2})+$/.test(raw) || raw.length > 2048) throw new Error('Not a transaction of the kind expected');
  const bytes = hexToBytes(raw.slice(2));
  const list = rlpDecode(bytes.subarray(1));
  if (!Array.isArray(list) || list.length !== 12) throw new Error('Not a transaction of the kind expected');
  const part = (i: number): Uint8Array => {
    const item = list[i];
    if (!(item instanceof Uint8Array)) throw new Error('Not a transaction of the kind expected');
    return item;
  };
  const number = (i: number): bigint => {
    const b = part(i);
    if (b.length > 32 || b[0] === 0) throw new Error('Not a transaction of the kind expected');
    return b.length === 0 ? 0n : BigInt(`0x${bytesToHex(b)}`);
  };
  const access = list[8];
  if (!Array.isArray(access) || access.length !== 0 || part(5).length !== 20) throw new Error('Not a transaction of the kind expected');
  const data = part(7);
  const tx: EvmTransaction = {
    chainId: number(0),
    nonce: number(1),
    maxPriorityFeePerGas: number(2),
    maxFeePerGas: number(3),
    gasLimit: number(4),
    to: toChecksumAddress(`0x${bytesToHex(part(5))}`),
    value: number(6),
    ...(data.length > 0 ? { data: Uint8Array.from(data) } : {}),
  };
  const yParity = Number(number(9));
  const pad = (n: bigint) => hexToBytes(n.toString(16).padStart(64, '0'));
  const signature = { yParity, r: pad(number(10)), s: pad(number(11)) };
  const again = assembleEvmTransaction(tx, signature);
  if (again.raw !== raw.toLowerCase()) throw new Error('Not a transaction of the kind expected');
  return { tx, from: toChecksumAddress(`0x${bytesToHex(recoverEvmSigner(tx, signature))}`), hash: again.hash };
}

/**
 * Sign a line of text the way wallets sign messages (EIP-191): the text is prefixed so that it can
 * never be mistaken for a transaction. Returns the signature as 0x-hex: r, s and the recovery byte.
 */
export function signEvmMessage(text: string, privateKey: Uint8Array): string {
  const message = utf8ToBytes(text);
  const digest = keccak_256(concat([utf8ToBytes(`\x19Ethereum Signed Message:\n${message.length}`), message]));
  const sig = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  return `0x${bytesToHex(sig.slice(1, 65))}${(27 + (sig[0] ?? 0)).toString(16)}`;
}

/** Parse a decimal amount like "0.015" into base units without floating point. Null if malformed. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return null;
  const [whole = '', fraction = ''] = clean.split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
