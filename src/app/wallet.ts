import {
  bitcoinPath,
  deriveKey,
  evmAddressFromPrivateKey,
  evmPath,
  mnemonicToSeed,
  p2wpkhAddress,
  secureRandomBytes,
  tronAddressFromPrivateKey,
  tronPath,
  wipe,
} from '../core/index.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { normalizePassword } from '../core/keyfile.ts';
import { NET } from '../net/endpoints.ts';

/**
 * A signed-in session. The seed stays in memory (never in storage) so the pocket
 * can sign transfers; it is wiped when the user signs out or closes the tab.
 */
export interface Wallet {
  evm: string;
  btc: string;
  tron: string;
  seed: Uint8Array;
}

export function openWallet(mnemonic: string, passphrase = ''): Wallet {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  const evmKey = deriveKey(seed, evmPath(0));
  const btcKey = deriveKey(seed, bitcoinPath(NET.btc.network, 0));
  const tronKey = deriveKey(seed, tronPath(0));
  try {
    return {
      evm: evmAddressFromPrivateKey(evmKey.privateKey),
      btc: p2wpkhAddress(btcKey.publicKey, NET.btc.network),
      tron: tronAddressFromPrivateKey(tronKey.privateKey),
      seed,
    };
  } finally {
    wipe(evmKey.privateKey, btcKey.privateKey, tronKey.privateKey);
  }
}

export function closeWallet(wallet: Wallet): void {
  wipe(wallet.seed);
}

/** Run `use` with the account's EVM private key, then wipe the key. */
export async function withEvmKey<T>(wallet: Wallet, use: (privateKey: Uint8Array) => T | Promise<T>): Promise<T> {
  const key = deriveKey(wallet.seed, evmPath(0));
  try {
    return await use(key.privateKey);
  } finally {
    wipe(key.privateKey);
  }
}

/** Run `use` with the account's Bitcoin private key, then wipe the key. */
export async function withBitcoinKey<T>(wallet: Wallet, use: (privateKey: Uint8Array) => T | Promise<T>): Promise<T> {
  const key = deriveKey(wallet.seed, bitcoinPath(NET.btc.network, 0));
  try {
    return await use(key.privateKey);
  } finally {
    wipe(key.privateKey);
  }
}

/** Run `use` with the account's Tron private key (or that of its Tron address number `index`), then wipe the key. */
export async function withTronKey<T>(wallet: Wallet, use: (privateKey: Uint8Array) => T | Promise<T>, index = 0): Promise<T> {
  const key = deriveKey(wallet.seed, tronPath(index));
  try {
    return await use(key.privateKey);
  } finally {
    wipe(key.privateKey);
  }
}

export interface SelfTest {
  rng: boolean;
  core: boolean;
}

const VECTOR_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * Runs in the user's actual browser on every start: the random generator must
 * work, and the crypto core must reproduce published reference addresses. A
 * tampered or broken build fails here before it can create an account.
 */
export function selfTest(): SelfTest {
  let rng = false;
  let core = false;
  try {
    const a = secureRandomBytes(32);
    const b = secureRandomBytes(32);
    rng = a.some((byte, i) => byte !== b[i]);
  } catch {
    rng = false;
  }
  try {
    const w = openWallet(VECTOR_PHRASE);
    const main = p2wpkhAddress(deriveKey(w.seed, bitcoinPath('mainnet', 0)).publicKey, 'mainnet');
    closeWallet(w);
    core =
      w.evm === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94' &&
      w.tron === 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' &&
      main === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
  } catch {
    core = false;
  }
  return { rng, core };
}

/** Distinct random positions in 0..count-1, sorted. */
export function pickPositions(count: number, howMany: number): number[] {
  const picked = new Set<number>();
  while (picked.size < howMany) {
    const [byte] = secureRandomBytes(1);
    // Rejection sampling keeps the choice unbiased.
    if (byte !== undefined && byte < 256 - (256 % count)) picked.add(byte % count);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * Sending money asks for the account password again. Nothing about the password
 * is stored on the device: while the session lasts, a salted hash of it is held
 * in memory next to the keys, only to tell a right password from a wrong one,
 * and it is dropped at sign-out. The keys sit in the same memory, so the hash
 * gives nothing to someone who can already read it.
 */
let sessionCheck: { salt: Uint8Array; hash: Uint8Array } | null = null;

function passwordHash(salt: Uint8Array, password: string): Uint8Array {
  const text = new TextEncoder().encode(normalizePassword(password));
  const material = new Uint8Array(salt.length + text.length);
  material.set(salt, 0);
  material.set(text, salt.length);
  try {
    return sha256(material);
  } finally {
    wipe(text, material);
  }
}

/** Called at sign-in with the password that just opened the key file. */
export function rememberPassword(password: string): void {
  const salt = secureRandomBytes(16);
  sessionCheck = { salt, hash: passwordHash(salt, password) };
}

/** Whether this is the password the session was opened with. False when nothing was remembered. */
export function isSessionPassword(password: string): boolean {
  if (!sessionCheck || password.length === 0) return false;
  const got = passwordHash(sessionCheck.salt, password);
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= (got[i] ?? 0) ^ (sessionCheck.hash[i] ?? 0);
  wipe(got);
  return diff === 0;
}

export function forgetPassword(): void {
  if (sessionCheck) wipe(sessionCheck.salt, sessionCheck.hash);
  sessionCheck = null;
}
