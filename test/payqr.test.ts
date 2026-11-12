import decodeQR from 'qr/decode.js';
import encodeQR from 'qr';
import { describe, expect, it } from 'vitest';
import { addressCode, addressPattern, buildPayText, parsePayText } from '../src/core/payqr.ts';

const ME = '0x91e98673268b84b73FD4822F2D55Ea8CBd675ce0';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRON = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

describe('the code that stands for an address', () => {
  it('is eight digits, the same for the same address however it is written', () => {
    expect(addressCode(ME)).toMatch(/^\d{4} \d{4}$/);
    expect(addressCode(ME.toLowerCase())).toBe(addressCode(ME));
    expect(addressCode(TRON)).toMatch(/^\d{4} \d{4}$/);
  });

  it('changes when anything in the address changes, even with the same beginning and end', () => {
    // What a thief makes: the first and last characters match, the middle is theirs.
    const lookalike = `${ME.slice(0, 8)}${'a'.repeat(26)}${ME.slice(-8)}`;
    expect(addressCode(lookalike)).not.toBe(addressCode(ME));
    const codes = new Set(Array.from({ length: 300 }, (_, i) => addressCode(`0x${i.toString(16).padStart(40, '0')}`)));
    expect(codes.size).toBe(300);
  });

  it('comes with a small mirrored picture', () => {
    const pattern = addressPattern(ME);
    expect(pattern).toHaveLength(5);
    for (const row of pattern) expect([row[0], row[1]]).toEqual([row[4], row[3]]);
    expect(addressPattern(ME.toLowerCase())).toEqual(pattern);
    expect(JSON.stringify(addressPattern(USDC))).not.toBe(JSON.stringify(pattern));
  });
});

describe('what a receiving code says', () => {
  it('is the bare address when nothing more is asked for', () => {
    expect(buildPayText({ network: 'evm', address: ME, chainId: 8453n, asset: 'usdc-base' })).toBe(ME);
    expect(buildPayText({ network: 'tron', address: TRON })).toBe(TRON);
  });

  it('puts the recipient first when an amount is asked for, so a reader of addresses pays the right place', () => {
    const text = buildPayText({ network: 'evm', address: ME, chainId: 8453n, asset: 'usdc-base', amount: '12.5' });
    expect(text).toBe(`ethereum:${ME}@8453?me7=usdc-base&amount=12.5`);
    // The token's contract appears nowhere in it.
    expect(text).not.toContain(USDC.slice(2, 12));
    expect(buildPayText({ network: 'btc', address: BTC, amount: '0.01' })).toBe(`bitcoin:${BTC}?amount=0.01`);
    expect(buildPayText({ network: 'tron', address: TRON, asset: 'usdt-tron', amount: '40' })).toBe(`tron:${TRON}?me7=usdt-tron&amount=40`);
    for (const bad of ['-1', '1e5', '1,5', 'abc', '01']) expect(() => buildPayText({ network: 'evm', address: ME, amount: bad })).toThrow();
  });

  it('comes back the same out of a real QR code', () => {
    for (const text of [ME, buildPayText({ network: 'evm', address: ME, chainId: 8453n, asset: 'usdc-base', amount: '12.5' })]) {
      // Encoded with the highest error correction, as the branded code is, and read back by the scanner's own decoder.
      const rows = encodeQR(text, 'raw', { ecc: 'high', border: 4 });
      const scale = 4;
      const side = rows.length * scale;
      const data = new Uint8ClampedArray(side * side * 4).fill(255);
      rows.forEach((row, y) =>
        row.forEach((on, x) => {
          if (!on) return;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) data.fill(0, ((y * scale + dy) * side + x * scale + dx) * 4, ((y * scale + dy) * side + x * scale + dx) * 4 + 3);
        }),
      );
      expect(decodeQR({ width: side, height: side, data })).toBe(text);
    }
  });
});

describe('what a scanned code is taken for', () => {
  it('knows plain addresses of each network', () => {
    expect(parsePayText(` ${ME.toLowerCase()}\n`)).toEqual({ network: 'evm', address: ME });
    expect(parsePayText(TRON)).toEqual({ network: 'tron', address: TRON });
    expect(parsePayText(BTC)).toEqual({ network: 'btc', address: BTC });
  });

  it('reads me7\'s own request: recipient, chain, coin and amount', () => {
    expect(parsePayText(`ethereum:${ME}@8453?me7=usdc-base&amount=12.5`)).toEqual({ network: 'evm', address: ME, chainId: 8453n, asset: 'usdc-base', amount: '12.5' });
    expect(parsePayText(`tron:${TRON}?me7=usdt-tron&amount=40`)).toEqual({ network: 'tron', address: TRON, asset: 'usdt-tron', amount: '40' });
    expect(parsePayText(`bitcoin:${BTC}?amount=0.01&label=x`)).toEqual({ network: 'btc', address: BTC, amount: '0.01' });
    expect(parsePayText(`ethereum:${ME}`)).toEqual({ network: 'evm', address: ME });
  });

  it('reads a standard token link without mistaking the token for the recipient', () => {
    const link = `ethereum:${USDC}@8453/transfer?address=${ME}&uint256=12500000`;
    expect(parsePayText(link)).toEqual({ network: 'evm', address: ME, token: USDC, chainId: 8453n, amount: '12500000', baseUnits: true });
    expect(parsePayText(link)?.address).not.toBe(USDC);
    expect(parsePayText(`ethereum:${ME}@1?value=1000000000000000`)).toEqual({ network: 'evm', address: ME, chainId: 1n, amount: '1000000000000000', baseUnits: true });
    // A token link with no recipient, or a call me7 does not know, is not acted on.
    expect(parsePayText(`ethereum:${USDC}@8453/transfer?uint256=1`)).toBeNull();
    expect(parsePayText(`ethereum:${USDC}@8453/approve?address=${ME}&uint256=1`)).toBeNull();
  });

  it('acts on nothing else', () => {
    for (const bad of [
      '',
      'https://me7.network/send?to=' + ME,
      `http://evil.example/${ME}`,
      'javascript:alert(1)',
      `ethereum:${ME}?amount=-5`,
      `ethereum:${ME}?amount=1e9`,
      `ethereum:${ME}@abc`,
      `ethereum:0x123`,
      `bitcoin:${ME}`,
      `tron:${ME}`,
      ME + ME,
      'hello',
      'x'.repeat(500),
    ]) {
      expect(parsePayText(bad)).toBeNull();
    }
  });
});
