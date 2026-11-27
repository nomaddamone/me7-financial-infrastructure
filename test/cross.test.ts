import { describe, expect, it } from 'vitest';
import { crossBudget, crossMaxIn, crossQuoteRequest, readCrossQuote, readCrossShort, readCrossStatus, type CrossOrder } from '../src/core/cross.ts';

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
    expect(readCrossQuote(answer(), ORDER, false, LIMITS)).toEqual({ amountIn: 104_400_000n, leastIn: 104_400_000n, depositAddress: DEPOSIT, seconds: 90 });
    // A look at the price needs no address.
    expect(readCrossQuote(answer({ depositAddress: undefined }), ORDER, true, LIMITS)).toEqual({ amountIn: 104_400_000n, leastIn: 104_400_000n, depositAddress: null, seconds: 90 });
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

  it('reads the least the service expects to use, and takes a senseless figure as no room at all', () => {
    expect(readCrossQuote(answer({ minAmountIn: '103400000' }), ORDER, true, LIMITS).leastIn).toBe(103_400_000n);
    expect(readCrossQuote(answer({ minAmountIn: '104400001' }), ORDER, true, LIMITS).leastIn).toBe(104_400_000n);
    expect(readCrossQuote(answer({ minAmountIn: '0' }), ORDER, true, LIMITS).leastIn).toBe(104_400_000n);
    expect(readCrossQuote(answer({ minAmountIn: 103400000 }), ORDER, true, LIMITS).leastIn).toBe(104_400_000n);
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

import { crossAssetName, crossSwapRequest, readCrossDelivered, readCrossSwapQuote, swapFloor, type SwapOrder } from '../src/core/cross.ts';

describe('a swap between networks', () => {
  const me = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  const deposit = '0x1234567890123456789012345678901234567890';
  const swap: SwapOrder = {
    origin: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
    destination: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    recipient: me,
    refundTo: me,
    amountIn: 100_000_000n,
    slippageBps: 50,
    deadline: 1_800_000_000_000,
  };
  const reply = (quote: Record<string, unknown> = {}, request: Record<string, unknown> = {}) => ({
    quote: { amountIn: '100000000', amountOut: '99900000', minAmountOut: '99400000', timeEstimate: 47, depositAddress: deposit, ...quote },
    quoteRequest: { ...crossSwapRequest(swap, false), ...request },
  });

  it('names coins the way the service does', () => {
    expect(crossAssetName('eth')).toBe('nep141:eth.omft.near');
    expect(crossAssetName('base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(swap.destination);
    expect(() => crossAssetName('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toThrow();
  });

  it('orders an exact amount given, to the wallet’s own addresses', () => {
    expect(crossSwapRequest(swap, true)).toMatchObject({ dry: true, swapType: 'EXACT_INPUT', amount: '100000000', recipient: me, refundTo: me, recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN' });
    expect(crossSwapRequest(swap, true)).not.toHaveProperty('appFees');
    expect(crossSwapRequest({ ...swap, fee: { recipient: me, bps: 30 } }, true)).toMatchObject({ appFees: [{ recipient: me, fee: 30 }] });
  });

  it('reads an answer to its own order', () => {
    expect(readCrossSwapQuote(reply(), swap, false, 97_000_000n)).toEqual({ amountOut: 99_900_000n, minOut: 99_400_000n, depositAddress: deposit, seconds: 47 });
    expect(readCrossSwapQuote(reply({ depositAddress: undefined }), swap, true, 97_000_000n).depositAddress).toBeNull();
  });

  it('takes a Tron address to pay to when what is given is on Tron, and no other kind', () => {
    const mineTron = 'TMkkPBi7UcHb3SGTpxqTFFKF52e4cm95Vo';
    const payTron = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
    const fromTron = { ...swap, origin: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', refundTo: mineTron };
    const said = (quote: Record<string, unknown>) => ({ quote: { amountIn: '100000000', amountOut: '99900000', minAmountOut: '99400000', timeEstimate: 47, ...quote }, quoteRequest: crossSwapRequest(fromTron, false) });
    expect(readCrossSwapQuote(said({ depositAddress: payTron }), fromTron, false, 0n).depositAddress).toBe(payTron);
    expect(() => readCrossSwapQuote(said({ depositAddress: deposit }), fromTron, false, 0n)).toThrow('no deposit address');
    expect(() => readCrossSwapQuote(said({ depositAddress: `${payTron.slice(0, -1)}x` }), fromTron, false, 0n)).toThrow('no deposit address');
    expect(() => readCrossSwapQuote(said({ depositAddress: mineTron }), fromTron, false, 0n)).toThrow('no deposit address');
    expect(() => readCrossSwapQuote(said({ depositAddress: payTron, depositMemo: '7' }), fromTron, false, 0n)).toThrow('no deposit address');
    // And a swap from an EVM network still takes no Tron address.
    expect(() => readCrossSwapQuote(reply({ depositAddress: payTron }), swap, false, 0n)).toThrow('no deposit address');
  });

  it('refuses an answer to another order', () => {
    for (const other of [{ recipient: deposit }, { refundTo: deposit }, { amount: '1' }, { destinationAsset: 'nep141:eth.omft.near' }, { swapType: 'EXACT_OUTPUT' }, { recipientType: 'INTENTS' }]) {
      expect(() => readCrossSwapQuote(reply({}, other), swap, false, 0n)).toThrow('another order');
    }
  });

  it('refuses a price below its own floor, and an amount other than the one given', () => {
    expect(() => readCrossSwapQuote(reply(), swap, false, 99_500_000n)).toThrow('too dear');
    expect(() => readCrossSwapQuote(reply({ amountIn: '100000001' }), swap, false, 0n)).toThrow('not the amount');
    expect(() => readCrossSwapQuote(reply({ minAmountOut: '99900001' }), swap, false, 0n)).toThrow('malformed');
  });

  it('refuses a deposit address that is its own, has a memo, or is no address', () => {
    for (const bad of [{ depositAddress: me }, { depositAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, { depositMemo: '7' }, { depositAddress: undefined }]) {
      expect(() => readCrossSwapQuote(reply(bad), swap, false, 0n)).toThrow('no deposit address');
    }
  });

  it('works out the floor: a share off for the price, a fixed sum off for the networks', () => {
    expect(swapFloor(100_000_000n, 300n, 1_500_000n)).toBe(95_500_000n);
    expect(swapFloor(1_000_000n, 300n, 1_500_000n)).toBe(0n);
  });

  it('reads what was delivered', () => {
    expect(readCrossDelivered({ status: 'SUCCESS', swapDetails: { amountOut: '99880000' } })).toBe(99_880_000n);
    expect(readCrossDelivered({ status: 'PROCESSING' })).toBeNull();
  });

  it('tells a deposit that came short from one that has not come', () => {
    expect(readCrossShort({ status: 'PENDING_DEPOSIT' })).toBeNull();
    expect(readCrossShort({ status: 'PROCESSING', swapDetails: { depositedAmount: '338000000' } })).toBeNull();
    expect(readCrossShort({ status: 'INCOMPLETE_DEPOSIT', swapDetails: { depositedAmount: '338000000' } })).toEqual({ seen: 338_000_000n });
    // The service may not say how much came, or say it oddly: the payer is still told the deposit is short.
    for (const details of [undefined, null, {}, { depositedAmount: '0' }, { depositedAmount: 338 }, { depositedAmount: '-5' }]) {
      expect(readCrossShort({ status: 'INCOMPLETE_DEPOSIT', swapDetails: details })).toEqual({ seen: null });
    }
    expect(readCrossShort(null)).toBeNull();
  });
});
