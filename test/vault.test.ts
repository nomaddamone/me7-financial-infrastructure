import { HDNodeWallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import { deriveKey, entropyToPhrase, evmAddressFromPrivateKey, evmPath, mnemonicToSeed } from '../src/core/index.ts';
import { vaultCode, vaultPassphrase } from '../src/core/vault.ts';

const FAST = { kdf: { m: 256, t: 1, p: 1 } };
const account = Uint8Array.from({ length: 32 }, (_, i) => i);
const other = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const address = (entropy: Uint8Array, passphrase: string) =>
  evmAddressFromPrivateKey(deriveKey(mnemonicToSeed(entropyToPhrase(entropy), passphrase), evmPath(0)).privateKey);

describe('vault derivation', () => {
  /**
   * Pinned reference. If this test fails, the derivation changed, and every
   * existing vault would become unreachable. Do not update the expected values;
   * find what changed and undo it.
   */
  it('never changes: production parameters give this exact passphrase and address', async () => {
    const zero = new Uint8Array(32);
    const passphrase = await vaultPassphrase(zero, 'correct horse battery staple');
    expect(passphrase).toBe('4084e2be3e67294ebb6414814fe672b787309ac25333eef22b98a12dc80f4eda');
    expect(address(zero, passphrase)).toBe('0xf117A08450B4F6734cF3411D1F3e98D434D96595');
    // An independent library derives the same address from the same phrase and passphrase,
    // so the vault can be recovered outside me7 with the 24 words and this passphrase.
    expect(HDNodeWallet.fromPhrase(entropyToPhrase(zero), passphrase, "m/44'/60'/0'/0/0").address).toBe(
      '0xf117A08450B4F6734cF3411D1F3e98D434D96595',
    );
  }, 60_000);

  it('is deterministic and reports progress', async () => {
    const seen: number[] = [];
    const a = await vaultPassphrase(account, 'vault-pass', { ...FAST, onProgress: (f) => seen.push(f) });
    const b = await vaultPassphrase(account, 'vault-pass', FAST);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('gives every password its own vault, and no password a rejection', async () => {
    const right = await vaultPassphrase(account, 'vault-pass', FAST);
    const typo = await vaultPassphrase(account, 'vault-pasS', FAST);
    expect(typo).not.toBe(right);
    expect(address(account, typo)).not.toBe(address(account, right));
  });

  it('keeps vaults of different accounts unrelated even with the same password', async () => {
    expect(await vaultPassphrase(account, 'same', FAST)).not.toBe(await vaultPassphrase(other, 'same', FAST));
  });

  it('has different addresses from the pocket', async () => {
    const passphrase = await vaultPassphrase(account, 'vault-pass', FAST);
    expect(address(account, passphrase)).not.toBe(address(account, ''));
  });

  it('treats Unicode-equivalent passwords as the same password', async () => {
    expect(await vaultPassphrase(account, 'café', FAST)).toBe(await vaultPassphrase(account, 'café', FAST));
  });

  it('refuses an empty password and a wrong-sized secret', async () => {
    await expect(vaultPassphrase(account, '', FAST)).rejects.toThrow(/empty/);
    await expect(vaultPassphrase(new Uint8Array(16), 'x', FAST)).rejects.toThrow(RangeError);
  });
});

describe('vault code', () => {
  it('is short, stable and different for different vaults', () => {
    const a = vaultCode(['0xabc', 'bc1q', 'T1']);
    expect(a).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(vaultCode(['0xabc', 'bc1q', 'T1'])).toBe(a);
    expect(vaultCode(['0xabd', 'bc1q', 'T1'])).not.toBe(a);
  });
});
