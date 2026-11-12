import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const encoder = new TextEncoder();

/** EIP-55 mixed-case checksum for a 40-hex-digit address (with or without 0x). */
export function toChecksumAddress(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error('Invalid EVM address');
  }
  const hash = bytesToHex(keccak_256(encoder.encode(hex)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = hex.charAt(i);
    out += parseInt(hash.charAt(i), 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

/** Address of an EVM account from its 32-byte private key. */
export function evmAddressFromPrivateKey(privateKey: Uint8Array): string {
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(uncompressed.subarray(1));
  return toChecksumAddress(bytesToHex(hash.subarray(12)));
}

/**
 * Accepts all-lowercase, all-uppercase, or correctly checksummed addresses.
 * A mixed-case address with a wrong checksum is rejected: it is most likely a typo.
 */
export function isValidEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}
