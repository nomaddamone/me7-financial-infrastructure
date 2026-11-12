import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';
import type { BitcoinNetwork } from './hd.ts';

const HRP: Record<BitcoinNetwork, string> = { mainnet: 'bc', testnet: 'tb' };

/** Native SegWit (P2WPKH, bc1q…) address from a compressed public key. */
export function p2wpkhAddress(publicKey: Uint8Array, network: BitcoinNetwork): string {
  if (publicKey.length !== 33 || (publicKey[0] !== 2 && publicKey[0] !== 3)) {
    throw new Error('p2wpkhAddress: expected a 33-byte compressed public key');
  }
  const program = ripemd160(sha256(publicKey));
  const words = [0, ...bech32.toWords(program)];
  return bech32.encode(HRP[network], words);
}
