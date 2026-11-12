import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { parseUnits } from '../core/index.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import {
  fetchBook,
  fetchCandles,
  fetchTape,
  fetchTicker,
  INTERVALS,
  mergeCandle,
  openMarketStream,
  type Book,
  type Candle,
  type Interval,
  type TapeTrade,
  type Ticker,
} from '../net/market.ts';
import { fetchErc20Balance, fetchUsdPrices, type UsdPrices } from '../net/send.ts';
import { ASSETS, evmOf, type AssetDef } from './assets.ts';
import { CandleChart, priceText, type ChartOptions } from './candles.tsx';
import { Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { CoinIcon } from './icons.tsx';
import { Swap, SWAPPABLE, type SwapResult } from './swap.tsx';
import { entryPrice, loadTrades, saveTrades, tradeReturn, tradeWorth, type Trade } from './trades.ts';
import type { Wallet } from './wallet.ts';
import './trading.css';

/** A market of the terminal: a pair on one network, and its name at the market data source. */
interface Market {
  id: string;
  base: AssetDef;
  quote: AssetDef;
  symbol: string;
}

/** Pairs offered, as [base, quote] tickers. Each exists on every network that holds both coins. */
const PAIRS: readonly [string, string][] = [
  ['wbtc', 'usdt'],
  ['wbtc', 'usdc'],
  ['cbbtc', 'usdc'],
  ['cbbtc', 'usdt'],
  ['eth', 'usdt'],
  ['eth', 'usdc'],
  ['link', 'usdt'],
  ['link', 'usdc'],
  ['link', 'eth'],
  ['usdc', 'usdt'],
];
/** Wrapped bitcoin follows bitcoin's price, so its markets show bitcoin's chart and order book. */
const DATA_NAME: Record<string, string> = { wbtc: 'btc', cbbtc: 'btc' };
const MARKETS: readonly Market[] = [...new Set(SWAPPABLE.map((a) => a.net))].flatMap((net) =>
  PAIRS.flatMap(([b, q]) => {
    const base = SWAPPABLE.find((a) => a.net === net && a.ticker === b);
    const quote = SWAPPABLE.find((a) => a.net === net && a.ticker === q);
    return base && quote ? [{ id: `${base.id}/${quote.id}`, base, quote, symbol: `${DATA_NAME[b] ?? b}${DATA_NAME[q] ?? q}`.toUpperCase() }] : [];
  }),
);

const PRICE_REFRESH_MS = 60_000;
const BOOK_ROWS = 9;
const TAPE_ROWS = 22;

const asset = (id: string) => ASSETS.find((a) => a.id === id);
const percent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
const units = (a: AssetDef, raw: bigint | string) => formatUnits(BigInt(raw), a.decimals, a.shown);
const compact = (value: number) =>
  value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toFixed(0);
const amountText = (value: number) => (value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toFixed(4));
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The trading section, laid out like an exchange terminal. Orders are swaps from the pocket, tracked as trades. */
export function Trading({ t, wallet }: { t: Dict; wallet: Wallet }) {
  const s = t.trading;
  const [market, setMarket] = useState<Market | undefined>(MARKETS[0]);
  const [picking, setPicking] = useState(false);
  const [interval, setIntervalId] = useState<Interval>('1h');
  const [options, setOptions] = useState<ChartOptions>({ kind: 'candles', volume: true, ma7: true, ma25: true });
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [tape, setTape] = useState<TapeTrade[]>([]);
  const [live, setLive] = useState(false);
  const [down, setDown] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [share, setShare] = useState<number | null>(null);
  const [balances, setBalances] = useState<{ base: bigint; quote: bigint } | null>(null);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState<UsdPrices | null>(null);
  const [trades, setTrades] = useState<Trade[]>(() => loadTrades(wallet.evm));
  // An order on its way through quote, review and signing; `closes` names the trade it closes, if any.
  const [ticket, setTicket] = useState<{ fromId: string; toId: string; amount?: bigint; all?: boolean; closes?: string } | null>(null);
  const [tab, setTab] = useState<'book' | 'tape'>('book');

  // Dollar prices, to value open trades.
  useEffect(() => {
    let stale = false;
    const load = () =>
      fetchUsdPrices().then(
        (p) => {
          if (!stale) setPrices(p);
        },
        () => undefined,
      );
    void load();
    const id = setInterval(() => void load(), PRICE_REFRESH_MS);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  // Market data: a snapshot first, then live updates on top of it.
  const symbol = market?.symbol;
  useEffect(() => {
    if (!symbol) return;
    let stale = false;
    setCandles([]);
    setTicker(null);
    setBook(null);
    setTape([]);
    setDown(false);
    Promise.all([fetchCandles(symbol, interval), fetchTicker(symbol), fetchBook(symbol), fetchTape(symbol)]).then(
      ([c, tk, b, tp]) => {
        if (stale) return;
        setCandles(c);
        setTicker(tk);
        setBook(b);
        setTape(tp.slice(0, TAPE_ROWS));
      },
      () => {
        if (!stale) setDown(true);
      },
    );
    const close = openMarketStream(symbol, interval, {
      candle: (c) => !stale && setCandles((list) => (list.length ? mergeCandle(list, c) : list)),
      ticker: (tk) => !stale && setTicker(tk),
      book: (b) => !stale && setBook(b),
      trade: (tr) => !stale && setTape((list) => [tr, ...list].slice(0, TAPE_ROWS)),
      status: (on) => !stale && setLive(on),
    });
    return () => {
      stale = true;
      close();
    };
  }, [symbol, interval]);

  const loadBalances = useCallback(async () => {
    if (!market) return;
    const read = (a: AssetDef) =>
      a.kind === 'eth' ? fetchEvmBalance(evmOf(a).rpc, wallet.evm).then((r) => r.value) : fetchErc20Balance(evmOf(a).rpc, a.contract ?? '', wallet.evm);
    try {
      const [base, quote] = await Promise.all([read(market.base), read(market.quote)]);
      setBalances({ base, quote });
    } catch {
      /* the form still works; the amount is checked again when the order is quoted */
    }
  }, [market, wallet]);
  useEffect(() => {
    setBalances(null);
    void loadBalances();
  }, [loadBalances]);

  const update = (next: Trade[]) => {
    setTrades(next);
    saveTrades(wallet.evm, next);
  };

  const onSwapped = (r: SwapResult) => {
    const now = Math.floor(Date.now() / 1000);
    const closes = trades.find((x) => x.id === ticket?.closes);
    // Only the reverse swap closes a trade.
    if (closes && r.from.id === closes.toId && r.to.id === closes.fromId) {
      update(trades.map((x) => (x.id === closes.id ? { ...x, closed: { time: now, tx: r.tx, amountBack: r.amountOut.toString() } } : x)));
    } else {
      update([
        { id: r.tx, time: now, net: r.from.net, fromId: r.from.id, toId: r.to.id, amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString() },
        ...trades,
      ]);
    }
    void loadBalances();
  };

  const bookView = useMemo(() => {
    if (!book) return null;
    const asks = book.asks.slice(0, BOOK_ROWS);
    const bids = book.bids.slice(0, BOOK_ROWS);
    const most = Math.max(...asks.map((l) => l[1]), ...bids.map((l) => l[1]), 0) || 1;
    return { asks: [...asks].reverse(), bids, most };
  }, [book]);

  if (!market) {
    return (
      <section class="panel">
        <h2 class="title">{s.title}</h2>
        <p class="lead">{s.testnet}</p>
      </section>
    );
  }

  const { base, quote } = market;
  const pay = side === 'buy' ? quote : base;
  const get = side === 'buy' ? base : quote;
  const available = balances ? (side === 'buy' ? balances.quote : balances.base) : null;
  const last = ticker?.last ?? candles[candles.length - 1]?.close ?? null;
  const typed = share === 100 ? available : parseUnits(amount, pay.decimals);
  const typedNumber = typed !== null && typed !== undefined ? Number(formatUnits(typed, pay.decimals, pay.decimals)) : 0;
  const estimate = last && typedNumber > 0 ? (side === 'buy' ? typedNumber / last : typedNumber * last) : null;

  const pick = (pct: number) => {
    setError('');
    setShare(pct);
    if (available !== null) setAmount(formatUnits((available * BigInt(pct)) / 100n, pay.decimals, pay.decimals));
  };

  const submit = (e: Event) => {
    e.preventDefault();
    setError('');
    if (share === 100) return setTicket({ fromId: pay.id, toId: get.id, all: true });
    const value = parseUnits(amount, pay.decimals);
    if (value === null || value <= 0n) return setError(t.swap.badAmount);
    if (available !== null && value > available) return setError(t.swap.noFunds);
    setTicket({ fromId: pay.id, toId: get.id, amount: value });
  };

  const open = trades.filter((x) => !x.closed);
  const closed = trades.filter((x) => x.closed);

  const tradeRow = (trade: Trade) => {
    const from = asset(trade.fromId);
    const to = asset(trade.toId);
    if (!from || !to) return null;
    const ret = tradeReturn(trade, from, to, prices);
    return (
      <tr key={trade.id}>
        <td>
          <span class="asset-name">
            <CoinIcon ticker={to.ticker} />
            <span>
              {to.ticker}/{from.ticker}
              <span class="dim asset-usd">{trade.net}</span>
            </span>
          </span>
        </td>
        <td>
          {units(to, trade.amountOut)} {to.ticker}
          <span class="dim asset-usd">
            {s.forCoin} {units(from, trade.amountIn)} {from.ticker}
          </span>
        </td>
        <td>
          {priceText(entryPrice(trade, from, to))}
          <span class="dim asset-usd">{new Date(trade.time * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </td>
        <td>
          {trade.closed ? (
            <>
              {units(from, trade.closed.amountBack)} {from.ticker}
              <span class="dim asset-usd">{s.gotBack}</span>
            </>
          ) : prices ? (
            <>
              ≈ {amountText(tradeWorth(trade, from, to, prices))} {from.ticker}
              <span class="dim asset-usd">{s.worthNow}</span>
            </>
          ) : (
            <Spinner />
          )}
        </td>
        <td class={`trade-return ${ret !== null && ret >= 0 ? 'up' : 'down'}`}>{ret === null ? <Spinner /> : percent(ret)}</td>
        <td class="term-actions">
          <a class="btn btn--small" href={evmOf(from).explorerTx(trade.closed?.tx ?? trade.id)} target="_blank" rel="noopener noreferrer">
            tx
          </a>
          {trade.closed ? (
            <button class="btn btn--small" onClick={() => update(trades.filter((x) => x.id !== trade.id))}>
              {s.remove}
            </button>
          ) : (
            <button
              class="btn btn--small btn--accent"
              onClick={() => {
                setTicket({ fromId: trade.toId, toId: trade.fromId, amount: BigInt(trade.amountOut), closes: trade.id });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              {s.close}
            </button>
          )}
        </td>
      </tr>
    );
  };

  const tradeTable = (list: Trade[]) => (
    <div class="term-scroll">
      <table class="term-table">
        <thead>
          <tr>
            <th>{s.pair}</th>
            <th>{s.size}</th>
            <th>{s.entry}</th>
            <th>{s.now}</th>
            <th>{s.result}</th>
            <th />
          </tr>
        </thead>
        <tbody>{list.map(tradeRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div class="terminal">
      <section class="panel term-bar">
        <div class="term-market">
          <button class="term-pick" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
            <CoinIcon ticker={base.ticker} />
            <span>
              {base.ticker}/{quote.ticker}
              <span class="dim asset-usd">{base.net}</span>
            </span>
            <span class="dim">{picking ? '▴' : '▾'}</span>
          </button>
          {picking && (
            <ul class="term-markets" role="listbox">
              {MARKETS.map((m) => (
                <li key={m.id}>
                  <button
                    role="option"
                    aria-selected={m.id === market.id}
                    onClick={() => {
                      setMarket(m);
                      setPicking(false);
                      setAmount('');
                      setShare(null);
                      setError('');
                    }}
                  >
                    <span>
                      {m.base.ticker}/{m.quote.ticker}
                    </span>
                    <span class="dim">{m.base.net}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div class="term-last">
          <span class={`big big--small ${ticker && ticker.change < 0 ? 'down' : 'up'}`}>{last !== null ? priceText(last) : <Spinner />}</span>
          <span class={ticker && ticker.change < 0 ? 'down' : 'up'}>{ticker ? percent(ticker.change) : ''}</span>
        </div>
        <dl class="term-stats">
          <div>
            <dt>{s.high24}</dt>
            <dd>{ticker ? priceText(ticker.high) : '—'}</dd>
          </div>
          <div>
            <dt>{s.low24}</dt>
            <dd>{ticker ? priceText(ticker.low) : '—'}</dd>
          </div>
          <div>
            <dt>
              {s.vol24}, {quote.ticker}
            </dt>
            <dd>{ticker ? compact(ticker.quoteVolume) : '—'}</dd>
          </div>
          <div>
            <dt>{s.feed}</dt>
            <dd class={live ? 'up' : 'down'}>
              <span class={`term-dot ${live ? 'term-dot--live' : ''}`} /> {live ? s.live : s.offline}
            </dd>
          </div>
        </dl>
      </section>

      <div class="term-grid">
        <section class="panel term-chart">
          <div class="term-tools">
            <span class="periods" role="tablist">
              {INTERVALS.map((i, index) => (
                <button key={i} role="tab" aria-selected={i === interval} class="period" onClick={() => setIntervalId(i)}>
                  {s.intervals[index]}
                </button>
              ))}
            </span>
            <span class="periods">
              <button class="period" aria-pressed={options.kind === 'candles'} onClick={() => setOptions((o) => ({ ...o, kind: o.kind === 'candles' ? 'line' : 'candles' }))}>
                {options.kind === 'candles' ? s.candles : s.line}
              </button>
              <button class="period" aria-pressed={options.ma7} onClick={() => setOptions((o) => ({ ...o, ma7: !o.ma7 }))}>
                MA7
              </button>
              <button class="period" aria-pressed={options.ma25} onClick={() => setOptions((o) => ({ ...o, ma25: !o.ma25 }))}>
                MA25
              </button>
              <button class="period" aria-pressed={options.volume} onClick={() => setOptions((o) => ({ ...o, volume: !o.volume }))}>
                {s.volume}
              </button>
            </span>
          </div>
          {candles.length > 1 ? (
            <CandleChart candles={candles} options={options} />
          ) : (
            <div class="candles candles--wait" role="status">
              {down ? s.noData : <Spinner />}
            </div>
          )}
        </section>

        <div class="term-side">
          {ticket ? (
            <Swap
              key={`${ticket.fromId}:${ticket.toId}:${ticket.amount ?? 'all'}`}
              t={t}
              wallet={wallet}
              prices={prices}
              initial={ticket}
              onSwapped={onSwapped}
              onClose={(done) => {
                setTicket(null);
                if (done) {
                  setAmount('');
                  setShare(null);
                }
              }}
            />
          ) : (
            <form class="panel term-order" autocomplete="off" onSubmit={submit}>
              <div class="seg" role="tablist">
                <button type="button" role="tab" aria-selected={side === 'buy'} class="seg-item" onClick={() => (setSide('buy'), setAmount(''), setShare(null), setError(''))}>
                  {s.buy} {base.ticker}
                </button>
                <button type="button" role="tab" aria-selected={side === 'sell'} class="seg-item" onClick={() => (setSide('sell'), setAmount(''), setShare(null), setError(''))}>
                  {s.sell} {base.ticker}
                </button>
              </div>
              <div class="kv">
                <span class="dim">{s.available}</span>
                <span>
                  {available !== null ? units(pay, available) : <Spinner />} {pay.ticker}
                </span>
              </div>
              <label class="field">
                <span class="field-label">
                  {s.amountPay}, {pay.ticker}
                </span>
                <input
                  class="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onInput={(e) => {
                    setAmount(e.currentTarget.value);
                    setShare(null);
                  }}
                />
              </label>
              <div class="term-shares">
                {[25, 50, 75, 100].map((pct) => (
                  <button key={pct} type="button" class="period" aria-pressed={share === pct} disabled={available === null} onClick={() => pick(pct)}>
                    {pct}%
                  </button>
                ))}
              </div>
              <div class="kv">
                <span class="dim">{s.receive}</span>
                <span>
                  {estimate !== null ? `≈ ${amountText(estimate)}` : '—'} {get.ticker}
                </span>
              </div>
              <div class="kv">
                <span class="dim">{s.orderType}</span>
                <span>{s.marketOrder}</span>
              </div>
              {error && (
                <p class="alert" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" class="btn btn--accent btn--wide">
                {side === 'buy' ? s.buy : s.sell} {base.ticker}
              </button>
            </form>
          )}

          <section class="panel term-flow">
            <div class="seg" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'book'} class="seg-item" onClick={() => setTab('book')}>
                {s.book}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'tape'} class="seg-item" onClick={() => setTab('tape')}>
                {s.tape}
              </button>
            </div>
            {tab === 'book' ? (
              bookView ? (
                <div class="term-book">
                  <div class="term-row term-head">
                    <span>
                      {s.price}, {quote.ticker}
                    </span>
                    <span>
                      {s.amount}, {base.ticker}
                    </span>
                  </div>
                  {bookView.asks.map(([price, qty]) => (
                    <div class="term-row term-ask" key={`a${price}`} style={{ '--fill': `${(qty / bookView.most) * 100}%` }}>
                      <span>{priceText(price)}</span>
                      <span>{amountText(qty)}</span>
                    </div>
                  ))}
                  <div class="term-row term-mid">
                    <span>{last !== null ? priceText(last) : '—'}</span>
                    <span class="dim">
                      {bookView.asks.length && bookView.bids.length
                        ? `${s.spread} ${priceText((bookView.asks[bookView.asks.length - 1] as [number, number])[0] - (bookView.bids[0] as [number, number])[0])}`
                        : ''}
                    </span>
                  </div>
                  {bookView.bids.map(([price, qty]) => (
                    <div class="term-row term-bid" key={`b${price}`} style={{ '--fill': `${(qty / bookView.most) * 100}%` }}>
                      <span>{priceText(price)}</span>
                      <span>{amountText(qty)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p class="dim">{down ? s.noData : <Spinner />}</p>
              )
            ) : (
              <div class="term-book">
                <div class="term-row term-head term-row--three">
                  <span>{s.time}</span>
                  <span>{s.price}</span>
                  <span>{s.amount}</span>
                </div>
                {tape.map((tr, i) => (
                  <div class={`term-row term-row--three ${tr.sell ? 'down' : 'up'}`} key={`${tr.time}:${i}`}>
                    <span class="dim">{clock(tr.time)}</span>
                    <span>{priceText(tr.price)}</span>
                    <span>{amountText(tr.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <section class="panel">
        <h2 class="label">{s.openTrades}</h2>
        {open.length === 0 ? <p class="dim">{s.noTrades}</p> : tradeTable(open)}
      </section>
      {closed.length > 0 && (
        <section class="panel">
          <h2 class="label">{s.closedTrades}</h2>
          {tradeTable(closed)}
        </section>
      )}
      <p class="note">{s.howCounted}</p>
      <p class="note">{s.dataNote}</p>
    </div>
  );
}
