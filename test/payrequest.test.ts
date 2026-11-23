import { describe, expect, it } from 'vitest';
import { cleanNote, PAY_DESTINATION, PAY_ORIGINS, payAskHash, payQuoteRequest, readPayAskHash, readPayQuote, refundFor, type PayAsk, type PayOrigin } from '../src/core/payrequest.ts';

const TO = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const TRON = 'TMkkPBi7UcHb3SGTpxqTFFKF52e4cm95Vo';
const ETH = '0x2191AAdA5B32A6A76a0D945B4C16b62ef34Ec5F8';
const ask: PayAsk = { to: TO, amount: 25_000_000n, note: 'за дизайн', refundTron: TRON, refundEth: ETH };
const origin = (id: string) => PAY_ORIGINS.find((o) => o.id === id) as PayOrigin;

describe('a request for payment as a link', () => {
  it('goes into a link and comes out the same', () => {
    const hash = payAskHash(ask);
    expect(hash.startsWith('#pay=')).toBe(true);
    expect(hash).toMatch(/^#pay=[A-Za-z0-9_-]+$/);
    expect(readPayAskHash(hash)).toEqual(ask);
    expect(readPayAskHash(payAskHash({ to: TO, amount: 1_000_000n, note: '' }))).toEqual({ to: TO, amount: 1_000_000n, note: '' });
  });

  it('carries the time the request stands until, when it has one', () => {
    const timed = { ...ask, until: 1_800_000_000 };
    expect(readPayAskHash(payAskHash(timed))).toEqual(timed);
    const forged = (x: unknown) => `#pay=${btoa(JSON.stringify({ v: 1, t: TO, a: '25000000', x }))}`.replace(/=+$/, '');
    for (const bad of ['1800000000', 1.5, -1, 99, 5_000_000_000]) expect(readPayAskHash(forged(bad))).toBeNull();
  });

  it('keeps a note to one plain line', () => {
    expect(cleanNote('  two\nlines\u0000 here  ')).toBe('two lines here');
    expect([...cleanNote('я'.repeat(200))]).toHaveLength(80);
    expect(readPayAskHash(payAskHash({ ...ask, note: 'a\r\nb' }))?.note).toBe('a b');
  });

  it('reads nothing out of what is not a well-formed request', () => {
    const forged = (body: unknown) => `#pay=${btoa(JSON.stringify(body)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const good = { v: 1, t: TO, a: '25000000' };
    expect(readPayAskHash(forged(good))?.amount).toBe(25_000_000n);
    for (const bad of [
      { ...good, v: 2 },
      { ...good, t: '0x123' },
      { ...good, t: TO.toLowerCase().replace('9858', '9858').toUpperCase() },
      { ...good, a: '999999' },
      { ...good, a: '1000000000001' },
      { ...good, a: '025000000' },
      { ...good, a: 25000000 },
      { ...good, a: '-5' },
      { ...good, rt: ETH },
      { ...good, re: TRON },
      { ...good, n: 7 },
      [good],
      'text',
    ]) {
      expect(readPayAskHash(forged(bad))).toBeNull();
    }
    expect(readPayAskHash('#trading')).toBeNull();
    expect(readPayAskHash('#pay=')).toBeNull();
    expect(readPayAskHash('#pay=%%%')).toBeNull();
    expect(readPayAskHash(`#pay=${'A'.repeat(1300)}`)).toBeNull();
  });
});

describe('paying a request with another coin', () => {
  const usdt = origin('usdt-eth');
  const said = (o: PayOrigin, refundTo: string, quote: Record<string, unknown> = {}, request: Record<string, unknown> = {}) => ({
    quote: { amountIn: '25169339', minAmountIn: '25043492', amountOut: '25000000', minAmountOut: '25000000', timeEstimate: 49, depositAddress: '0x1234567890123456789012345678901234567890', ...quote },
    quoteRequest: { ...payQuoteRequest(ask, o, refundTo, 1_800_000_000_000, 50, false), ...request },
  });

  it('orders exactly the amount asked, to the address asked', () => {
    expect(payQuoteRequest(ask, usdt, ETH, 1_800_000_000_000, 50, true)).toMatchObject({ dry: true, swapType: 'EXACT_OUTPUT', originAsset: usdt.asset, destinationAsset: PAY_DESTINATION, amount: '25000000', recipient: TO, refundTo: ETH, recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN' });
  });

  it('returns a failed swap to the payer if they named an address, and else to the asker', () => {
    expect(refundFor(ask, usdt, '')).toBe(ETH);
    expect(refundFor(ask, origin('usdt-tron'), '')).toBe(TRON);
    expect(refundFor(ask, usdt, ` ${TO} `)).toBe(TO);
    expect(refundFor(ask, usdt, TRON)).toBeNull();
    expect(refundFor(ask, origin('btc'), '')).toBeNull();
    expect(refundFor({ to: TO, amount: 1_000_000n, note: '' }, usdt, '')).toBeNull();
    expect(refundFor(ask, origin('btc'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  it('reads an answer to its own order', () => {
    expect(readPayQuote(said(usdt, ETH), ask, usdt, ETH, false)).toEqual({ amountIn: 25_169_339n, leastIn: 25_043_492n, deposit: '0x1234567890123456789012345678901234567890', seconds: 49 });
    expect(readPayQuote(said(usdt, ETH, { depositAddress: undefined }), ask, usdt, ETH, true).deposit).toBeNull();
  });

  it('refuses an answer to another order, or one that delivers another amount', () => {
    for (const other of [{ recipient: ETH }, { refundTo: TO }, { amount: '1' }, { originAsset: 'nep141:eth.omft.near' }, { destinationAsset: 'nep141:eth.omft.near' }, { swapType: 'EXACT_INPUT' }]) {
      expect(() => readPayQuote(said(usdt, ETH, {}, other), ask, usdt, ETH, false)).toThrow('another order');
    }
    expect(() => readPayQuote(said(usdt, ETH, { amountOut: '24999999' }), ask, usdt, ETH, false)).toThrow('not the amount');
    expect(() => readPayQuote(said(usdt, ETH, { minAmountOut: '24000000' }), ask, usdt, ETH, false)).toThrow('not the amount');
  });

  it('refuses a price that is not sane', () => {
    // A dollar coin: two percent and two dollars over the amount is the most.
    expect(readPayQuote(said(usdt, ETH, { amountIn: '27500000' }), ask, usdt, ETH, false).amountIn).toBe(27_500_000n);
    expect(() => readPayQuote(said(usdt, ETH, { amountIn: '27500001' }), ask, usdt, ETH, false)).toThrow('too dear');
    // Another coin is held against a price from elsewhere, and refused when there is none.
    const eth = origin('eth');
    const forEth = (amountIn: string) => said(eth, ETH, { amountIn, minAmountIn: undefined });
    expect(readPayQuote(forEth('14617149761200389'), ask, eth, ETH, false, 1720).amountIn).toBe(14_617_149_761_200_389n);
    expect(() => readPayQuote(forEth('14617149761200389'), ask, eth, ETH, false)).toThrow('no price');
    expect(() => readPayQuote(forEth('20000000000000000'), ask, eth, ETH, false, 1720)).toThrow('too dear');
  });

  it('takes an address of the coin’s own network to pay to, and no other', () => {
    const tron = origin('usdt-tron');
    const pay = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
    expect(readPayQuote(said(tron, TRON, { depositAddress: pay }), ask, tron, TRON, false).deposit).toBe(pay);
    expect(() => readPayQuote(said(tron, TRON), ask, tron, TRON, false)).toThrow('no deposit address');
    expect(() => readPayQuote(said(tron, TRON, { depositAddress: TRON }), ask, tron, TRON, false)).toThrow('no deposit address');
    expect(() => readPayQuote(said(usdt, ETH, { depositAddress: pay }), ask, usdt, ETH, false)).toThrow('no deposit address');
    expect(() => readPayQuote(said(usdt, ETH, { depositAddress: TO }), ask, usdt, ETH, false)).toThrow('no deposit address');
    expect(() => readPayQuote(said(usdt, ETH, { depositMemo: '7' }), ask, usdt, ETH, false)).toThrow('no deposit address');
  });
});
