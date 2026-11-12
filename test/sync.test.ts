import { describe, expect, it } from 'vitest';
import { evmAddressFromPrivateKey } from '../src/core/evm.ts';
import { deriveKey, evmPath } from '../src/core/hd.ts';
import { mnemonicToSeed } from '../src/core/mnemonic.ts';
import { openSync, sealSync, signSync, syncKeys, verifySync } from '../src/core/sync.ts';

const seedOf = (phrase: string) => mnemonicToSeed(phrase, '');
const SEED = seedOf('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const OTHER = seedOf('legal winner thank year wave sausage worth useful legal winner thank yellow');
const text = (s: string) => new TextEncoder().encode(s);

describe('keys for the address book', () => {
  it('come from the seed alone, the same every time, and differ between wallets', () => {
    const a = syncKeys(SEED);
    expect(syncKeys(SEED)).toEqual(a);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(syncKeys(OTHER).id).not.toBe(a.id);
    expect(a.enc).not.toEqual(a.auth);
  });

  it('give a place on the server that says nothing about the wallet’s addresses', () => {
    const { id, publicKey } = syncKeys(SEED);
    const address = evmAddressFromPrivateKey(deriveKey(SEED, evmPath(0)).privateKey).toLowerCase().slice(2);
    expect(id).not.toContain(address.slice(0, 16));
    expect(publicKey).not.toContain(address.slice(0, 16));
  });
});

describe('what is stored', () => {
  it('opens to exactly what was sealed, and only under the same wallet and version', async () => {
    const keys = syncKeys(SEED);
    const blob = await sealSync(keys, 3, text('[{"name":"Аня"}]'));
    expect(new TextDecoder().decode(await openSync(keys, 3, blob))).toBe('[{"name":"Аня"}]');
    await expect(openSync(keys, 4, blob)).rejects.toThrow();
    await expect(openSync(syncKeys(OTHER), 3, blob)).rejects.toThrow();
    const tampered = Uint8Array.from(blob);
    tampered[40] = tampered[40]! ^ 1;
    await expect(openSync(keys, 3, tampered)).rejects.toThrow();
    await expect(openSync(keys, 3, blob.subarray(0, 20))).rejects.toThrow();
  });

  it('shows nothing readable and hides how much is inside', async () => {
    const keys = syncKeys(SEED);
    const one = await sealSync(keys, 1, text(JSON.stringify([{ name: 'Аня', address: '0x2222222222222222222222222222222222222222' }])));
    const ten = await sealSync(keys, 1, text(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ name: `контакт ${i}`, address: `0x${String(i).repeat(40)}` })))));
    expect(one.length).toBe(ten.length);
    expect(one.length).toBe(12 + 1024 + 16);
    expect(new TextDecoder().decode(one)).not.toContain('2222');
    // The same data sealed twice looks different each time.
    expect(await sealSync(keys, 1, text('x'))).not.toEqual(await sealSync(keys, 1, text('x')));
    expect((await sealSync(keys, 1, new Uint8Array(3000))).length).toBe(12 + 3072 + 16);
  });

  it('is signed by the owner for one place, one version and those very bytes', async () => {
    const keys = syncKeys(SEED);
    const blob = await sealSync(keys, 2, text('data'));
    const signature = signSync(keys, 2, blob);
    expect(verifySync(keys.id, keys.publicKey, 2, blob, signature)).toBe(true);
    expect(verifySync(keys.id, keys.publicKey, 3, blob, signature)).toBe(false);
    expect(verifySync(keys.id, keys.publicKey, 2, Uint8Array.from([...blob, 0]), signature)).toBe(false);
    const stranger = syncKeys(OTHER);
    // Someone else's key, even with a valid signature of its own, does not fit this place.
    expect(verifySync(keys.id, stranger.publicKey, 2, blob, signSync(stranger, 2, blob))).toBe(false);
    expect(verifySync(stranger.id, keys.publicKey, 2, blob, signature)).toBe(false);
    expect(verifySync(keys.id, keys.publicKey, 2, blob, 'zz')).toBe(false);
  });
});
