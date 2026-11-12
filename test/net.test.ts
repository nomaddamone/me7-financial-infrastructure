import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBitcoinBalance, fetchEvmBalance, formatUnits } from '../src/net/balances.ts';
import { AllEndpointsFailed, withFallback } from '../src/net/fallback.ts';

const ADDR = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('withFallback', () => {
  it('returns the first endpoint that answers', async () => {
    const r = await withFallback(['a', 'b'], async (e) => e.toUpperCase());
    expect(r).toEqual({ value: 'A', endpoint: 'a' });
  });

  it('skips failing endpoints', async () => {
    const r = await withFallback(['a', 'b', 'c'], async (e) => {
      if (e !== 'c') throw new Error(`${e} down`);
      return 42;
    });
    expect(r).toEqual({ value: 42, endpoint: 'c' });
  });

  it('skips an endpoint that hangs', async () => {
    const r = await withFallback(
      ['slow', 'fast'],
      (e, signal) =>
        e === 'fast'
          ? Promise.resolve('ok')
          : new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      20,
    );
    expect(r.endpoint).toBe('fast');
  });

  it('reports every failure when nothing answers', async () => {
    const err = await withFallback(['a', 'b'], async (e) => {
      throw new Error(`${e} down`);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllEndpointsFailed);
    expect((err as AllEndpointsFailed).failures).toEqual([
      { endpoint: 'a', reason: 'a down' },
      { endpoint: 'b', reason: 'b down' },
    ]);
  });
});

describe('fetchEvmBalance', () => {
  it('parses a balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' })));
    const r = await fetchEvmBalance(['https://n1'], ADDR);
    expect(r.value).toBe(10n ** 18n);
  });

  it('falls through a paid-plan error, a rate limit and garbage to a working node', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 1, error: { message: 'chain is not available on free plan' } }))
      .mockResolvedValueOnce(json({ error: 'rate limit' }, 429))
      .mockResolvedValueOnce(json({ result: 'lots' }))
      .mockResolvedValueOnce(json({ result: '0x1' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchEvmBalance(['https://n1', 'https://n2', 'https://n3', 'https://n4'], ADDR);
    expect(r).toEqual({ value: 1n, endpoint: 'https://n4' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refuses a bad address before any request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() => fetchEvmBalance(['https://n1'], '0x123')).toThrow(/Invalid EVM address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchBitcoinBalance', () => {
  it('computes confirmed and pending amounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          chain_stats: { funded_txo_sum: 10538006924, spent_txo_sum: 10537940924 },
          mempool_stats: { funded_txo_sum: 2000, spent_txo_sum: 5000 },
        }),
      ),
    );
    const r = await fetchBitcoinBalance(['https://e1'], BTC);
    expect(r.value).toEqual({ confirmed: 66000n, pending: -3000n });
  });

  it('rejects malformed or impossible numbers', async () => {
    for (const chain_stats of [
      { funded_txo_sum: '5', spent_txo_sum: 0 },
      { funded_txo_sum: 1.5, spent_txo_sum: 0 },
      { funded_txo_sum: 1, spent_txo_sum: 2 },
      undefined,
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ chain_stats, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })));
      await expect(fetchBitcoinBalance(['https://e1'], BTC)).rejects.toBeInstanceOf(AllEndpointsFailed);
    }
  });

  it('refuses a bad address', () => {
    expect(() => fetchBitcoinBalance(['https://e1'], 'tb1/../../x')).toThrow(/Invalid Bitcoin address/);
  });
});

describe('formatUnits', () => {
  it('formats without float errors', () => {
    expect(formatUnits(0n, 18)).toBe('0');
    expect(formatUnits(10n ** 18n, 18)).toBe('1');
    expect(formatUnits(1234567890123456789n, 18)).toBe('1.234567');
    expect(formatUnits(100000000000000n, 18)).toBe('0.0001');
    expect(formatUnits(66000n, 8, 8)).toBe('0.00066');
    expect(formatUnits(-3000n, 8, 8)).toBe('-0.00003');
    expect(formatUnits(1n, 18)).toBe('0');
    expect(formatUnits(123456789012345678901234567890n, 18)).toBe('123456789012.345678');
  });
});
