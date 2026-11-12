import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isValidEvmAddress } from './evm.ts';

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

/** Parse a decimal amount like "0.015" into base units without floating point. Null if malformed. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return null;
  const [whole = '', fraction = ''] = clean.split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
