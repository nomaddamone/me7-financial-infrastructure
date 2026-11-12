import { AbiCoder, id } from 'ethers';
import { describe, expect, it } from 'vitest';
import { swapReturned, SWAP_NATIVE, SWAP_ROUTER } from '../src/core/swap.ts';
import type { AssetDef } from '../src/app/assets.ts';
import { entryPrice, tradeReturn, tradeWorth, type Trade } from '../src/app/trades.ts';
import type { UsdPrices } from '../src/net/send.ts';

const eth: AssetDef = { id: 'eth-base', ticker: 'eth', net: 'base', kind: 'eth', decimals: 18, shown: 6, price: 'eth', chain: 'base' };
const usdc: AssetDef = { id: 'usdc-base', ticker: 'usdc', net: 'base', kind: 'erc20', decimals: 6, shown: 2, price: 'usdc', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chain: 'base' };
const prices = (ethUsd: number): UsdPrices => ({ eth: ethUsd, btc: 70000, usdt: 1, usdc: 1, dai: 1, link: 15, trx: 0.3 });

/** Bought 0.05 ETH for 100 USDC: entered at 2000. */
const long: Trade = { id: '0x01', time: 1, net: 'base', fromId: 'usdc-base', toId: 'eth-base', amountIn: '100000000', amountOut: '50000000000000000' };

describe('trade return', () => {
  it('knows the entry price', () => {
    expect(entryPrice(long, usdc, eth)).toBeCloseTo(2000, 6);
  });

  it('follows the price while the trade is open', () => {
    expect(tradeWorth(long, usdc, eth, prices(2200))).toBeCloseTo(110, 6);
    expect(tradeReturn(long, usdc, eth, prices(2200))).toBeCloseTo(10, 6);
    expect(tradeReturn(long, usdc, eth, prices(1800))).toBeCloseTo(-10, 6);
    expect(tradeReturn(long, usdc, eth, prices(2000))).toBeCloseTo(0, 6);
  });

  it('counts a trade paid in a coin that itself moves, in that coin', () => {
    // Sold 0.05 ETH for 100 USDC. If ETH then falls to 1600, the 100 USDC buys back 0.0625 ETH: +25% in ETH.
    const short: Trade = { ...long, fromId: 'eth-base', toId: 'usdc-base', amountIn: '50000000000000000', amountOut: '100000000' };
    expect(tradeReturn(short, eth, usdc, prices(1600))).toBeCloseTo(25, 6);
    expect(tradeReturn(short, eth, usdc, prices(2500))).toBeCloseTo(-20, 6);
  });

  it('reports what a closed trade actually brought, whatever the price is now', () => {
    const done: Trade = { ...long, closed: { time: 2, tx: '0x02', amountBack: '107500000' } };
    expect(tradeReturn(done, usdc, eth, prices(9999))).toBeCloseTo(7.5, 6);
    expect(tradeReturn(done, usdc, eth, null)).toBeCloseTo(7.5, 6);
  });

  it('has nothing to say about an open trade without prices, or a trade that paid nothing', () => {
    expect(tradeReturn(long, usdc, eth, null)).toBeNull();
    expect(tradeReturn({ ...long, amountIn: '0' }, usdc, eth, prices(2000))).toBeNull();
  });
});

describe('what a finished swap paid out', () => {
  const coder = AbiCoder.defaultAbiCoder();
  const ME = '0x7f054a2016c9cec7cd5c4a2d21e650a2767af737';
  const OTHER = '0x1111111111111111111111111111111111111111';
  const TOPIC = id('Swapped(address,address,address,address,uint256,uint256)');
  const log = (dst: string, receiver: string, returned: bigint, address = SWAP_ROUTER) => ({
    address,
    topics: [TOPIC],
    data: coder.encode(['address', 'address', 'address', 'address', 'uint256', 'uint256'], [ME, SWAP_NATIVE, dst, receiver, 500n, returned]),
  });

  it('reads the amount from the router’s own record', () => {
    const logs = [{ address: usdc.contract, topics: ['0xddf2'], data: '0x' }, log(usdc.contract ?? '', ME, 1_023_821n)];
    expect(swapReturned(logs, { dstToken: usdc.contract ?? '', receiver: ME })).toBe(1_023_821n);
    expect(swapReturned([log(SWAP_NATIVE, ME, 77n)], { dstToken: SWAP_NATIVE, receiver: ME.toUpperCase().replace('0X', '0x') })).toBe(77n);
  });

  it('ignores records about another receiver, another coin or another contract', () => {
    const want = { dstToken: usdc.contract ?? '', receiver: ME };
    expect(swapReturned([log(usdc.contract ?? '', OTHER, 5n)], want)).toBeNull();
    expect(swapReturned([log(SWAP_NATIVE, ME, 5n)], want)).toBeNull();
    expect(swapReturned([log(usdc.contract ?? '', ME, 5n, OTHER)], want)).toBeNull();
    expect(swapReturned([{ address: SWAP_ROUTER, topics: [TOPIC], data: '0x1234' }], want)).toBeNull();
    expect(swapReturned([], want)).toBeNull();
  });
});
