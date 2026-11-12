import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { secureRandomBytes, wipe } from './entropy.ts';
import { deriveKey } from './hd.ts';

/**
 * Keeping a small piece of the wallet's own data (the address book) on me7's
 * server, so that it follows the user to another device, without the server
 * learning anything from it.
 *
 * Everything comes from the seed, on a path used for nothing else:
 *   - a key that encrypts the data (AES-256-GCM); the server stores ciphertext only;
 *   - a signing key; the server keeps the data under the hash of its public
 *     half and accepts a new version only with a signature made by it.
 * So the place the data is kept cannot be linked to any address of the
 * wallet, only the owner can replace it, and what comes back is either exactly
 * what the owner stored or it fails to open: nobody can slip in an address.
 */
const PATH = "m/7377'/0'/0'";
const BLOCK = 1024;

export interface SyncKeys {
  /** Where the data lives on the server: 64 hex characters. */
  id: string;
  enc: Uint8Array;
  auth: Uint8Array;
  /** The public half of the signing key, compressed, as hex. */
  publicKey: string;
}

export function syncKeys(seed: Uint8Array): SyncKeys {
  const root = deriveKey(seed, PATH);
  try {
    const enc = hkdf(sha256, root.privateKey, undefined, utf8ToBytes('me7 sync enc v1'), 32);
    const auth = hkdf(sha256, root.privateKey, undefined, utf8ToBytes('me7 sync auth v1'), 32);
    const publicKey = secp256k1.getPublicKey(auth, true);
    return { id: bytesToHex(sha256(publicKey)), enc, auth, publicKey: bytesToHex(publicKey) };
  } finally {
    wipe(root.privateKey);
  }
}

export function wipeSyncKeys(keys: SyncKeys): void {
  wipe(keys.enc, keys.auth);
}

const copy = (b: Uint8Array) => new Uint8Array(b);
// The version is bound into the encryption, so a blob cannot be passed off under another version's number.
const bound = (id: string, version: number) => utf8ToBytes(`me7 sync ${id} ${version}`);
const cipherKey = (keys: SyncKeys) => crypto.subtle.importKey('raw', copy(keys.enc), 'AES-GCM', false, ['encrypt', 'decrypt']);

/**
 * Encrypt the data for storing as this version. The data is padded to a whole
 * number of kilobytes first, so its size says little about how much is inside.
 */
export async function sealSync(keys: SyncKeys, version: number, plain: Uint8Array): Promise<Uint8Array> {
  const padded = new Uint8Array(Math.ceil((plain.length + 4) / BLOCK) * BLOCK);
  new DataView(padded.buffer).setUint32(0, plain.length);
  padded.set(plain, 4);
  const nonce = secureRandomBytes(12);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: copy(nonce), additionalData: copy(bound(keys.id, version)) }, await cipherKey(keys), padded);
  return concatBytes(nonce, new Uint8Array(sealed));
}

/** Decrypt what the server returned for this version. Throws if it is not exactly what was stored. */
export async function openSync(keys: SyncKeys, version: number, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 12 + 16 + 4) throw new Error('sync: too short');
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy(blob.subarray(0, 12)), additionalData: copy(bound(keys.id, version)) }, await cipherKey(keys), copy(blob.subarray(12))),
  );
  const length = new DataView(plain.buffer).getUint32(0);
  if (length > plain.length - 4) throw new Error('sync: malformed');
  return plain.slice(4, 4 + length);
}

/** What a write is signed over: the place, the version and the exact bytes stored. */
function writeDigest(id: string, version: number, blob: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes(`me7 sync write v1 ${id} ${version} `), sha256(blob)));
}

/** The owner's signature for storing this blob as this version, as hex. */
export function signSync(keys: SyncKeys, version: number, blob: Uint8Array): string {
  return bytesToHex(secp256k1.sign(writeDigest(keys.id, version, blob), keys.auth, { prehash: false }));
}

/** The server's check: the public key is the one this place belongs to, and it signed this very write. */
export function verifySync(id: string, publicKey: string, version: number, blob: Uint8Array, signature: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(id) || !/^0[23][0-9a-f]{64}$/.test(publicKey) || !/^[0-9a-f]{128}$/.test(signature)) return false;
    const key = hexToBytes(publicKey);
    if (bytesToHex(sha256(key)) !== id) return false;
    return secp256k1.verify(hexToBytes(signature), writeDigest(id, version, blob), key, { prehash: false });
  } catch {
    return false;
  }
}
