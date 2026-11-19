import { argon2idAsync } from '@noble/hashes/argon2.js';
import { secureRandomBytes, wipe } from './entropy.ts';

/**
 * The me7 key file: the account's 32-byte master secret, encrypted with a password.
 *
 *   blob    = salt (16) || nonce (12) || AES-256-GCM(secret) (32 + 16 tag)      76 bytes
 *   file    = carrier || blob
 *
 * The carrier is any file of the user's (a photo, a PDF) or nothing at all. Bytes
 * appended after the end of a JPEG, PNG, PDF or MP3 are ignored by viewers, so the
 * carrier still opens normally.
 *
 * Nothing in the blob says what it is: every byte of it is random or looks so, and there
 * is no name, version or length beside it. Whoever finds the file sees that something
 * follows the picture, but cannot tell without the password that it is a me7 key. For the
 * same reason the wallet itself cannot tell before the password is tried: a wrong password
 * and a file with no key in it fail alike. Security does not depend on this: it rests on
 * the random secret and on Argon2id making password guessing expensive. The Argon2id
 * parameters are fixed for this format and bound into the encryption, so a file cannot
 * ask for weaker ones.
 *
 * The first format is still read, never written:
 *
 *   blob    = header (42 bytes) || AES-256-GCM(secret) (32 + 16 tag)
 *   header  = "ME7KEY" | version | kdf id | m (u32 BE, KiB) | t | p | salt (16) | nonce (12)
 *   file    = carrier || blob || blob length (u32 BE) || "ME7KEYEND"
 */

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const MAGIC = ascii('ME7KEY');
const TAIL = ascii('ME7KEYEND');
const VERSION = 1;
const KDF_ARGON2ID = 1;
const HEADER_BYTES = 42;
const SECRET_BYTES = 32;
const OLD_BLOB_BYTES = HEADER_BYTES + SECRET_BYTES + 16;
const TRAILER_BYTES = 4 + TAIL.length;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const BLOB_BYTES = SALT_BYTES + NONCE_BYTES + SECRET_BYTES + 16;

export const MAX_CARRIER_BYTES = 32 * 1024 * 1024;

export interface KdfParams {
  /** Memory in KiB. */
  m: number;
  /** Passes. */
  t: number;
  /** Lanes. */
  p: number;
}
/** 64 MiB, 3 passes: under a second on a laptop, a few seconds on a phone. */
export const DEFAULT_KDF: KdfParams = { m: 65536, t: 3, p: 1 };

export type KeyfileErrorCode = 'not-a-keyfile' | 'unsupported' | 'wrong-password' | 'too-large' | 'bad-input';
export class KeyfileError extends Error {
  readonly code: KeyfileErrorCode;
  constructor(code: KeyfileErrorCode, message: string) {
    super(message);
    this.name = 'KeyfileError';
    this.code = code;
  }
}

export interface KdfOptions {
  /** For tests only: the format has one set of parameters, and a key sealed with others opens only when they are named again. */
  kdf?: KdfParams;
  /** Called with a fraction 0..1 while the password is being stretched. */
  onProgress?: (fraction: number) => void;
}

/** Same password typed with different Unicode forms must give the same key. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

const copy = (bytes: Uint8Array) => new Uint8Array(bytes);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

async function deriveKey(password: string, salt: Uint8Array, kdf: KdfParams, onProgress?: (f: number) => void) {
  const pw = new TextEncoder().encode(normalizePassword(password));
  let raw: Uint8Array | undefined;
  try {
    raw = await argon2idAsync(pw, salt, { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32, onProgress });
    return await crypto.subtle.importKey('raw', copy(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    wipe(pw);
    if (raw) wipe(raw);
  }
}

/** What the encryption is bound to besides the key: the format and the parameters the password was stretched with. */
const bound = (kdf: KdfParams) => ascii(`me7 key 2 argon2id ${kdf.m} ${kdf.t} ${kdf.p}`);

/** Encrypt the master secret with a password. Returns the key blob. */
export async function sealSecret(secret: Uint8Array, password: string, opts: KdfOptions = {}): Promise<Uint8Array> {
  if (secret.length !== SECRET_BYTES) throw new KeyfileError('bad-input', 'Secret must be 32 bytes');
  if (password.length === 0) throw new KeyfileError('bad-input', 'Password must not be empty');
  const kdf = opts.kdf ?? DEFAULT_KDF;
  const salt = secureRandomBytes(SALT_BYTES);
  const nonce = secureRandomBytes(NONCE_BYTES);
  const key = await deriveKey(password, salt, kdf, opts.onProgress);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: copy(nonce), additionalData: bound(kdf) }, key, copy(secret));
  const blob = new Uint8Array(BLOB_BYTES);
  blob.set(salt, 0);
  blob.set(nonce, SALT_BYTES);
  blob.set(new Uint8Array(sealed), SALT_BYTES + NONCE_BYTES);
  return blob;
}

/** Decrypt a key blob. Throws KeyfileError('wrong-password') if the password or the data is wrong. */
export async function openSecret(blob: Uint8Array, password: string, opts: KdfOptions = {}): Promise<Uint8Array> {
  if (blob.length === BLOB_BYTES) {
    const kdf = opts.kdf ?? DEFAULT_KDF;
    const key = await deriveKey(password, blob.subarray(0, SALT_BYTES), kdf, opts.onProgress);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy(blob.subarray(SALT_BYTES, SALT_BYTES + NONCE_BYTES)), additionalData: bound(kdf) }, key, copy(blob.subarray(SALT_BYTES + NONCE_BYTES)));
      return new Uint8Array(plain);
    } catch {
      // Without the password a key cannot be told from the tail of any other file, so this is one answer for both.
      throw new KeyfileError('wrong-password', 'Wrong password, or no key in this file');
    }
  }
  // The first format: it names itself.
  if (blob.length !== OLD_BLOB_BYTES || !equal(blob.subarray(0, MAGIC.length), MAGIC)) {
    throw new KeyfileError('not-a-keyfile', 'Not a me7 key');
  }
  const header = copy(blob.subarray(0, HEADER_BYTES));
  const view = new DataView(header.buffer);
  const kdf: KdfParams = { m: view.getUint32(8), t: header[12] ?? 0, p: header[13] ?? 0 };
  if (header[6] !== VERSION || header[7] !== KDF_ARGON2ID) {
    throw new KeyfileError('unsupported', 'This key file was made by a newer version');
  }
  // A crafted file must not be able to make the app allocate gigabytes or spin for hours.
  if (kdf.m < 8 || kdf.m > 1024 * 1024 || kdf.t < 1 || kdf.t > 16 || kdf.p < 1 || kdf.p > 4) {
    throw new KeyfileError('unsupported', 'Unsupported key file parameters');
  }
  const key = await deriveKey(password, header.subarray(14, 30), kdf, opts.onProgress);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: header.subarray(30, 42), additionalData: header },
      key,
      copy(blob.subarray(HEADER_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    throw new KeyfileError('wrong-password', 'Wrong password or damaged key file');
  }
}

/** Build the file to save: the blob on its own, or appended to a carrier file. */
export function packKeyfile(blob: Uint8Array, carrier: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (blob.length !== BLOB_BYTES) throw new KeyfileError('bad-input', 'Malformed key blob');
  if (carrier.length > MAX_CARRIER_BYTES) throw new KeyfileError('too-large', 'Carrier file is too large');
  const out = new Uint8Array(carrier.length + BLOB_BYTES);
  out.set(carrier, 0);
  out.set(blob, carrier.length);
  return out;
}

/** A key of the first format at the end of a file, which is marked as one; null if there is none. */
function findOldBlob(file: Uint8Array): Uint8Array | null {
  if (file.length < OLD_BLOB_BYTES + TRAILER_BYTES) return null;
  const tailAt = file.length - TAIL.length;
  if (!equal(file.subarray(tailAt), TAIL)) return null;
  const length = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(tailAt - 4);
  const start = tailAt - 4 - length;
  if (length !== OLD_BLOB_BYTES || start < 0) return null;
  const blob = file.subarray(start, start + length);
  return equal(blob.subarray(0, MAGIC.length), MAGIC) ? copy(blob) : null;
}

/**
 * The bytes at the end of a file that are the key, if the file holds one: a marked key of the first
 * format, or else simply the last bytes, which only the password can tell from anything else.
 * Throws KeyfileError('not-a-keyfile') for a file too short to hold a key.
 */
export function findKeyBlob(file: Uint8Array): Uint8Array {
  const old = findOldBlob(file);
  if (old) return old;
  if (file.length < BLOB_BYTES) throw new KeyfileError('not-a-keyfile', 'No me7 key in this file');
  return copy(file.subarray(file.length - BLOB_BYTES));
}

/** Whether a file could hold a key. Any file long enough could: only the password answers for certain. */
export function hasKeyBlob(file: Uint8Array): boolean {
  try {
    findKeyBlob(file);
    return true;
  } catch {
    return false;
  }
}
