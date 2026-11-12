import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastBitcoin,
  broadcastEvm,
  fetchBitcoinFeeRate,
  estimateEvmGas,
  fetchBitcoinUtxos,
  fetchErc20Balance,
  fetchEvmFees,
  fetchEvmNonce,
  fetchUsdPrices,
} from '../src/net/send.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200) => new Response(body, { status });
const HASH = `0x${'ab'.repeat(32)}`;
const TXID = 'cd'.repeat(32);
const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

afterEach(() => vi.unstubAllGlobals());

describe('EVM node calls', () => {
  it('reads the nonce', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0x1c' })));
    expect(await fetchEvmNonce(['https://n1'], '0xabc')).toBe(28n);
  });

  it('builds fees from the base fee and tip', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ result: { baseFeePerGas: '0x3b9aca00' } }))
      .mockResolvedValueOnce(json({ result: '0x77359400' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchEvmFees(['https://n1'])).toEqual({
      baseFee: 1_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      maxFeePerGas: 4_000_000_000n,
    });
  });

  it('falls back to a default tip when the node lacks the method', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ result: { baseFeePerGas: '0x1' } }))
      .mockResolvedValueOnce(json({ error: { message: 'method not found' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchEvmFees(['https://n1'])).maxPriorityFeePerGas).toBe(1_500_000_000n);
  });

  it('refuses absurd fee data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: { baseFeePerGas: '0xffffffffffffffff' } })));
    await expect(fetchEvmFees(['https://n1'])).rejects.toThrow();
  });

  it('broadcasts and returns the hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: HASH })));
    expect(await broadcastEvm(['https://n1'], '0x02', HASH)).toBe(HASH);
  });

  it('surfaces the node rejection message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'insufficient funds for gas * price + value' } })));
    await expect(broadcastEvm(['https://n1', 'https://n2'], '0x02', HASH)).rejects.toThrow(/insufficient funds/);
  });

  it('treats "already known" as success after a lost first answer', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(json({ error: { message: 'already known' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await broadcastEvm(['https://n1', 'https://n2'], '0x02', HASH)).toBe(HASH);
  });
});

describe('Bitcoin node calls', () => {
  it('reads coins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ txid: TXID, vout: 1, value: 659, status: {} }])));
    expect(await fetchBitcoinUtxos(['https://e1'], BTC)).toEqual([{ txid: TXID, vout: 1, value: 659n }]);
  });

  it('rejects malformed coins', async () => {
    for (const bad of [[{ txid: 'zz', vout: 0, value: 1 }], [{ txid: TXID, vout: -1, value: 1 }], [{ txid: TXID, vout: 0, value: 1.5 }], {}]) {
      vi.stubGlobal('fetch', vi.fn(async () => json(bad)));
      await expect(fetchBitcoinUtxos(['https://e1'], BTC)).rejects.toThrow();
    }
  });

  it('reads the fee rate and refuses nonsense', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ fastestFee: 9, halfHourFee: 4, hourFee: 2 })));
    expect(await fetchBitcoinFeeRate(['https://e1'])).toBe(4);
    for (const bad of [{ halfHourFee: 0 }, { halfHourFee: 99999 }, { halfHourFee: '4' }, {}]) {
      vi.stubGlobal('fetch', vi.fn(async () => json(bad)));
      await expect(fetchBitcoinFeeRate(['https://e1'])).rejects.toThrow();
    }
  });

  it('falls back to per-target estimates on a plain Esplora server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(json({ '1': 4.504, '3': 2.805, '6': 1.341 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchBitcoinFeeRate(['https://e1'])).toBe(3);
    const low = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(json({ '3': 0.2 }));
    vi.stubGlobal('fetch', low);
    expect(await fetchBitcoinFeeRate(['https://e1'])).toBe(1);
  });

  it('broadcasts and surfaces rejections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => text(TXID)));
    expect(await broadcastBitcoin(['https://e1'], '0200')).toBe(TXID);
    vi.stubGlobal('fetch', vi.fn(async () => text('sendrawtransaction RPC error: min relay fee not met', 400)));
    await expect(broadcastBitcoin(['https://e1'], '0200')).rejects.toThrow(/min relay fee/);
  });
});

describe('prices', () => {
  const llama = {
    coins: {
      'coingecko:ethereum': { price: 2073.15 },
      'coingecko:bitcoin': { price: 73894.7 },
      'coingecko:tether': { price: 0.9988 },
      'coingecko:usd-coin': { price: 0.9997 },
      'coingecko:dai': { price: 0.9999 },
      'coingecko:chainlink': { price: 10.56 },
      'coingecko:tron': { price: 0.31 },
    },
  };
  const gecko = {
    bitcoin: { usd: 73984 },
    ethereum: { usd: 2074.57 },
    tether: { usd: 1 },
    'usd-coin': { usd: 1 },
    dai: { usd: 1 },
    chainlink: { usd: 10.5 },
    tron: { usd: 0.3 },
  };

  it('reads the first source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(llama)));
    expect(await fetchUsdPrices()).toEqual({ eth: 2073.15, btc: 73894.7, usdt: 0.9988, usdc: 0.9997, dai: 0.9999, link: 10.56, trx: 0.31 });
  });

  it('falls back to the second source when the first is incomplete', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ coins: { 'coingecko:ethereum': { price: 2073.15 } } }))
      .mockResolvedValueOnce(json(gecko));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchUsdPrices()).toEqual({ eth: 2074.57, btc: 73984, usdt: 1, usdc: 1, dai: 1, link: 10.5, trx: 0.3 });
  });

  it('rejects impossible prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...gecko, bitcoin: { usd: -1 } })));
    await expect(fetchUsdPrices()).rejects.toThrow();
  });
});

describe('tokens', () => {
  const OWNER = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  const TOKEN = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';

  it('reads a token balance with the right call', async () => {
    const fetchMock = vi.fn(async () => json({ result: `0x${(1_500_000n).toString(16).padStart(64, '0')}` }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchErc20Balance(['https://n1'], TOKEN, OWNER)).toBe(1_500_000n);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.method).toBe('eth_call');
    expect(sent.params[0]).toEqual({
      to: TOKEN,
      data: '0x70a082310000000000000000000000009858effd232b4033e47d90003d41ec34ecaeda94',
    });
  });

  it('rejects an empty answer, which means there is no contract at that address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0x' })));
    await expect(fetchErc20Balance(['https://n1'], TOKEN, OWNER)).rejects.toThrow();
  });

  it('estimates gas with a margin and falls back when the node cannot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0xc350' })));
    expect(await estimateEvmGas(['https://n1'], { from: OWNER, to: TOKEN, value: 0n, data: '0xa9059cbb' }, 100_000n)).toBe(60_000n);
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0x5208' })));
    expect(await estimateEvmGas(['https://n1'], { from: OWNER, to: OWNER, value: 1n })).toBe(21_000n);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'execution reverted' } })));
    expect(await estimateEvmGas(['https://n1'], { from: OWNER, to: TOKEN, value: 0n, data: '0xa9059cbb' }, 100_000n)).toBe(100_000n);
  });
});
