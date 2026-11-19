import { describe, expect, it } from 'vitest';
import {
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
    expect(blob).toHaveLength(76);
    expect(await openSecret(blob, 'correct horse', FAST)).toEqual(secret);
  });

  it('works with the production parameters and reports progress', async () => {
    const secret = generateEntropy(256);
    const seen: number[] = [];
    const blob = await sealSecret(secret, 'пароль-с-юникодом ✓', { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(10);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(await openSecret(blob, 'пароль-с-юникодом ✓')).toEqual(secret);
    // Two 64 MiB Argon2id runs: well under a second each normally, slower on a busy machine.
  }, 60_000);

  it('rejects a wrong password', async () => {
    const blob = await sealSecret(generateEntropy(256), 'right', FAST);
    expect(code(await openSecret(blob, 'wrong', FAST).catch((e: unknown) => e))).toBe('wrong-password');
    expect(code(await openSecret(blob, 'Right', FAST).catch((e: unknown) => e))).toBe('wrong-password');
  });

  it('treats Unicode-equivalent passwords as the same password', async () => {
    const secret = generateEntropy(256);
    const blob = await sealSecret(secret, 'café', FAST);
    expect(await openSecret(blob, 'café', FAST)).toEqual(secret);
  });

  it('never produces the same blob twice', async () => {
    const secret = generateEntropy(256);
    const a = await sealSecret(secret, 'pw', FAST);
    const b = await sealSecret(secret, 'pw', FAST);
    expect(a).not.toEqual(b);
  });

  it('carries no mark of what it is', async () => {
    const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
    for (let i = 0; i < 8; i++) {
      const file = packKeyfile(await sealSecret(generateEntropy(256), 'pw', FAST));
      expect(text(file)).not.toMatch(/ME7|me7|KEY/);
      // No fixed byte anywhere: the same place differs from one key to the next.
      const other = packKeyfile(await sealSecret(generateEntropy(256), 'pw', FAST));
      expect(file.filter((v, at) => v === other[at]).length).toBeLessThan(12);
    }
  });

  it('detects any flipped bit, in the salt, the nonce or the ciphertext', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    for (const at of [0, 15, 16, 27, 28, 60, 75]) {
      const bad = new Uint8Array(blob);
      bad[at]! ^= 1;
      expect(code(await openSecret(bad, 'pw', FAST).catch((e: unknown) => e))).toBe('wrong-password');
    }
  });

  it('does not open with other parameters than it was sealed with', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    expect(code(await openSecret(blob, 'pw', { kdf: { m: 512, t: 1, p: 1 } }).catch((e: unknown) => e))).toBe('wrong-password');
  });

  it('refuses bytes of another length', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
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
    expect(file).toHaveLength(76);
    expect(hasKeyBlob(file)).toBe(true);
    expect(await openSecret(findKeyBlob(file), 'pw', FAST)).toEqual(secret);
  });

  it('hides inside a carrier file without changing the carrier bytes', async () => {
    const secret = generateEntropy(256);
    const file = packKeyfile(await sealSecret(secret, 'pw', FAST), jpeg);
    expect(file).toHaveLength(jpeg.length + 76);
    expect(file.subarray(0, jpeg.length)).toEqual(jpeg);
    expect(await openSecret(findKeyBlob(file), 'pw', FAST)).toEqual(secret);
  });

  it('works on a view into a larger buffer', async () => {
    const secret = generateEntropy(256);
    const file = packKeyfile(await sealSecret(secret, 'pw', FAST), jpeg);
    const padded = new Uint8Array(file.length + 20);
    padded.set(file, 7);
    expect(await openSecret(findKeyBlob(padded.subarray(7, 7 + file.length)), 'pw', FAST)).toEqual(secret);
  });

  it('cannot tell a file without a key from a wrong password', async () => {
    const photo = new Uint8Array(4000).map((_, i) => (i * 37) & 0xff);
    const file = packKeyfile(await sealSecret(generateEntropy(256), 'pw', FAST), photo);
    // A file too short to hold a key is the only one known to hold none.
    expect(hasKeyBlob(jpeg)).toBe(false);
    expect(hasKeyBlob(new Uint8Array(0))).toBe(false);
    expect(() => findKeyBlob(jpeg)).toThrow(KeyfileError);
    // A messenger that recompresses the photo drops what follows the image: the password then fails, as on any other file.
    const stripped = file.subarray(0, photo.length);
    expect(hasKeyBlob(stripped)).toBe(true);
    expect(code(await openSecret(findKeyBlob(stripped), 'pw', FAST).catch((e: unknown) => e))).toBe('wrong-password');
    expect(code(await openSecret(findKeyBlob(file.subarray(0, file.length - 1)), 'pw', FAST).catch((e: unknown) => e))).toBe('wrong-password');
  });

  it('refuses an oversized carrier', async () => {
    const blob = await sealSecret(generateEntropy(256), 'pw', FAST);
    expect(() => packKeyfile(blob, new Uint8Array(MAX_CARRIER_BYTES + 1))).toThrow(/too large/);
    expect(() => packKeyfile(new Uint8Array(90))).toThrow(KeyfileError);
  });
});

describe('a key file of the first format', () => {
  // Made by the wallet before the format lost its marks: a four-byte picture, then the key of bytes 1..32 under 'old password'.
  const old = Uint8Array.from(
    (
      'ffd8ffd94d45374b45590101000001000101766e71a695ec4126921254745868c043e13a955504d99dafc28f73e5cac30f83d5bce267e2de27965f2435fd961aaaf47b0e816476f724a46b5d93300afbffcb861b74efd4a3c543bdba680f0000005a4d45374b4559454e44'.match(
        /../g,
      ) ?? []
    ).map((pair) => parseInt(pair, 16)),
  );
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

  it('still opens', async () => {
    expect(hasKeyBlob(old)).toBe(true);
    const blob = findKeyBlob(old);
    expect(blob).toHaveLength(90);
    expect(await openSecret(blob, 'old password')).toEqual(secret);
    expect(code(await openSecret(blob, 'other').catch((e: unknown) => e))).toBe('wrong-password');
  });

  it('is found under a new key saved over it, and the new one opens', async () => {
    const fresh = generateEntropy(256);
    const file = packKeyfile(await sealSecret(fresh, 'pw', FAST), old);
    expect(await openSecret(findKeyBlob(file), 'pw', FAST)).toEqual(fresh);
  });

  it('refuses parameters that would exhaust memory or time, a newer version and a damaged header', async () => {
    const blob = findKeyBlob(old);
    const huge = new Uint8Array(blob);
    new DataView(huge.buffer).setUint32(8, 0xffffffff);
    expect(code(await openSecret(huge, 'old password').catch((e: unknown) => e))).toBe('unsupported');
    const slow = new Uint8Array(blob);
    slow[12] = 255;
    expect(code(await openSecret(slow, 'old password').catch((e: unknown) => e))).toBe('unsupported');
    const newer = new Uint8Array(blob);
    newer[6] = 2;
    expect(code(await openSecret(newer, 'old password').catch((e: unknown) => e))).toBe('unsupported');
    const bent = new Uint8Array(blob);
    bent[20]! ^= 1;
    expect(code(await openSecret(bent, 'old password').catch((e: unknown) => e))).toBe('wrong-password');
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
