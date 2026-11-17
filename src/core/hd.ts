import { HDKey } from '@scure/bip32';

export interface DerivedKey {
  path: string;
  privateKey: Uint8Array;
  /** Compressed secp256k1 public key, 33 bytes. */
  publicKey: Uint8Array;
}

const PATH_RE = /^m(\/\d+'?)+$/;

/** Derive a secp256k1 key from a BIP39 seed along a BIP32 path. */
export function deriveKey(seed: Uint8Array, path: string): DerivedKey {
  if (seed.length !== 64) {
    throw new RangeError('deriveKey: seed must be 64 bytes');
  }
  if (!PATH_RE.test(path)) {
    throw new Error(`deriveKey: malformed path "${path}"`);
  }
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('deriveKey: derivation produced no key');
  }
  return { path, privateKey: node.privateKey, publicKey: node.publicKey };
}

function index(n: number, name: string): number {
  if (!Number.isInteger(n) || n < 0 || n >= 0x80000000) {
    throw new RangeError(`${name} must be an integer in 0..2^31-1`);
  }
  return n;
}

/** BIP44 path for EVM chains: m/44'/60'/0'/0/index. */
export function evmPath(addressIndex = 0): string {
  return `m/44'/60'/0'/0/${index(addressIndex, 'addressIndex')}`;
}

/**
 * The path of an Ethereum address used once (see src/app/crossing.ts): m/44'/60'/1'/0/index.
 * A branch of its own, so that such an address is never one of the wallet's other addresses:
 * those on the first branch are the same on Ethereum and on Base, and one used here would tie the two.
 */
export function evmOneTimePath(addressIndex = 0): string {
  return `m/44'/60'/1'/0/${index(addressIndex, 'addressIndex')}`;
}

export type BitcoinNetwork = 'mainnet' | 'testnet';

/** BIP84 path (native SegWit): m/84'/coin'/account'/change/index. */
export function bitcoinPath(
  network: BitcoinNetwork,
  addressIndex = 0,
  change = false,
  account = 0,
): string {
  const coin = network === 'mainnet' ? 0 : 1;
  return `m/84'/${coin}'/${index(account, 'account')}'/${change ? 1 : 0}/${index(addressIndex, 'addressIndex')}`;
}
