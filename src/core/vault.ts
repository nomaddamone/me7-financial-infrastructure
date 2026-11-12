import { argon2idAsync } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { wipe } from './entropy.ts';
import { DEFAULT_KDF, normalizePassword, type KdfParams } from './keyfile.ts';

/**
 * The vault: a second set of keys under the same account, reachable only with
 * an extra password that is stored nowhere (not in the key file, not in the 24
 * words, not on the device).
 *
 * It is a BIP39 "passphrase wallet": the vault's seed is the account's phrase
 * plus a passphrase. The passphrase is not the password itself but the password
 * stretched with Argon2id, so someone who has stolen the key file and the
 * account password still pays a real price for every vault password they try.
 * (Plain BIP39 stretching is thousands of times cheaper to brute-force.)
 *
 * Every password yields a valid vault. A wrong password is not rejected; it
 * opens a different, empty vault. That is what makes a decoy vault possible,
 * and it is why the app shows a vault code to guard against typos.
 *
 * THE DERIVATION BELOW MUST NEVER CHANGE. Changing the label, the salt, the
 * parameters or the encoding would send every existing vault's funds to keys
 * nobody can derive any more. The test suite pins a reference value.
 */
const LABEL = 'me7 vault v1';

export interface VaultOptions {
  /** Only for tests. Real vaults always use the default parameters. */
  kdf?: KdfParams;
  onProgress?: (fraction: number) => void;
}

/** The BIP39 passphrase of the vault for this account secret and vault password. */
export async function vaultPassphrase(entropy: Uint8Array, password: string, opts: VaultOptions = {}): Promise<string> {
  if (entropy.length !== 32) throw new RangeError('vaultPassphrase: expected the 32-byte account secret');
  if (password.length === 0) throw new Error('Vault password must not be empty');
  const kdf = opts.kdf ?? DEFAULT_KDF;
  const label = new TextEncoder().encode(LABEL);
  const material = new Uint8Array(label.length + entropy.length);
  material.set(label, 0);
  material.set(entropy, label.length);
  // The salt is derived from the account, so nothing has to be stored, and two accounts
  // with the same vault password still get unrelated vaults.
  const salt = sha256(material).subarray(0, 16);
  const pw = new TextEncoder().encode(normalizePassword(password));
  try {
    const key = await argon2idAsync(pw, salt, { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32, onProgress: opts.onProgress });
    const hex = bytesToHex(key);
    wipe(key);
    return hex;
  } finally {
    wipe(pw, material);
  }
}

/** A short code that identifies a vault, so its owner can tell their vault from a typo's. */
export function vaultCode(addresses: readonly string[]): string {
  const hex = bytesToHex(sha256(new TextEncoder().encode(addresses.join('|')))).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
