import { MARKET_API, MARKET_WS } from './endpoints.ts';

/**
 * Market data for the trading section: candles, the order book and the tape of
 * recent trades, from Binance's public data service (no key, no account). It is
 * shown for reference only: trades made in the app go through an on-chain
 * exchange, whose price for a given amount is quoted separately before signing.
 */

export interface Candle {
  /** Unix seconds of the candle's start. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded amount of the base coin. */
  volume: number;
}

export interface Ticker {
  last: number;
  /** Change over the last 24 hours, in percent. */
  change: number;
  high: number;
  low: number;
  /** 24-hour volume in the quote coin. */
  quoteVolume: number;
}

/** A price level: price and the amount of the base coin waiting there. */
export type Level = [price: number, amount: number];
export interface Book {
  bids: Level[];
  asks: Level[];
}

export interface TapeTrade {
  /** Unix milliseconds. */
  time: number;
  price: number;
  amount: number;
  /** True when the trade was a market sell (the buyer's order was resting in the book). */
  sell: boolean;
}

export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Interval = (typeof INTERVALS)[number];

const number = (value: unknown): number => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new Error('Malformed response');
  return n;
};
const signed = (value: unknown): number => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error('Malformed response');
  return n;
};

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${MARKET_API}${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function parseCandle(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 6) throw new Error('Malformed response');
  const candle = { time: Math.floor(number(row[0]) / 1000), open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]) };
  if (candle.high < candle.low || candle.open <= 0 || candle.close <= 0) throw new Error('Malformed response');
  return candle;
}

export async function fetchCandles(symbol: string, interval: Interval, limit = 300): Promise<Candle[]> {
  const rows = await get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(rows)) throw new Error('Malformed response');
  return rows.map(parseCandle);
}

export function parseTicker(raw: unknown): Ticker {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') throw new Error('Malformed response');
  // The REST answer and the live stream name the same fields differently.
  return {
    last: number(t.lastPrice ?? t.c),
    change: signed(t.priceChangePercent ?? t.P),
    high: number(t.highPrice ?? t.h),
    low: number(t.lowPrice ?? t.l),
    quoteVolume: number(t.quoteVolume ?? t.q),
  };
}

export async function fetchTicker(symbol: string): Promise<Ticker> {
  return parseTicker(await get(`/api/v3/ticker/24hr?symbol=${symbol}`));
}

const levels = (raw: unknown): Level[] => {
  if (!Array.isArray(raw)) throw new Error('Malformed response');
  return raw.map((row) => {
    if (!Array.isArray(row) || row.length < 2) throw new Error('Malformed response');
    return [number(row[0]), number(row[1])] as Level;
  });
};

export function parseBook(raw: unknown): Book {
  const b = raw as { bids?: unknown; asks?: unknown } | null;
  return { bids: levels(b?.bids), asks: levels(b?.asks) };
}

export async function fetchBook(symbol: string, depth = 10): Promise<Book> {
  return parseBook(await get(`/api/v3/depth?symbol=${symbol}&limit=${depth}`));
}

export function parseTapeTrade(raw: unknown): TapeTrade {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') throw new Error('Malformed response');
  return { time: number(t.time ?? t.T), price: number(t.price ?? t.p), amount: number(t.qty ?? t.q), sell: (t.isBuyerMaker ?? t.m) === true };
}

export async function fetchTape(symbol: string, limit = 30): Promise<TapeTrade[]> {
  const rows = await get(`/api/v3/trades?symbol=${symbol}&limit=${limit}`);
  if (!Array.isArray(rows)) throw new Error('Malformed response');
  return rows.map(parseTapeTrade).reverse();
}

export interface StreamHandlers {
  candle?: (candle: Candle) => void;
  ticker?: (ticker: Ticker) => void;
  book?: (book: Book) => void;
  trade?: (trade: TapeTrade) => void;
  /** Whether live updates are flowing. */
  status?: (live: boolean) => void;
}

/**
 * Live updates for one market. Reconnects by itself when the connection drops.
 * Returns the function that closes it for good.
 */
export function openMarketStream(symbol: string, interval: Interval, on: StreamHandlers): () => void {
  const s = symbol.toLowerCase();
  const url = `${MARKET_WS}/stream?streams=${s}@kline_${interval}/${s}@ticker/${s}@depth10@1000ms/${s}@trade`;
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      on.status?.(true);
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { stream?: unknown; data?: Record<string, unknown> };
        const stream = typeof message.stream === 'string' ? message.stream : '';
        const data = message.data;
        if (!data) return;
        if (stream.includes('@kline_')) {
          const k = data.k as Record<string, unknown> | undefined;
          if (k) on.candle?.(parseCandle([k.t, k.o, k.h, k.l, k.c, k.v]));
        } else if (stream.endsWith('@ticker')) on.ticker?.(parseTicker(data));
        else if (stream.includes('@depth')) on.book?.(parseBook(data));
        else if (stream.endsWith('@trade')) on.trade?.(parseTapeTrade(data));
      } catch {
        /* one malformed message is skipped; the next one may be fine */
      }
    };
    socket.onclose = () => {
      on.status?.(false);
      if (closed) return;
      attempt += 1;
      retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4)));
    };
    socket.onerror = () => socket?.close();
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}

/** Put a fresh candle into the list: it replaces the last one if it is the same candle, and is appended otherwise. */
export function mergeCandle(list: readonly Candle[], next: Candle): Candle[] {
  const last = list[list.length - 1];
  if (!last || next.time > last.time) return [...list, next].slice(-600);
  if (next.time === last.time) return [...list.slice(0, -1), next];
  return [...list];
}

/** Simple moving average of the closing prices over `length` candles; null where there are too few. */
export function movingAverage(candles: readonly Candle[], length: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= length) sum -= (candles[i - length] as Candle).close;
    out.push(i >= length - 1 ? sum / length : null);
  });
  return out;
}
