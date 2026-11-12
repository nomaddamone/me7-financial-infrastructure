import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBook, fetchCandles, fetchTape, fetchTicker, mergeCandle, movingAverage, parseBook, parseCandle, parseTapeTrade, parseTicker, type Candle } from '../src/net/market.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = [1794391200000, '2058.26', '2066.12', '2053.52', '2060.00', '7445.52', 1794394799999, '15337650.17', 59182, '3440.8', '7089551.4', '0'];
const candle = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });

afterEach(() => vi.unstubAllGlobals());

describe('market data', () => {
  it('reads candles and asks only the public data host', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (seen.push(String(url)), json([row, row])));
    const candles = await fetchCandles('ETHUSDT', '1h', 2);
    expect(candles[0]).toEqual({ time: 1794391200, open: 2058.26, high: 2066.12, low: 2053.52, close: 2060, volume: 7445.52 });
    expect(seen[0]).toBe('https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=2');
  });

  it('refuses candles that could not be real', () => {
    expect(() => parseCandle([1, '10', '9', '11', '10', '1'])).toThrow(); // high below low
    expect(() => parseCandle([1, '0', '1', '0', '1', '1'])).toThrow(); // opened at zero
    expect(() => parseCandle([1, 'abc', '1', '1', '1', '1'])).toThrow();
    expect(() => parseCandle([1, '-5', '1', '1', '1', '1'])).toThrow();
    expect(() => parseCandle('nope')).toThrow();
  });

  it('reads the day’s numbers from both the snapshot and the live stream', async () => {
    const rest = { lastPrice: '2059.77', priceChangePercent: '-1.697', highPrice: '2109.09', lowPrice: '2006.00', quoteVolume: '670000000.5' };
    vi.stubGlobal('fetch', async () => json(rest));
    expect(await fetchTicker('ETHUSDT')).toEqual({ last: 2059.77, change: -1.697, high: 2109.09, low: 2006, quoteVolume: 670000000.5 });
    expect(parseTicker({ c: '2059.77', P: '-1.697', h: '2109.09', l: '2006.00', q: '670000000.5' })).toEqual(parseTicker(rest));
    expect(() => parseTicker({ lastPrice: 'x' })).toThrow();
  });

  it('reads the order book and the tape, newest trade first', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('/depth')
        ? json({ bids: [['2059.70', '7.636']], asks: [['2059.71', '60.9647']] })
        : json([
            { price: '2059.41', qty: '0.0026', time: 1, isBuyerMaker: true },
            { price: '2059.42', qty: '0.3', time: 2, isBuyerMaker: false },
          ]),
    );
    expect(await fetchBook('ETHUSDT')).toEqual({ bids: [[2059.7, 7.636]], asks: [[2059.71, 60.9647]] });
    expect(await fetchTape('ETHUSDT')).toEqual([
      { time: 2, price: 2059.42, amount: 0.3, sell: false },
      { time: 1, price: 2059.41, amount: 0.0026, sell: true },
    ]);
    expect(parseTapeTrade({ p: '1', q: '2', T: 3, m: true })).toEqual({ time: 3, price: 1, amount: 2, sell: true });
    expect(() => parseBook({ bids: 'x', asks: [] })).toThrow();
    expect(() => parseBook({ bids: [['1']], asks: [] })).toThrow();
  });

  it('reports a failing source instead of showing nothing as data', async () => {
    vi.stubGlobal('fetch', async () => json({ code: -1121, msg: 'Invalid symbol.' }, 400));
    await expect(fetchCandles('NOPE', '1h')).rejects.toThrow('HTTP 400');
  });
});

describe('chart maths', () => {
  it('updates the candle in progress and appends the next one', () => {
    const list = [candle(100, 1), candle(200, 2)];
    expect(mergeCandle(list, candle(200, 2.5))).toEqual([candle(100, 1), candle(200, 2.5)]);
    expect(mergeCandle(list, candle(300, 3))).toEqual([candle(100, 1), candle(200, 2), candle(300, 3)]);
    // A late update for an older candle changes nothing.
    expect(mergeCandle(list, candle(100, 9))).toEqual(list);
    expect(mergeCandle([], candle(1, 1))).toEqual([candle(1, 1)]);
  });

  it('averages the last closes, and says nothing where there are too few', () => {
    const closes = [1, 2, 3, 4, 5].map((c, i) => candle(i, c));
    expect(movingAverage(closes, 3)).toEqual([null, null, 2, 3, 4]);
    expect(movingAverage(closes, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(movingAverage(closes, 9)).toEqual([null, null, null, null, null]);
  });
});
