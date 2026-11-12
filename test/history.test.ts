import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  balanceSeries,
  fetchBitcoinChanges,
  fetchErc20Changes,
  fetchEvmCoinChanges,
  fetchChangesFromNodes,
  findEvmTransaction,
  fetchEvmCoinChangesFromNodes,
  fetchPriceHistory,
  fetchTrc20Changes,
  fetchTronChanges,
  PERIODS,
} from '../src/net/history.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const urls = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map((c) => String((c as unknown[])[0]));

afterEach(() => vi.unstubAllGlobals());

describe('balanceSeries', () => {
  it('rebuilds past balances by undoing later changes', () => {
    // Timeline: start 0, +100 at t=10, -30 at t=20, +5 at t=30. Now: 75.
    const changes = [
      { time: 30, delta: 5n },
      { time: 10, delta: 100n },
      { time: 20, delta: -30n },
    ];
    expect(balanceSeries(75n, changes, [5, 10, 15, 20, 25, 30, 35])).toEqual([0n, 100n, 100n, 70n, 70n, 75n, 75n]);
  });

  it('accepts times in any order and no changes at all', () => {
    expect(balanceSeries(75n, [{ time: 20, delta: -30n }], [25, 5])).toEqual([75n, 105n]);
    expect(balanceSeries(9n, [], [1, 2, 3])).toEqual([9n, 9n, 9n]);
  });

  it('never reports a negative balance when history is incomplete', () => {
    expect(balanceSeries(10n, [{ time: 20, delta: 50n }], [5, 25])).toEqual([0n, 10n]);
  });
});

describe('Bitcoin changes', () => {
  const ME = 'bc1qme';
  const tx = (txid: string, time: number, ins: [string, number][], outs: [string, number][], confirmed = true) => ({
    txid,
    status: confirmed ? { confirmed: true, block_time: time } : { confirmed: false },
    vin: ins.map(([a, v]) => ({ prevout: { scriptpubkey_address: a, value: v } })),
    vout: outs.map(([a, v]) => ({ scriptpubkey_address: a, value: v })),
  });

  it('nets inputs against outputs for each transaction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          tx('c', 300, [[ME, 5000]], [['bc1qother', 1000], [ME, 3800]]), // sent 1000, fee 200
          tx('b', 200, [['bc1qsender', 9000]], [[ME, 5000], ['bc1qsender', 3900]]), // received 5000
          tx('a', 100, [['bc1qx', 1]], [['bc1qy', 1]]), // not ours
        ]),
      ),
    );
    expect(await fetchBitcoinChanges(['https://e1'], ME, 0)).toEqual([
      { time: 300, delta: -1200n, tx: 'c' },
      { time: 200, delta: 5000n, tx: 'b' },
    ]);
  });

  it('follows pages until it passes the start of the period', async () => {
    const page = (from: number) => Array.from({ length: 25 }, (_, i) => tx(`t${from - i}`, from - i, [], [[ME, 1]]));
    const fetchMock = vi.fn().mockResolvedValueOnce(json(page(1000))).mockResolvedValueOnce(json(page(975))).mockResolvedValueOnce(json(page(950)));
    vi.stubGlobal('fetch', fetchMock);
    const changes = await fetchBitcoinChanges(['https://e1'], ME, 960);
    expect(changes).toHaveLength(50);
    expect(urls(fetchMock)).toEqual(['https://e1/address/bc1qme/txs', 'https://e1/address/bc1qme/txs/chain/t976']);
  });
});

describe('EVM changes from Blockscout', () => {
  const ME = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

  it('reads exact ETH changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            { block_timestamp: '2026-11-10T10:54:12Z', delta: '100000000000000', value: '5' },
            { block_timestamp: '2026-11-09T08:00:00Z', delta: '-2500', value: '4' },
          ],
          next_page_params: null,
        }),
      ),
    );
    expect(await fetchEvmCoinChanges('https://b', ME, 0)).toEqual([
      { time: 1794308052, delta: 100000000000000n },
      { time: 1794211200, delta: -2500n },
    ]);
  });

  it('falls back to daily balances when the exact list fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'Internal server error' }, 500))
      .mockResolvedValueOnce(json({ items: [{ date: '2026-11-03', value: '900' }, { date: '2026-11-01', value: '100' }, { date: '2026-11-02', value: '100' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const changes = await fetchEvmCoinChanges('https://b', ME, 0);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.delta).toBe(800n);
    expect(new Date((changes[0]?.time ?? 0) * 1000).toISOString().slice(0, 10)).toBe('2026-11-03');
  });

  it('reads token transfers in both directions and follows pages', async () => {
    const item = (from: string, to: string, value: string, timestamp: string) => ({ timestamp, from: { hash: from }, to: { hash: to }, total: { value } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ items: [item('0xAAA', ME, '700', '2026-11-10T00:00:00.000000Z')], next_page_params: { index: 3, block_number: 9 } }))
      .mockResolvedValueOnce(json({ items: [item(ME.toLowerCase(), '0xBBB', '200', '2026-11-09T00:00:00.000000Z')], next_page_params: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchErc20Changes('https://b', ME, '0xToken', 0)).map((c) => c.delta)).toEqual([700n, -200n]);
    expect(urls(fetchMock)[1]).toBe(`https://b/api/v2/addresses/${ME}/token-transfers?type=ERC-20&token=0xToken&index=3&block_number=9`);
  });
});

describe('Tron changes from TronGrid', () => {
  const ME = 'TVnBmjfdHJS6xSzpsPXmGdeHbRnKhXmMqw';
  const ME_HEX = '41d94ce9e154f09d7d25cd48eef275c8f8862f199e';
  const OTHER_HEX = '41c8599111f29c1e1e061265b4af93ea1f274ad78a';
  const transfer = (owner: string, to: string, amount: number, fee: number, t: number, result = 'SUCCESS') => ({
    block_timestamp: t * 1000,
    ret: [{ contractRet: result, fee }],
    raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { owner_address: owner, to_address: to, amount } } }] },
  });

  it('counts transfers and the fees this address paid', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          transfer(ME_HEX, OTHER_HEX, 2_000_000, 1_100_000, 300), // sent 2 TRX, paid 1.1
          transfer(OTHER_HEX, ME_HEX, 1_000_000_000, 0, 200), // received 1000
          transfer(ME_HEX, OTHER_HEX, 5_000_000, 268_000, 150, 'OUT_OF_ENERGY'), // failed: only the fee is gone
          {
            block_timestamp: 100_000,
            ret: [{ contractRet: 'SUCCESS', fee: 344_000 }],
            raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: ME_HEX } } }] },
          },
        ],
        meta: {},
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTronChanges('https://t', ME, 50)).toEqual([
      { time: 300, delta: -3_100_000n },
      { time: 200, delta: 1_000_000_000n },
      { time: 150, delta: -268_000n },
      { time: 100, delta: -344_000n },
    ]);
    expect(urls(fetchMock)[0]).toBe(`https://t/v1/accounts/${ME}/transactions?limit=200&only_confirmed=true&min_timestamp=50000`);
  });

  it('reads token transfers and follows the page cursor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ block_timestamp: 300_000, from: 'TFaucet', to: ME, value: '1000000000' }], meta: { fingerprint: 'abc/+' } }))
      .mockResolvedValueOnce(json({ data: [{ block_timestamp: 200_000, from: ME, to: 'TOther', value: '25500000' }], meta: {} }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTrc20Changes('https://t', ME, 'TToken', 0)).toEqual([
      { time: 300, delta: 1_000_000_000n, peer: 'TFaucet' },
      { time: 200, delta: -25_500_000n, peer: 'TOther' },
    ]);
    expect(urls(fetchMock)[1]).toContain('&fingerprint=abc%2F%2B');
  });
});

describe('price history', () => {
  const names = ['ethereum', 'bitcoin', 'tether', 'usd-coin', 'dai', 'chainlink', 'tron'];
  const body = (shift = 0) => ({
    coins: Object.fromEntries(
      names.map((n, k) => [`coingecko:${n}`, { prices: [100, 200, 300].map((t, i) => ({ timestamp: t + (n === 'tron' ? shift : 0), price: (k + 1) * 10 + i })) }]),
    ),
  });

  it('puts every asset on one time grid', async () => {
    const fetchMock = vi.fn(async () => json(body(7)));
    vi.stubGlobal('fetch', fetchMock);
    const h = await fetchPriceHistory(PERIODS[0], 1_000_000);
    expect(h.times).toEqual([100, 200, 300]);
    expect(h.prices.btc).toEqual([20, 21, 22]);
    expect(h.prices.trx).toEqual([70, 71, 72]);
    expect(Object.keys(h.prices).sort()).toEqual(['btc', 'dai', 'eth', 'link', 'trx', 'usdc', 'usdt']);
    expect(urls(fetchMock)[0]).toContain('start=913600&span=48&period=30m');
  });

  it('stays within the source limit of 500 points per request', () => {
    for (const p of PERIODS) expect(p.span * names.length).toBeLessThanOrEqual(500);
  });

  it('rejects incomplete or impossible data', async () => {
    const broken = body();
    delete (broken.coins as Record<string, unknown>)['coingecko:dai'];
    vi.stubGlobal('fetch', vi.fn(async () => json(broken)));
    await expect(fetchPriceHistory(PERIODS[0], 1)).rejects.toThrow();
    const negative = body();
    (negative.coins['coingecko:bitcoin'] as { prices: { price: number }[] }).prices[1]!.price = -1;
    vi.stubGlobal('fetch', vi.fn(async () => json(negative)));
    await expect(fetchPriceHistory(PERIODS[0], 1)).rejects.toThrow();
  });
});

describe('coin history from nodes', () => {
  const ADDRESS = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
  /** A stand-in chain: block n is at time 1000 + 2n, and the balance changes at the given blocks. */
  function chain(
    latest: number,
    steps: readonly [block: number, balance: bigint][],
    limit = Infinity,
    sent: readonly number[] = [],
    tokenSteps: readonly [block: number, balance: bigint][] = [],
  ) {
    const at = (list: readonly [number, bigint][]) => (block: number) => list.reduce((bal, [b, value]) => (block >= b ? value : bal), 0n);
    const balanceAt = at(steps);
    const tokenAt = at(tokenSteps);
    let calls = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }[];
      calls += batch.length;
      if (batch.length > limit) return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
      const answers = batch.map(({ id, method, params }) => {
        if (method === 'eth_getBalance') return { id, result: `0x${balanceAt(Number(BigInt(String(params[1])))).toString(16)}` };
        if (method === 'eth_getTransactionCount') return { id, result: `0x${sent.filter((b) => b <= Number(BigInt(String(params[1])))).length.toString(16)}` };
        if (method === 'eth_call') return { id, result: `0x${tokenAt(Number(BigInt(String(params[1])))).toString(16).padStart(64, '0')}` };
        const n = params[0] === 'latest' ? latest : Number(BigInt(String(params[0])));
        return { id, result: { number: `0x${n.toString(16)}`, timestamp: `0x${(1000 + 2 * n).toString(16)}` } };
      });
      return new Response(JSON.stringify(answers), { status: 200 });
    });
    return () => calls;
  }

  it('finds the exact block and size of every change, newest first', async () => {
    chain(1_000_000, [
      [700_123, 3_000_000n],
      [700_125, 2_999_000n],
      [912_345, 5_000_000n],
    ]);
    const changes = await fetchEvmCoinChangesFromNodes(['https://node.example'], ADDRESS, 1000 + 2 * 500_000, 2);
    expect(changes).toEqual([
      { time: 1000 + 2 * 912_345, delta: 2_001_000n, block: 912_345 },
      { time: 1000 + 2 * 700_125, delta: -1_000n, block: 700_125 },
      { time: 1000 + 2 * 700_123, delta: 3_000_000n, block: 700_123 },
    ]);
    // Walking back from today's balance gives zero before the first top-up.
    expect(balanceSeries(5_000_000n, changes, [1000 + 2 * 600_000, 1000 + 2 * 800_000, 1000 + 2 * 999_999])).toEqual([0n, 2_999_000n, 5_000_000n]);
  }, 20_000);

  it('sees money put somewhere and taken back, which leaves the balance unchanged between samples', async () => {
    // The token goes 50 -> 41 -> 50 within a few blocks; the coin only pays the two fees.
    chain(
      1_000_000,
      [
        [600_000, 1_000n],
        [800_010, 990n],
        [800_050, 985n],
      ],
      Infinity,
      [800_010, 800_050],
      [
        [600_000, 50n],
        [800_010, 41n],
        [800_050, 50n],
      ],
    );
    const { changes, block } = await fetchChangesFromNodes(['https://node.example'], [{ coin: ADDRESS }, { token: ADDRESS, owner: ADDRESS }], 1000 + 2 * 700_000, 2, ADDRESS);
    const [coin, token] = changes;
    expect(block).toBe(1_000_000);
    expect(coin).toEqual([
      { time: 1000 + 2 * 800_050, delta: -5n, block: 800_050 },
      { time: 1000 + 2 * 800_010, delta: -10n, block: 800_010 },
    ]);
    expect(token).toEqual([
      { time: 1000 + 2 * 800_050, delta: 9n, block: 800_050 },
      { time: 1000 + 2 * 800_010, delta: -9n, block: 800_010 },
    ]);
  }, 30_000);

  it('continues from a known block with a handful of requests and finds only what came after', async () => {
    const calls = chain(1_000_000, [
      [700_123, 3_000_000n],
      [999_990, 4_000_000n],
    ]);
    const quiet = await fetchChangesFromNodes(['https://node.example'], [{ coin: ADDRESS }], 0, 2, ADDRESS, 999_995);
    expect(quiet).toEqual({ changes: [[]], block: 1_000_000 });
    expect(calls()).toBeLessThanOrEqual(5);
    const later = await fetchChangesFromNodes(['https://node.example'], [{ coin: ADDRESS }], 0, 2, ADDRESS, 999_000);
    expect(later.changes).toEqual([[{ time: 1000 + 2 * 999_990, delta: 1_000_000n, block: 999_990 }]]);
  }, 20_000);

  it('reports nothing for an address that did not change, and never sends a large batch', async () => {
    const calls = chain(900_000, [[10, 7n]], 10);
    expect(await fetchEvmCoinChangesFromNodes(['https://node.example'], ADDRESS, 1000 + 2 * 200_000, 2)).toEqual([]);
    expect(calls()).toBeGreaterThan(20);
  }, 20_000);

  it('fails rather than invent a past when no node has the old state', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { id: number; method: string }[];
      return new Response(
        JSON.stringify(batch.map(({ id, method }) => (method === 'eth_getBalance' ? { id, error: { message: 'archive' } } : { id, result: { number: '0x64', timestamp: '0x3e8' } }))),
        { status: 200 },
      );
    });
    await expect(fetchEvmCoinChangesFromNodes(['https://node.example'], ADDRESS, 0, 2)).rejects.toThrow();
  }, 20_000);
});

describe('finding the transaction behind a change known by its block', () => {
  const OWNER = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
  const OTHER = '0x1111111111111111111111111111111111111111';
  const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const HASH = `0x${'ab'.repeat(32)}`;
  const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
  const node = (answer: (method: string, params: any[]) => unknown) => {
    const seen: { method: string; params: any[] }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { id: number; method: string; params: any[] }[];
      seen.push(...batch);
      return new Response(JSON.stringify(batch.map(({ id, method, params }) => ({ id, result: answer(method, params) }))), { status: 200 });
    });
    return seen;
  };

  it('finds a token transfer and who was on the other side, asking only for that one block', async () => {
    const seen = node(() => [{ transactionHash: HASH, topics: ['0xddf2', pad(OTHER), pad(OWNER)] }]);
    expect(await findEvmTransaction(['https://n'], { block: 700_123, owner: OWNER, token: TOKEN, incoming: true })).toEqual({ tx: HASH, peer: OTHER });
    expect(seen[0]?.method).toBe('eth_getLogs');
    expect(seen[0]?.params[0]).toMatchObject({ address: TOKEN, fromBlock: '0xaaedb', toBlock: '0xaaedb' });
    expect(seen[0]?.params[0].topics[2]).toBe(pad(OWNER));

    const out = node(() => [{ transactionHash: HASH, topics: ['0xddf2', pad(OWNER), pad(OTHER)] }]);
    expect(await findEvmTransaction(['https://n'], { block: 5, owner: OWNER, token: TOKEN, incoming: false })).toEqual({ tx: HASH, peer: OTHER });
    expect(out[0]?.params[0].topics[1]).toBe(pad(OWNER));
  });

  it('finds the coin transaction the owner sent or received in the block', async () => {
    const txs = [
      { hash: `0x${'01'.repeat(32)}`, from: OTHER, to: OTHER },
      { hash: HASH, from: OWNER.toUpperCase().replace('0X', '0x'), to: OTHER },
      { hash: `0x${'02'.repeat(32)}`, from: OTHER, to: OWNER },
    ];
    node(() => ({ transactions: txs }));
    expect(await findEvmTransaction(['https://n'], { block: 9, owner: OWNER, incoming: false })).toEqual({ tx: HASH, peer: OTHER });
    expect(await findEvmTransaction(['https://n'], { block: 9, owner: OWNER, incoming: true })).toEqual({ tx: `0x${'02'.repeat(32)}`, peer: OTHER });
  });

  it('returns nothing when the money came from inside a contract', async () => {
    node((method) => (method === 'eth_getLogs' ? [] : { transactions: [{ hash: HASH, from: OTHER, to: OTHER }] }));
    expect(await findEvmTransaction(['https://n'], { block: 9, owner: OWNER, incoming: true })).toBeNull();
    expect(await findEvmTransaction(['https://n'], { block: 9, owner: OWNER, token: TOKEN, incoming: true })).toBeNull();
  });
});
