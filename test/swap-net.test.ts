import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSwap, fetchSwapRoute } from '../src/net/swap.ts';
import { isValidEvmAddress } from '../src/core/evm.ts';
import { SWAP_FEE } from '../src/net/endpoints.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ME = '0x0011eaa39468412f260c45397a30790e42260ded';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const summary = { amountOut: '412262', gas: '330498', route: [['opaque']] };

function server(answer: (url: string, init?: RequestInit) => Response) {
  const seen: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return answer(String(url), init);
  });
  return seen;
}

const CONFIGURED = SWAP_FEE.receiver;
afterEach(() => {
  vi.unstubAllGlobals();
  SWAP_FEE.receiver = CONFIGURED;
});

describe('swap fee', () => {
  it('goes to the address the owner confirmed, at half a percent', () => {
    // A slip here would send every fee to an address nobody controls.
    expect(SWAP_FEE.receiver).toBe('0x7f054A2016C9ceC7Cd5c4A2D21E650a2767AF737');
    expect(isValidEvmAddress(SWAP_FEE.receiver)).toBe(true);
    expect(SWAP_FEE.bps).toBe(50);
  });
});

describe('swap aggregator', () => {
  it('asks for a route without a fee when no receiver is set, and with one when it is', async () => {
    const seen = server(() => json({ code: 0, data: { routeSummary: summary } }));
    SWAP_FEE.receiver = '';
    const route = await fetchSwapRoute('base', { tokenIn: NATIVE, tokenOut: USDC, amountIn: 200_000_000_000_000n });
    expect(route).toEqual({ summary, amountOut: 412_262n, gas: 330_498n });
    const plain = new URL(seen[0]?.url ?? '');
    expect(plain.origin + plain.pathname).toBe('https://aggregator-api.kyberswap.com/base/api/v1/routes');
    expect(Object.fromEntries(plain.searchParams)).toEqual({ tokenIn: NATIVE, tokenOut: USDC, amountIn: '200000000000000' });

    SWAP_FEE.receiver = ME;
    await fetchSwapRoute('base', { tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n });
    const withFee = Object.fromEntries(new URL(seen[1]?.url ?? '').searchParams);
    expect(withFee).toMatchObject({ feeAmount: String(SWAP_FEE.bps), isInBps: 'true', chargeFeeBy: 'currency_out', feeReceiver: ME });
  });

  it('reports the aggregator’s own reason when there is no route', async () => {
    server(() => json({ code: 4008, message: 'route not found' }, 400));
    await expect(fetchSwapRoute('base', { tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n })).rejects.toThrow('route not found');
    server(() => json({ code: 0, data: { routeSummary: { amountOut: '0', gas: '1' } } }));
    await expect(fetchSwapRoute('base', { tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n })).rejects.toThrow('No route');
    server(() => json({ code: 0, data: { routeSummary: { amountOut: '-5', gas: '1' } } }));
    await expect(fetchSwapRoute('base', { tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n })).rejects.toThrow(/Malformed/);
  });

  it('builds a transaction that pays the sender, and passes the route back untouched', async () => {
    const seen = server(() => json({ code: 0, data: { routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', data: '0xe21fd0e9abcd', transactionValue: '200000000000000' } }));
    const built = await buildSwap('base', { summary, amountOut: 1n, gas: 1n }, ME, 50);
    expect(built).toEqual({ to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', data: '0xe21fd0e9abcd', value: 200_000_000_000_000n });
    expect(seen[0]?.url).toBe('https://aggregator-api.kyberswap.com/base/api/v1/route/build');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ routeSummary: summary, sender: ME, recipient: ME, slippageTolerance: 50 });
  });

  it('refuses a build that is not a transaction', async () => {
    server(() => json({ code: 0, data: { routerAddress: 'somewhere', data: '0x00', transactionValue: '0' } }));
    await expect(buildSwap('base', { summary, amountOut: 1n, gas: 1n }, ME, 50)).rejects.toThrow(/Malformed/);
    server(() => json({ code: 0, data: { routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', data: 'call me', transactionValue: '0' } }));
    await expect(buildSwap('base', { summary, amountOut: 1n, gas: 1n }, ME, 50)).rejects.toThrow(/Malformed/);
  });
});
