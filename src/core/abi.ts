import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isValidEvmAddress } from './evm.ts';

/**
 * A small encoder for contract calls (the Solidity ABI), enough to call a
 * contract with nested structures. Written here rather than taken from a
 * library so that nothing but our own code builds what the key then signs.
 * The test suite checks every shape against an independent implementation.
 */
export type AbiType =
  | { t: 'uint' | 'int' | 'address' | 'bool' | 'bytes32' | 'bytes' }
  | { t: 'tuple'; of: readonly AbiType[] }
  | { t: 'array'; of: AbiType };

export type AbiValue = bigint | string | boolean | Uint8Array | readonly AbiValue[];

export const uint: AbiType = { t: 'uint' };
export const int: AbiType = { t: 'int' };
export const address: AbiType = { t: 'address' };
export const bool: AbiType = { t: 'bool' };
export const bytes32: AbiType = { t: 'bytes32' };
export const bytes: AbiType = { t: 'bytes' };
export const tuple = (...of: AbiType[]): AbiType => ({ t: 'tuple', of });
export const array = (of: AbiType): AbiType => ({ t: 'array', of });

const WORD = 32;
const MAX_UINT = (1n << 256n) - 1n;
const MIN_INT = -(1n << 255n);
const MAX_INT = (1n << 255n) - 1n;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function word(n: bigint): Uint8Array {
  return hexToBytes(n.toString(16).padStart(64, '0'));
}

function isDynamic(type: AbiType): boolean {
  if (type.t === 'bytes' || type.t === 'array') return true;
  return type.t === 'tuple' && type.of.some(isDynamic);
}

function encodeOne(type: AbiType, value: AbiValue): Uint8Array {
  switch (type.t) {
    case 'uint':
      if (typeof value !== 'bigint' || value < 0n || value > MAX_UINT) throw new RangeError('abi: bad uint');
      return word(value);
    case 'int':
      if (typeof value !== 'bigint' || value < MIN_INT || value > MAX_INT) throw new RangeError('abi: bad int');
      return word(value < 0n ? value + (1n << 256n) : value);
    case 'address':
      if (typeof value !== 'string' || !isValidEvmAddress(value)) throw new Error('abi: bad address');
      return word(BigInt(value));
    case 'bool':
      if (typeof value !== 'boolean') throw new Error('abi: bad bool');
      return word(value ? 1n : 0n);
    case 'bytes32':
      if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('abi: bad bytes32');
      return hexToBytes(value.slice(2));
    case 'bytes': {
      if (!(value instanceof Uint8Array)) throw new Error('abi: bad bytes');
      const padded = new Uint8Array(Math.ceil(value.length / WORD) * WORD);
      padded.set(value);
      return concat([word(BigInt(value.length)), padded]);
    }
    case 'tuple':
      if (!Array.isArray(value)) throw new Error('abi: bad tuple');
      return encodeSequence(type.of, value as readonly AbiValue[]);
    case 'array': {
      if (!Array.isArray(value)) throw new Error('abi: bad array');
      const items = value as readonly AbiValue[];
      return concat([word(BigInt(items.length)), encodeSequence(items.map(() => type.of), items)]);
    }
  }
}

/** Encode values laid out one after another, the way function arguments and structure fields are. */
function encodeSequence(types: readonly AbiType[], values: readonly AbiValue[]): Uint8Array {
  if (types.length !== values.length) throw new Error('abi: wrong number of values');
  const encoded = types.map((type, i) => encodeOne(type, values[i] as AbiValue));
  // Fixed-size values sit in place; variable-size ones leave an offset and go after the fixed part.
  const headSize = types.reduce((n, type, i) => n + (isDynamic(type) ? WORD : (encoded[i] as Uint8Array).length), 0);
  const head: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  let offset = headSize;
  types.forEach((type, i) => {
    const part = encoded[i] as Uint8Array;
    if (isDynamic(type)) {
      head.push(word(BigInt(offset)));
      tail.push(part);
      offset += part.length;
    } else {
      head.push(part);
    }
  });
  return concat([...head, ...tail]);
}

export function abiEncode(types: readonly AbiType[], values: readonly AbiValue[]): Uint8Array {
  return encodeSequence(types, values);
}

/** keccak256 of a text, as 0x-hex. Contracts identify functions, events and names this way. */
export function keccakText(text: string): string {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(text)))}`;
}

/** Call data: the first four bytes of the signature's hash, then the encoded arguments. */
export function encodeCall(signature: string, types: readonly AbiType[], values: readonly AbiValue[]): Uint8Array {
  const selector = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
  return concat([selector, encodeSequence(types, values)]);
}

/** Split a contract's answer into 32-byte words, as 64-character hex strings. */
export function abiWords(hex: string): string[] {
  if (!/^0x([0-9a-fA-F]{64})*$/.test(hex)) throw new Error('Malformed contract response');
  return hex.slice(2).match(/.{64}/g) ?? [];
}

/** The address held in a 32-byte word, lower case. */
export function wordAddress(wordHex: string): string {
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(wordHex)) throw new Error('Malformed contract response');
  return `0x${wordHex.slice(24).toLowerCase()}`;
}

/**
 * Decode values laid out the way `abiEncode` writes them. Used to read a
 * transaction someone else built before signing it, so every offset and length
 * is checked against the data instead of being trusted.
 */
export function abiDecode(types: readonly AbiType[], data: Uint8Array): AbiValue[] {
  return decodeSequence(types, data, 0);
}

function readWord(data: Uint8Array, at: number): bigint {
  if (at < 0 || at + WORD > data.length) throw new Error('abi: data too short');
  return BigInt(`0x${bytesToHex(data.subarray(at, at + WORD))}`);
}

/** A length or offset: must be small enough to index the data. */
function readSize(data: Uint8Array, at: number): number {
  const value = readWord(data, at);
  if (value > BigInt(data.length)) throw new Error('abi: offset out of range');
  return Number(value);
}

function staticSize(type: AbiType): number {
  return type.t === 'tuple' ? type.of.reduce((n, t) => n + staticSize(t), 0) : WORD;
}

function decodeSequence(types: readonly AbiType[], data: Uint8Array, base: number): AbiValue[] {
  const out: AbiValue[] = [];
  let head = base;
  for (const type of types) {
    if (isDynamic(type)) {
      out.push(decodeOne(type, data, base + readSize(data, head)));
      head += WORD;
    } else {
      out.push(decodeOne(type, data, head));
      head += staticSize(type);
    }
  }
  return out;
}

function decodeOne(type: AbiType, data: Uint8Array, at: number): AbiValue {
  switch (type.t) {
    case 'uint':
      return readWord(data, at);
    case 'int': {
      const value = readWord(data, at);
      return value > MAX_INT ? value - (1n << 256n) : value;
    }
    case 'address': {
      const value = readWord(data, at);
      if (value >> 160n !== 0n) throw new Error('abi: bad address');
      return `0x${value.toString(16).padStart(40, '0')}`;
    }
    case 'bool': {
      const value = readWord(data, at);
      if (value > 1n) throw new Error('abi: bad bool');
      return value === 1n;
    }
    case 'bytes32':
      return `0x${readWord(data, at).toString(16).padStart(64, '0')}`;
    case 'bytes': {
      const length = readSize(data, at);
      if (at + WORD + length > data.length) throw new Error('abi: data too short');
      return data.slice(at + WORD, at + WORD + length);
    }
    case 'tuple':
      return decodeSequence(type.of, data, at);
    case 'array': {
      const count = readSize(data, at);
      // Every element takes at least one word, so a count beyond that is a lie about the data.
      if (count * WORD > data.length) throw new Error('abi: array too long');
      return decodeSequence(new Array<AbiType>(count).fill(type.of), data, at + WORD);
    }
  }
}
