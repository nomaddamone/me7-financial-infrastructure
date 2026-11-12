/**
 * The only place in me7 where secret randomness is produced.
 *
 * Trust Wallet's 2022-23 bug was a non-cryptographic PRNG seeded with 32 bits.
 * Here every secret byte comes straight from the platform CSPRNG, and we refuse
 * to continue if it is missing or visibly broken.
 */

export type EntropyBits = 128 | 256;

export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0 || length > 65536) {
    throw new RangeError('secureRandomBytes: length must be an integer in 1..65536');
  }
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure random generator is unavailable in this environment');
  }
  const out = new Uint8Array(length);
  c.getRandomValues(out);
  assertNotDegenerate(out);
  return out;
}

export function generateEntropy(bits: EntropyBits = 256): Uint8Array {
  if (bits !== 128 && bits !== 256) {
    throw new RangeError('generateEntropy: bits must be 128 or 256');
  }
  return secureRandomBytes(bits / 8);
}

/**
 * Cheap sanity check that catches a stubbed or failed generator (all bytes equal).
 * For 16+ random bytes a false alarm has probability below 2^-120.
 */
function assertNotDegenerate(bytes: Uint8Array): void {
  if (bytes.length < 16) return;
  const first = bytes[0];
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i] !== first) return;
  }
  throw new Error('Secure random generator returned degenerate output');
}

/** Overwrite secret bytes once they are no longer needed. */
export function wipe(...buffers: Uint8Array[]): void {
  for (const b of buffers) b.fill(0);
}
