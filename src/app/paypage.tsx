import type preact from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { buildPayText } from '../core/payqr.ts';
import { PAY_ORIGINS, refundFor, type PayAsk, type PayOrigin, type PayQuote } from '../core/payrequest.ts';
import { formatUnits } from '../net/balances.ts';
import { fetchCrossState } from '../net/cross.ts';
import { CROSS, NET } from '../net/endpoints.ts';
import { fetchPayQuote } from '../net/payrequest.ts';
import { fetchErc20Balance, fetchUsdPrices, type UsdPrices } from '../net/send.ts';
import type { CrossState } from '../core/cross.ts';
import { Spinner } from './fx.tsx';
import { CopyButton, Qr } from './home.tsx';
import type { Dict } from './i18n.ts';
import { AddressCode, AddressLine } from './payqr.tsx';
import { scanHoldings } from '../net/rotation.ts';
import './paypage.css';

/**
 * The page a request for payment opens on (see src/core/payrequest.ts). It needs no wallet and no account: whoever
 * has the link reads what is asked, and pays it with USDC on Base straight to the address, or with another coin
 * through the crossing service, which is asked from this page for an address to pay to.
 *
 * me7's own services take no part: nothing here goes through them, and no fee of me7's is taken.
 */
const WINDOW_MS = 30 * 60_000;
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PayPage({ t, ask, onLeave }: { t: Dict; ask: PayAsk; onLeave: () => void }) {
  const r = t.request;
  const sum = formatUnits(ask.amount, 6, 2);
  const [prices, setPrices] = useState<UsdPrices | null>(null);
  const [way, setWay] = useState<'direct' | PayOrigin | null>(null);
  const [refund, setRefund] = useState('');
  const [rough, setRough] = useState<{ id: string; quote: PayQuote | null; why: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The order placed for real: the address to pay to, how much, and until when it holds.
  const [placed, setPlaced] = useState<{ origin: PayOrigin; quote: PayQuote; deposit: string; until: number; refundTo: string } | null>(null);
  const [state, setState] = useState<CrossState | null>(null);
  const [now, setNow] = useState(Date.now());
  // Paying straight: what the address held when the page opened, and whether the amount has come on top of it.
  const [arrived, setArrived] = useState(false);
  // What the address shows of the past: money on it that covers the request, or a transfer it has already made.
  const [settled, setSettled] = useState(false);
  // The payer's own refund address is asked for only when wanted, or when there is no other.
  const [ownRefund, setOwnRefund] = useState(false);
  // Each press on a coin asks its price anew, also after an answer that never came.
  const [asks, setAsks] = useState(0);

  useEffect(() => void fetchUsdPrices().then(setPrices, () => undefined), []);
  useEffect(() => {
    const base = NET.base;
    if (!base) return;
    void scanHoldings(base.rpc, base.usdc, [{ index: 0, address: ask.to }]).then(
      ([h]) => h && (h.balance >= ask.amount || h.spent) && setSettled(true),
      () => undefined,
    );
  }, [ask]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const origin = way && way !== 'direct' ? way : null;
  const usdOf = (o: PayOrigin) => (o.price && prices ? prices[o.price] : undefined);
  const why = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    if (/minimum swap amount/i.test(m)) return r.errSmall;
    return m === 'no price' ? r.errPrice : m === 'too dear' ? r.errDear : m === 'no deposit address' || m === 'malformed quote' || m === 'no quote' || m === 'the answer is to another order' || m === 'not the amount ordered' ? r.errOdd : `${r.errDown} ${m.slice(0, 120)}`.trim();
  };

  // What the coin chosen would cost, asked without binding anyone, as soon as it is chosen.
  useEffect(() => {
    if (!origin || placed) return;
    let live = true;
    setRough(null);
    // The price does not depend on where a refund would go: any address of the right kind serves for asking it.
    const stand = refundFor(ask, origin, '') ?? (origin.chain === 'tron' ? 'TMkkPBi7UcHb3SGTpxqTFFKF52e4cm95Vo' : origin.chain === 'btc' ? 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' : ask.to);
    void fetchPayQuote(CROSS.api, ask, origin, stand, Date.now() + WINDOW_MS, CROSS.slippageBps, true, usdOf(origin)).then(
      (quote) => live && setRough({ id: origin.id, quote, why: '' }),
      (err: unknown) => live && setRough({ id: origin.id, quote: null, why: why(err) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.id, asks, !!prices, !!placed]);

  // Paying straight: the page watches the address and says when the amount has come.
  useEffect(() => {
    if (way !== 'direct' || !NET.base || arrived) return;
    const base = NET.base;
    let live = true;
    let before: bigint | null = null;
    const look = () =>
      void fetchErc20Balance(base.rpc, base.usdc, ask.to).then(
        (held) => {
          if (!live) return;
          if (before === null) before = held;
          else if (held >= before + ask.amount) setArrived(true);
        },
        () => undefined,
      );
    look();
    const id = setInterval(look, 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [way, arrived, ask]);

  // An order placed: the service is asked where it stands until it says the money was delivered or sent back.
  useEffect(() => {
    if (!placed || state === 'done' || state === 'refunded' || state === 'failed') return;
    let live = true;
    const look = () => void fetchCrossState(CROSS.api, placed.deposit).then((s) => live && s && setState(s));
    const id = setInterval(look, 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [placed, state]);

  const place = async () => {
    if (!origin || busy) return;
    setError('');
    const refundTo = refundFor(ask, origin, refund);
    if (!refundTo) return setError(refund.trim() ? r.badRefund.replace('{net}', origin.net) : r.needRefund.replace('{net}', origin.net));
    setBusy(true);
    try {
      const until = Date.now() + WINDOW_MS;
      const quote = await fetchPayQuote(CROSS.api, ask, origin, refundTo, until, CROSS.slippageBps, false, usdOf(origin));
      if (!quote.deposit) throw new Error('no deposit address');
      setState(null);
      setPlaced({ origin, quote, deposit: quote.deposit, until, refundTo });
    } catch (err) {
      setError(why(err));
    } finally {
      setBusy(false);
    }
  };

  const lapsed = ask.until !== undefined && now > ask.until * 1000;
  const shell = (body: preact.ComponentChildren) => (
    <section class="panel pay">
      <header class="pay-hero">
        <h2 class="title pay-title">{r.payTitle}</h2>
        <p class="pay-sum" aria-label={`${sum} USDC`}>
          <span class="pay-digits">{sum}</span>
          <span class="pay-unit">
            USDC <span class="dim">base</span>
          </span>
        </p>
        {ask.note && <p class="pay-note">{ask.note}</p>}
      </header>
      <div class="pay-to">
        {/* The address itself is shown only to a payer who pays it directly. Its code gives nothing away, and is what the payer checks the link by. */}
        <AddressCode t={t} address={ask.to} />
        <p class="note">{r.payCodeNote}</p>
      </div>
      <div class="pay-body">{body}</div>
      <footer class="pay-foot">
        <p class="note">{r.notMe7}</p>
        <button type="button" class="linklike" onClick={onLeave}>
          {r.open}
        </button>
      </footer>
    </section>
  );

  // A request that has had its payment, or whose time has passed, offers nothing to pay with. A payment already on its way is still followed.
  if (!placed && (settled || lapsed)) {
    return shell(
      <p class={settled ? 'pay-done' : 'alert'} role="status">
        {settled ? r.settled : r.lapsed}
      </p>,
    );
  }

  if (placed) {
    const o = placed.origin;
    const left = placed.until - now;
    const amount = formatUnits(placed.quote.amountIn, o.decimals, o.decimals);
    const over = state === 'done' || state === 'refunded' || state === 'failed';
    return shell(
      <>
        {state === 'done' ? (
          <p class="pay-done" role="status">
            {r.stDone.replace('{sum}', sum)}
          </p>
        ) : state === 'refunded' || state === 'failed' ? (
          <p class="alert" role="status">
            {state === 'refunded' ? r.stRefunded : r.stFailed} <code>{placed.refundTo}</code>
          </p>
        ) : (
          <>
            <div class="pay-due">
              <span class="field-label">{r.sendExact}</span>
              <span class="pay-due-sum">
                {amount} <b>{o.ticker}</b> <span class="dim">{o.net.toLowerCase()}</span>
              </span>
              <CopyButton t={t} value={amount} />
            </div>
            <span class="field-label">{r.sendTo.replace('{net}', o.net)}</span>
            <Qr text={o.chain === 'evm' ? placed.deposit : buildPayText({ network: o.chain, address: placed.deposit })} />
            <AddressLine t={t} address={placed.deposit} />
            <div class="pay-timer" role="timer">
              <progress class="pay-bar" max={WINDOW_MS} value={Math.max(0, left)} />
              <span class={left > 0 ? 'pay-clock' : 'pay-clock bad'}>{left > 0 ? r.timeLeft.replace('{time}', clock(left)) : r.expired}</span>
            </div>
            <p class="pay-state" role="status">
              <Spinner /> {state === 'working' ? r.stWorking : r.stWaiting}
            </p>
            <p class="alert">{r.oneTime.replace('{net}', o.net).replace('{coin}', o.ticker)}</p>
            <p class="note">
              {r.surplus} <code>{placed.refundTo}</code>
            </p>
            <p class="note">{r.viaLead}</p>
          </>
        )}
        {!over && left > 0 && <p class="note">{r.backNote}</p>}
        <button class="btn" onClick={() => (setPlaced(null), setState(null), setWay(null))}>
          {r.again}
        </button>
      </>,
    );
  }

  if (way === 'direct') {
    return shell(
      <>
        {arrived ? (
          <p class="pay-done" role="status">
            {r.directGot}
          </p>
        ) : (
          <>
            <p class="lead">{r.directLead.replace('{sum}', sum)}</p>
            <span class="field-label">{r.payTo}</span>
            <Qr text={NET.base ? buildPayText({ network: 'evm', address: ask.to, chainId: NET.base.chainId, asset: 'usdc-base', amount: formatUnits(ask.amount, 6, 6) }) : ask.to} />
            <AddressLine t={t} address={ask.to} />
            <p class="pay-state" role="status">
              <Spinner /> {r.directWait}
            </p>
          </>
        )}
        <button class="btn" onClick={() => (setWay(null), setArrived(false))}>
          {r.again}
        </button>
      </>,
    );
  }

  const tooSmall = (o: PayOrigin) => o.least !== undefined && ask.amount < o.least;
  const known = origin && rough && rough.id === origin.id ? rough : null;
  const owed = origin ? refundFor(ask, origin, '') : null;
  return shell(
    <>
      <h3 class="label pay-how">{r.payHow}</h3>
      <ul class="pay-ways">
        <li>
          <button type="button" class="pay-way pay-way--direct" onClick={() => (setError(''), setWay('direct'))}>
            <span class="pay-way-name">
              USDC <span class="dim">base</span>
            </span>
            <span class="pay-way-sub">{r.direct}</span>
          </button>
        </li>
        {PAY_ORIGINS.map((o) => (
          <li key={o.id}>
            <button type="button" class="pay-way" aria-pressed={origin?.id === o.id} disabled={tooSmall(o)} onClick={() => (setError(''), setRefund(''), setOwnRefund(false), setAsks((n) => n + 1), setWay(o))}>
              <span class="pay-way-name">
                {o.ticker} <span class="dim">{o.net.toLowerCase()}</span>
              </span>
              <span class="pay-way-sub">{tooSmall(o) ? r.least.replace('{min}', formatUnits(o.least ?? 0n, 6, 0)) : r.via}</span>
            </button>
          </li>
        ))}
      </ul>
      {origin && (
        <div class="pay-order">
          <p class="note">{r.viaLead}</p>
          <p class="pay-approx" role="status">
            {!known ? <Spinner /> : known.quote ? r.approx.replace('{sum}', formatUnits(known.quote.amountIn, origin.decimals, origin.dollars ? 2 : 6)).replace('{coin}', `${origin.ticker} ${origin.net.toLowerCase()}`) : known.why}
          </p>
          {owed && !ownRefund ? (
            <button type="button" class="linklike pay-own" onClick={() => setOwnRefund(true)}>
              {r.ownRefund}
            </button>
          ) : (
            <label class="field">
              <span class="field-label">{r.refundLabel.replace('{net}', origin.net)}</span>
              <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} value={refund} onInput={(e) => setRefund(e.currentTarget.value)} />
              <span class="dim">{owed ? r.refundOptional : r.refundNeeded}</span>
            </label>
          )}
          {error && (
            <p class="alert" role="alert">
              {error}
            </p>
          )}
          <button class="btn btn--accent" disabled={busy || !known?.quote} onClick={() => void place()}>
            {busy ? <Spinner /> : r.getAddress}
          </button>
        </div>
      )}
    </>,
  );
}
