import { bytesToHex } from '@noble/hashes/utils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bitcoinPath,
  createMnemonic,
  deriveKey,
  evmAddressFromPrivateKey,
  evmPath,
  generateEntropy,
  isValidEvmAddress,
  isValidMnemonic,
  mnemonicToSeed,
  p2wpkhAddress,
  secureRandomBytes,
  toChecksumAddress,
} from '../src/core/index.ts';

const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('entropy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the requested number of bytes', () => {
    expect(generateEntropy(128)).toHaveLength(16);
    expect(generateEntropy(256)).toHaveLength(32);
    expect(generateEntropy()).toHaveLength(32);
  });

  it('never repeats across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(bytesToHex(generateEntropy(256)));
    expect(seen.size).toBe(2000);
  });

  it('uses every bit position (catches a 32-bit-seed style failure)', () => {
    const ones = new Array<number>(256).fill(0);
    const rounds = 4000;
    for (let r = 0; r < rounds; r++) {
      const e = generateEntropy(256);
      for (let bit = 0; bit < 256; bit++) {
        if ((e[bit >> 3]! >> (bit & 7)) & 1) ones[bit]!++;
      }
    }
    for (const count of ones) {
      expect(count).toBeGreaterThan(rounds * 0.4);
      expect(count).toBeLessThan(rounds * 0.6);
    }
  });

  it('rejects a generator that returns constant bytes', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((a) => a);
    expect(() => generateEntropy(256)).toThrow(/degenerate/);
  });

  it('rejects bad lengths', () => {
    expect(() => secureRandomBytes(0)).toThrow(RangeError);
    expect(() => secureRandomBytes(1.5)).toThrow(RangeError);
    // @ts-expect-error only 128 and 256 are allowed
    expect(() => generateEntropy(64)).toThrow(RangeError);
  });
});

describe('mnemonic', () => {
  it('creates valid 24- and 12-word phrases', () => {
    const m24 = createMnemonic();
    const m12 = createMnemonic(128);
    expect(m24.split(' ')).toHaveLength(24);
    expect(m12.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(m24)).toBe(true);
    expect(isValidMnemonic(m12)).toBe(true);
    expect(createMnemonic()).not.toBe(m24);
  });

  it('matches the official BIP39 vector (passphrase TREZOR)', () => {
    expect(bytesToHex(mnemonicToSeed(ABANDON, 'TREZOR'))).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    );
  });

  it('accepts messy whitespace and case', () => {
    const messy = `  ${ABANDON.toUpperCase().replaceAll(' ', '  \n')} `;
    expect(isValidMnemonic(messy)).toBe(true);
    expect(mnemonicToSeed(messy)).toEqual(mnemonicToSeed(ABANDON));
  });

  it('rejects a wrong checksum and unknown words', () => {
    expect(isValidMnemonic(ABANDON.replace('about', 'abandon'))).toBe(false);
    expect(isValidMnemonic(ABANDON.replace('about', 'me7'))).toBe(false);
    expect(() => mnemonicToSeed('abandon about')).toThrow(/Invalid recovery phrase/);
  });

  it('gives a different wallet for a different passphrase', () => {
    expect(mnemonicToSeed(ABANDON, 'a')).not.toEqual(mnemonicToSeed(ABANDON, 'b'));
  });
});

describe('bitcoin (BIP84 official vectors)', () => {
  const seed = mnemonicToSeed(ABANDON);
  const addr = (index: number, change = false) =>
    p2wpkhAddress(deriveKey(seed, bitcoinPath('mainnet', index, change)).publicKey, 'mainnet');

  it('derives the first receive addresses', () => {
    expect(addr(0)).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(addr(1)).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  });

  it('derives the first change address', () => {
    expect(addr(0, true)).toBe('bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
  });

  it('exposes the vector private key', () => {
    expect(bytesToHex(deriveKey(seed, "m/84'/0'/0'/0/0").privateKey)).toBe(
      '4604b4b710fe91f584fff084e1a9159fe4f8408fff380596a604948474ce4fa3',
    );
  });

  it('uses the tb prefix and coin type 1 on testnet', () => {
    expect(bitcoinPath('testnet', 3)).toBe("m/84'/1'/0'/0/3");
    const key = deriveKey(seed, bitcoinPath('testnet'));
    expect(p2wpkhAddress(key.publicKey, 'testnet')).toMatch(/^tb1q[02-9ac-hj-np-z]{38}$/);
  });

  it('rejects malformed input', () => {
    expect(() => deriveKey(seed, 'm/84h/0')).toThrow(/malformed path/);
    expect(() => deriveKey(seed.subarray(1), "m/84'/0'/0'/0/0")).toThrow(RangeError);
    expect(() => bitcoinPath('mainnet', -1)).toThrow(RangeError);
    expect(() => p2wpkhAddress(new Uint8Array(65), 'mainnet')).toThrow(/compressed/);
  });
});

describe('evm', () => {
  it('derives the well-known first account', () => {
    const key = deriveKey(mnemonicToSeed(ABANDON), evmPath(0));
    expect(evmAddressFromPrivateKey(key.privateKey)).toBe(
      '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    );
  });

  it('matches the EIP-55 checksum vectors', () => {
    for (const a of [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ]) {
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
      expect(isValidEvmAddress(a)).toBe(true);
    }
  });

  it('rejects a mistyped checksum and malformed addresses', () => {
    expect(isValidEvmAddress('0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
    expect(isValidEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true);
    expect(isValidEvmAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(false);
    expect(isValidEvmAddress('0x123')).toBe(false);
    expect(() => toChecksumAddress('0xzz')).toThrow(/Invalid EVM address/);
  });
});
