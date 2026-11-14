import { describe, expect, it } from 'vitest';
import { buildTrc20Transfer, buildTronTransfer, signTronTransaction, tronAddressFromPrivateKey, type TronRef } from '../src/core/tron.ts';
import { readSignedTrc20Transfer, tronGaslessFee } from '../src/core/trongas.ts';

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const KEY = bytes('11'.repeat(32));
const OTHER = bytes('22'.repeat(32));
const ME = tronAddressFromPrivateKey(KEY);
const TO = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const REF: TronRef = { refBlockBytes: bytes('b4f2'), refBlockHash: bytes('201b27e221fcf9f9'), expiration: 1_794_323_424_000, timestamp: 1_794_323_365_000 };
const signed = (amount = 25_000_000n, to = TO, key = KEY, limit = 30_000_000n) => signTronTransaction(buildTrc20Transfer(ME, USDT, to, amount, REF, limit), key);

describe('a signed usdt transfer on Tron, read back', () => {
  it('gives exactly what was signed', () => {
    const tx = signed();
    expect(readSignedTrc20Transfer(tx.signedHex)).toEqual({
      from: ME,
      to: TO,
      contract: USDT,
      amount: 25_000_000n,
      expiration: REF.expiration,
      feeLimit: 30_000_000n,
      txid: tx.txid,
      signedHex: tx.signedHex,
    });
  });

  it('is refused when it was signed by someone else or changed after signing', () => {
    // Signed with another key: the signature is good, but not the sender's.
    const stranger = signTronTransaction(buildTrc20Transfer(ME, USDT, TO, 1n, REF, 30_000_000n), OTHER);
    expect(() => readSignedTrc20Transfer(stranger.signedHex)).toThrow(/sender/);
    // One byte of the amount flipped.
    const hex = signed().signedHex;
    const at = hex.indexOf('17d7840');
    expect(at).toBeGreaterThan(0);
    expect(() => readSignedTrc20Transfer(`${hex.slice(0, at)}27d7840${hex.slice(at + 7)}`)).toThrow();
  });

  it('is refused when it is anything but a plain token transfer', () => {
    // A transfer of TRX itself.
    const trx = signTronTransaction(buildTronTransfer(ME, TO, 5n, REF), KEY);
    expect(() => readSignedTrc20Transfer(trx.signedHex)).toThrow();
    // A token transfer with one more field slipped into the transaction.
    const good = signed().signedHex;
    expect(() => readSignedTrc20Transfer(`${good}1801`)).toThrow();
    for (const bad of ['', 'zz', '00', good.slice(0, -2), good.toUpperCase()]) expect(() => readSignedTrc20Transfer(bad)).toThrow();
  });
});

describe('the fee for usdt without trx', () => {
  it('is what the service spends, in dollars rounded up to a cent, plus its own part', () => {
    // 5.2 TRX at $0.31 is $1.612: rounded up to 1.62, plus one dollar.
    expect(tronGaslessFee(5_200_000n, 310_000n, 1_000_000n)).toBe(2_620_000n);
    expect(tronGaslessFee(0n, 310_000n, 1_000_000n)).toBe(1_000_000n);
    expect(tronGaslessFee(1n, 310_000n, 1_000_000n)).toBe(1_010_000n);
    expect(tronGaslessFee(10_000_000n, 300_000n, 1_000_000n)).toBe(4_000_000n);
  });
});
