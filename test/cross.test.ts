import { describe, expect, it } from 'vitest';
import { crossBudget, crossMaxIn, crossQuoteRequest, readCrossQuote, readCrossStatus, type CrossOrder } from '../src/core/cross.ts';

const LIMITS = { maxOverBps: 200n, maxOverFlat: 2_000_000n };
const ORDER: CrossOrder = {
  origin: 'nep141:base-usdc',
  destination: 'nep141:tron-usdt',
  recipient: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
  refundTo: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  amountOut: 103_000_000n,
  slippageBps: 50,
  deadline: 1_800_000_000_000,
};
const DEPOSIT = '0x1111111111111111111111111111111111111111';
/** What the service answers to ORDER when all is well. */
const answer = (quote: Record<string, unknown> = {}, request: Record<string, unknown> = {}) => ({
  quote: { amountIn: '104400000', amountOut: '103000000', minAmountOut: '103000000', timeEstimate: 90, depositAddress: DEPOSIT, ...quote },
  quoteRequest: { ...crossQuoteRequest(ORDER, false), ...request },
});

describe('paying USDT on Tron out of USDC on Base', () => {
  it('orders an exact amount onto the wallet\'s own address, with the refund to the wallet too', () => {
    expect(crossQuoteRequest(ORDER, true)).toEqual({
      dry: true,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 50,
      originAsset: 'nep141:base-usdc',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: 'nep141:tron-usdt',
      amount: '103000000',
      refundTo: ORDER.refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient: ORDER.recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2027-01-15T08:00:00.000Z',
    });
  });

  it('reads an answer to its own order', () => {
    expect(readCrossQuote(answer(), ORDER, false, LIMITS)).toEqual({ amountIn: 104_400_000n, depositAddress: DEPOSIT, seconds: 90 });
    // A look at the price needs no address.
    expect(readCrossQuote(answer({ depositAddress: undefined }), ORDER, true, LIMITS)).toEqual({ amountIn: 104_400_000n, depositAddress: null, seconds: 90 });
  });

  it('refuses an answer to another order: another recipient, refund address, coin or amount', () => {
    const bad = (request: Record<string, unknown>) => () => readCrossQuote(answer({}, request), ORDER, false, LIMITS);
    expect(bad({ recipient: 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs' })).toThrow();
    expect(bad({ refundTo: DEPOSIT })).toThrow();
    expect(bad({ destinationAsset: 'nep141:tron-other' })).toThrow();
    expect(bad({ originAsset: 'nep141:base-other' })).toThrow();
    expect(bad({ amount: '1' })).toThrow();
    expect(bad({ swapType: 'EXACT_INPUT' })).toThrow();
    expect(bad({ recipientType: 'INTENTS' })).toThrow();
    expect(() => readCrossQuote({}, ORDER, false, LIMITS)).toThrow();
    expect(() => readCrossQuote(null, ORDER, false, LIMITS)).toThrow();
  });

  it('refuses a quote that delivers less than ordered, costs too much, or names no proper address', () => {
    const bad = (quote: Record<string, unknown>) => () => readCrossQuote(answer(quote), ORDER, false, LIMITS);
    expect(bad({ amountOut: '102999999' })).toThrow();
    expect(bad({ minAmountOut: '102000000' })).toThrow();
    // Two percent and two dollars over the delivery is the most that is believed.
    expect(crossMaxIn(103_000_000n, LIMITS)).toBe(107_060_000n);
    expect(readCrossQuote(answer({ amountIn: '107060000' }), ORDER, false, LIMITS).amountIn).toBe(107_060_000n);
    expect(bad({ amountIn: '107060001' })).toThrow();
    expect(bad({ amountIn: '0' })).toThrow();
    expect(bad({ amountIn: 104400000 })).toThrow();
    expect(bad({ depositAddress: undefined })).toThrow();
    expect(bad({ depositAddress: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' })).toThrow();
    expect(bad({ depositAddress: ORDER.refundTo.toLowerCase() })).toThrow();
    expect(bad({ depositMemo: '42' })).toThrow();
    // A missing or silly time estimate is not a reason to refuse.
    expect(readCrossQuote(answer({ timeEstimate: -1 }), ORDER, false, LIMITS).seconds).toBe(120);
  });

  it('tells where a crossing stands', () => {
    expect(readCrossStatus({ status: 'PENDING_DEPOSIT' })).toBe('waiting');
    expect(readCrossStatus({ status: 'PROCESSING' })).toBe('working');
    expect(readCrossStatus({ status: 'KNOWN_DEPOSIT_TX' })).toBe('working');
    expect(readCrossStatus({ status: 'SUCCESS' })).toBe('done');
    expect(readCrossStatus({ status: 'REFUNDED' })).toBe('refunded');
    expect(readCrossStatus({ status: 'FAILED' })).toBe('failed');
    expect(readCrossStatus({ status: 'SOMETHING_NEW' })).toBeNull();
    expect(readCrossStatus({ message: 'not found' })).toBeNull();
    expect(readCrossStatus(null)).toBeNull();
  });

  it('orders the payment and the fee of sending it on, with a twentieth to spare, rounded up to a cent', () => {
    // 100 USDT and a fee of 2.95: 2.95 + 0.1475 = 3.0975, so 103.10 is ordered.
    expect(crossBudget(100_000_000n, 2_950_000n)).toBe(103_100_000n);
    expect(crossBudget(100_000_000n, 2_000_000n)).toBe(102_100_000n);
  });
});

describe('what the crossing service says about a deposit address', () => {
  const status = (request: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
    status: 'PENDING_DEPOSIT',
    quoteResponse: { quoteRequest: { originAsset: 'nep141:base-usdc', destinationAsset: 'nep141:tron-usdt', recipient: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', ...request } },
    ...over,
  });
  it('names the coins and where the order delivers', async () => {
    const { readCrossOrder } = await import('../src/core/cross.ts');
    expect(readCrossOrder(status())).toEqual({ origin: 'nep141:base-usdc', destination: 'nep141:tron-usdt', recipient: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' });
    expect(readCrossOrder(status({}, { status: 'SUCCESS' }))?.recipient).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    // Not an order: an address the service does not know, an answer without the order, a delivery that is not to a chain.
    expect(readCrossOrder({ message: 'Deposit address not found', statusCode: 404 })).toBeNull();
    expect(readCrossOrder({ status: 'PENDING_DEPOSIT' })).toBeNull();
    expect(readCrossOrder(status({ recipientType: 'INTENTS' }))).toBeNull();
    expect(readCrossOrder(status({ recipient: 5 }))).toBeNull();
    expect(readCrossOrder(null)).toBeNull();
  });
});
