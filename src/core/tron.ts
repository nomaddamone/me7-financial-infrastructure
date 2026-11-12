import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createBase58check } from '@scure/base';

/**
 * Tron. Keys are the same secp256k1 keys as Ethereum; the address is the same
 * 20-byte hash with a 0x41 prefix, written in Base58 (it starts with "T").
 *
 * Transactions are built here, byte by byte, rather than asked from a node: a
 * node asked to "create a transaction" could hand back one that pays somebody
 * else. The format is protobuf, and only the two shapes a wallet needs are
 * implemented: a TRX transfer and a call to a token contract. Both are checked
 * in the tests against transactions produced by a real Tron node.
 */

const base58 = createBase58check(sha256);

/** BIP44 path for Tron (coin type 195). */
export function tronPath(addressIndex = 0): string {
  if (!Number.isInteger(addressIndex) || addressIndex < 0 || addressIndex >= 0x80000000) {
    throw new RangeError('addressIndex must be an integer in 0..2^31-1');
  }
  return `m/44'/195'/0'/0/${addressIndex}`;
}

/** The address of an uncompressed public key (65 bytes). */
export function tronAddressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('Expected an uncompressed public key');
  const raw = new Uint8Array(21);
  raw[0] = 0x41;
  raw.set(keccak_256(publicKey.subarray(1)).subarray(12), 1);
  return base58.encode(raw);
}

export function tronAddressFromPrivateKey(privateKey: Uint8Array): string {
  return tronAddressFromPublicKey(secp256k1.getPublicKey(privateKey, false));
}

/** The 21 raw bytes of an address (0x41 + 20). Throws on a typo: the checksum is verified. */
export function decodeTronAddress(address: string): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = base58.decode(address);
  } catch {
    throw new Error('Invalid Tron address');
  }
  if (raw.length !== 21 || raw[0] !== 0x41) throw new Error('Invalid Tron address');
  return raw;
}

export function isValidTronAddress(address: string): boolean {
  try {
    decodeTronAddress(address);
    return true;
  } catch {
    return false;
  }
}

/* --- minimal protobuf writer --- */

function varint(value: bigint): number[] {
  if (value < 0n) throw new RangeError('Negative value');
  const out: number[] = [];
  let n = value;
  while (n >= 0x80n) {
    out.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}
const bytesField = (field: number, bytes: ArrayLike<number>): number[] => [
  ...varint(BigInt((field << 3) | 2)),
  ...varint(BigInt(bytes.length)),
  ...Array.from(bytes),
];
/** proto3 leaves out fields that are zero. */
const intField = (field: number, value: bigint): number[] =>
  value === 0n ? [] : [...varint(BigInt(field << 3)), ...varint(value)];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Where the transaction is anchored in the chain and how long it stays valid. */
export interface TronRef {
  /** Bytes 6..8 of a recent block id. */
  refBlockBytes: Uint8Array;
  /** Bytes 8..16 of the same block id. */
  refBlockHash: Uint8Array;
  /** Unix milliseconds after which the network drops the transaction. */
  expiration: number;
  /** Unix milliseconds when it was made. */
  timestamp: number;
}

/** Anchor a transaction to a recent block; it expires a minute after that block. */
export function tronRef(block: { id: string; timestamp: number }, now: number): TronRef {
  if (!/^[0-9a-f]{64}$/.test(block.id)) throw new Error('Malformed block id');
  const id = hexToBytes(block.id);
  return {
    refBlockBytes: id.slice(6, 8),
    refBlockHash: id.slice(8, 16),
    expiration: block.timestamp + 60_000,
    timestamp: now,
  };
}

function rawData(type: number, name: string, parameter: number[], ref: TronRef, feeLimit = 0n): Uint8Array {
  if (ref.refBlockBytes.length !== 2 || ref.refBlockHash.length !== 8) throw new Error('Malformed block reference');
  const any = [...bytesField(1, ascii(`type.googleapis.com/protocol.${name}`)), ...bytesField(2, parameter)];
  const contract = [...intField(1, BigInt(type)), ...bytesField(2, any)];
  return Uint8Array.from([
    ...bytesField(1, ref.refBlockBytes),
    ...bytesField(4, ref.refBlockHash),
    ...intField(8, BigInt(ref.expiration)),
    ...bytesField(11, contract),
    ...intField(14, BigInt(ref.timestamp)),
    ...intField(18, feeLimit),
  ]);
}

/** Unsigned TRX transfer. Amount is in sun (1 TRX = 1,000,000 sun). */
export function buildTronTransfer(from: string, to: string, amount: bigint, ref: TronRef): Uint8Array {
  if (amount <= 0n) throw new RangeError('Amount must be positive');
  const parameter = [...bytesField(1, decodeTronAddress(from)), ...bytesField(2, decodeTronAddress(to)), ...intField(3, amount)];
  return rawData(1, 'TransferContract', parameter, ref);
}

/** Call data for a TRC-20 transfer(to, amount): the same layout as ERC-20, with the 20-byte address. */
export function trc20TransferData(to: string, amount: bigint): Uint8Array {
  if (amount < 0n || amount >= 1n << 256n) throw new RangeError('Amount out of range');
  const address = bytesToHex(decodeTronAddress(to).subarray(1)).padStart(64, '0');
  return hexToBytes(`a9059cbb${address}${amount.toString(16).padStart(64, '0')}`);
}

/** Argument for balanceOf(owner), as the 64 hex characters a Tron node expects. */
export function trc20BalanceOfParameter(owner: string): string {
  return bytesToHex(decodeTronAddress(owner).subarray(1)).padStart(64, '0');
}

/**
 * Unsigned TRC-20 transfer. feeLimit (in sun) caps what the network may burn
 * for the contract call; the transaction fails rather than cost more.
 */
export function buildTrc20Transfer(
  from: string,
  contract: string,
  to: string,
  amount: bigint,
  ref: TronRef,
  feeLimit: bigint,
): Uint8Array {
  if (amount <= 0n) throw new RangeError('Amount must be positive');
  if (feeLimit <= 0n) throw new RangeError('Fee limit must be positive');
  const parameter = [
    ...bytesField(1, decodeTronAddress(from)),
    ...bytesField(2, decodeTronAddress(contract)),
    ...bytesField(4, trc20TransferData(to, amount)),
  ];
  return rawData(31, 'TriggerSmartContract', parameter, ref, feeLimit);
}

/** A Tron signature is r, s, then one byte telling which of the two possible keys signed (0 or 1; some signers add 27). */
function recoveryId(signature: Uint8Array): number {
  if (signature.length !== 65) throw new Error('Bad signature size');
  const v = signature[64] ?? 0;
  const id = v >= 27 ? v - 27 : v;
  if (id !== 0 && id !== 1) throw new Error('Bad signature parity');
  return id;
}

/**
 * Put a signature made elsewhere (by a hardware wallet) onto unsigned
 * transaction bytes. Returns the id and the complete transaction to broadcast, both hex.
 */
export function assembleTronTransaction(raw: Uint8Array, signature: Uint8Array): { txid: string; signedHex: string } {
  const normal = Uint8Array.from([...signature.subarray(0, 64), recoveryId(signature)]);
  const signed = Uint8Array.from([...bytesField(1, raw), ...bytesField(2, normal)]);
  return { txid: bytesToHex(sha256(raw)), signedHex: bytesToHex(signed) };
}

/** The address that made a signature over these transaction bytes. */
export function recoverTronSigner(raw: Uint8Array, signature: Uint8Array): string {
  const compact = Uint8Array.from([recoveryId(signature), ...signature.subarray(0, 64)]);
  const publicKey = secp256k1.recoverPublicKey(compact, sha256(raw), { prehash: false });
  return tronAddressFromPublicKey(secp256k1.Point.fromBytes(publicKey).toBytes(false));
}

/** Sign unsigned transaction bytes. Returns the id and the complete transaction to broadcast, both hex. */
export function signTronTransaction(raw: Uint8Array, privateKey: Uint8Array): { txid: string; signedHex: string } {
  const sig = secp256k1.sign(sha256(raw), privateKey, { prehash: false, format: 'recovered' });
  // Tron wants r, s, then the recovery id; noble returns the recovery id first.
  return assembleTronTransaction(raw, Uint8Array.from([...sig.subarray(1), sig[0] ?? 0]));
}
