import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KDF,
  entropyToPhrase,
  findKeyBlob,
  generateEntropy,
  hasKeyBlob,
  KeyfileError,
  MAX_CARRIER_BYTES,
  openSecret,
  packKeyfile,
  phraseToEntropy,
  sealSecret,
} from '../src/core/index.ts';

/** Small parameters keep the suite fast; one test below uses the real ones. */
const FAST = { kdf: { m: 256, t: 1, p: 1 } };
const code = (e: unknown) => (e instanceof KeyfileError ? e.code : `not a KeyfileError: ${String(e)}`);

describe('key blob', () => {
  it('round-trips the secret with the right password', async () => {
    const secret = generateEntropy(256);
    const blob = await sealSecret(secret, 'correct horse', FAST);
    expect(blob).toHaveLength(90);
    expect(await openSecret(blob, 'correct horse')).toEqual(secret);
  });

  it('works with the production parameters and reports progress', async () => {
    const secret = generateEntropy(256);
    const seen: number[] = [];
    const blob = await sealSecret(secret, 'пароль-с-юникодом ✓', { onProgress: (f) => seen.push(f) });
    expect(new DataView(blob.buffer).getUint32(8)).toBe(DEFAULT_KDF.m);
    expect(seen.length).toBeGreaterThan(10);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(await openSecret(blob, 'пароль-с-юникодом ✓')).toEqual(secret);
    // Two 64 MiB Argon2id runs: well under a second each normally, slower on a busy machine.
  }, 60_000);

  it('rejects a wrong password', async () => {
    const blob = await sealSecret(generateEntropy(256), 'right', FAST);
    expect(code(await openSecret(blob, 'wrong').catch((e: unknown) => e))).toBe('wrong-password');
    expect(code(await openSecret(blob, 'Right').catch((e: unknown) => e))).toBe('wrong-password');
  });

  it('treats Unicode-equivalent passwords as the same password', async () => {
    const secret = generateEntropy(256);
    const blob = await sealSecret(secret, 'café', FAST);
    expect(await openSecret(blob, 'café')).toEqual(secret);
  });

  it('never produces the same blob twice', async () => {
    const secret = generateEntropy(256);
    const a = await sealSecret(secret, 'pw', FAST);
    const b = await sealSecret(secret, 'pw', FAST);
    expect(a).not.toEqual(b);
  });

  it('detects any flipped bit, in the header or in the ciphertext', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    for (const at of [13, 14, 29, 30, 41, 42, 60, 89]) {
      const bad = new Uint8Array(blob);
      bad[at]! ^= 1;
      const result = code(await openSecret(bad, 'pw').catch((e: unknown) => e));
      expect(['wrong-password', 'unsupported']).toContain(result);
    }
  });

  it('refuses parameters that would exhaust memory or time', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    const huge = new Uint8Array(blob);
    new DataView(huge.buffer).setUint32(8, 0xffffffff);
    expect(code(await openSecret(huge, 'pw').catch((e: unknown) => e))).toBe('unsupported');
    const slow = new Uint8Array(blob);
    slow[12] = 255;
    expect(code(await openSecret(slow, 'pw').catch((e: unknown) => e))).toBe('unsupported');
  });

  it('refuses a newer format version and garbage', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    const newer = new Uint8Array(blob);
    newer[6] = 2;
    expect(code(await openSecret(newer, 'pw').catch((e: unknown) => e))).toBe('unsupported');
    expect(code(await openSecret(new Uint8Array(90), 'pw').catch((e: unknown) => e))).toBe('not-a-keyfile');
    expect(code(await openSecret(blob.subarray(1), 'pw').catch((e: unknown) => e))).toBe('not-a-keyfile');
  });

  it('refuses bad input when sealing', async () => {
    expect(code(await sealSecret(new Uint8Array(16), 'pw', FAST).catch((e: unknown) => e))).toBe('bad-input');
    expect(code(await sealSecret(generateEntropy(256), '', FAST).catch((e: unknown) => e))).toBe('bad-input');
  });
});

describe('key file container', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);

  it('stands alone', async () => {
    const secret = generateEntropy(256);
    const file = packKeyfile(await sealSecret(secret, 'pw', FAST));
    expect(file).toHaveLength(90 + 13);
    expect(hasKeyBlob(file)).toBe(true);
    expect(await openSecret(findKeyBlob(file), 'pw')).toEqual(secret);
  });

  it('hides inside a carrier file without changing the carrier bytes', async () => {
    const secret = generateEntropy(256);
    const file = packKeyfile(await sealSecret(secret, 'pw', FAST), jpeg);
    expect(file.subarray(0, jpeg.length)).toEqual(jpeg);
    expect(await openSecret(findKeyBlob(file), 'pw')).toEqual(secret);
  });

  it('works on a view into a larger buffer', async () => {
    const secret = generateEntropy(256);
    const file = packKeyfile(await sealSecret(secret, 'pw', FAST), jpeg);
    const padded = new Uint8Array(file.length + 20);
    padded.set(file, 7);
    expect(await openSecret(findKeyBlob(padded.subarray(7, 7 + file.length)), 'pw')).toEqual(secret);
  });

  it('finds no key in ordinary files or in a re-encoded copy', async () => {
    const file = packKeyfile(await sealSecret(generateEntropy(256), 'pw', FAST), jpeg);
    expect(hasKeyBlob(jpeg)).toBe(false);
    expect(hasKeyBlob(new Uint8Array(0))).toBe(false);
    // A messenger that recompresses the photo drops everything after the image data.
    expect(hasKeyBlob(file.subarray(0, jpeg.length))).toBe(false);
    // Truncation or a damaged trailer must not be mistaken for a key.
    expect(hasKeyBlob(file.subarray(0, file.length - 1))).toBe(false);
    const bad = new Uint8Array(file);
    new DataView(bad.buffer).setUint32(bad.length - 13, 5000);
    expect(hasKeyBlob(bad)).toBe(false);
    expect(() => findKeyBlob(jpeg)).toThrow(KeyfileError);
  });

  it('refuses an oversized carrier', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    expect(() => packKeyfile(blob, new Uint8Array(MAX_CARRIER_BYTES + 1))).toThrow(/too large/);
  });
});

describe('secret and phrase are the same key', () => {
  it('converts both ways', () => {
    const secret = generateEntropy(256);
    const phrase = entropyToPhrase(secret);
    expect(phrase.split(' ')).toHaveLength(24);
    expect(phraseToEntropy(`  ${phrase.toUpperCase()} `)).toEqual(secret);
  });

  it('matches the BIP39 reference vector', () => {
    expect(entropyToPhrase(new Uint8Array(32))).toBe(`${'abandon '.repeat(23)}art`);
  });

  it('rejects 12-word phrases, bad checksums and wrong sizes', () => {
    expect(() => phraseToEntropy(`${'abandon '.repeat(11)}about`)).toThrow(/24-word/);
    expect(() => phraseToEntropy(`${'abandon '.repeat(23)}abandon`)).toThrow(/Invalid recovery phrase/);
    expect(() => entropyToPhrase(new Uint8Array(16))).toThrow(RangeError);
  });
});
