import { UsdcElsewhere } from './elsewhere.tsx';
import { hexToBytes } from '@noble/hashes/utils.js';
import { useEffect, useState } from 'preact/hooks';
import { parseUnits } from '../core/index.ts';
import { erc20ApproveData } from '../core/peer.ts';
import { checkSwap, SWAP_NATIVE, SWAP_ROUTER, swapReturned } from '../core/swap.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { NET, SWAP_FEE } from '../net/endpoints.ts';
import { fetchErc20Balance, fetchEvmFees, type UsdPrices } from '../net/send.ts';
import { buildSwap, fetchSwapRoute, fetchTokenAllowance, type SwapRoute } from '../net/swap.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, type AssetDef } from './assets.ts';
import { sendEvmCall } from './evm-call.ts';
import { Spinner } from './fx.tsx';
import { bridgeTargets, estimateBridge, openBridgings, type Bridging } from './bridge.ts';
import { Bridge } from './bridge.tsx';
import type { Dict } from './i18n.ts';
import { CoinButton, CoinList } from './swapform.tsx';
import { quarantineOf } from './quarantine.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

/** Coins that can be swapped: those on a network the aggregator serves. */
export const SWAPPABLE = ASSETS.filter((a) => (a.kind === 'eth' || a.kind === 'erc20') && evmOf(a).swap);

/** How far the price may move against the user before the swap is refused, in hundredths of a percent. */
const SLIPPAGE_BPS = 50;
/**
 * The transaction is built a moment after the quote, and the aggregator works its minimum out from a
 * fresh simulation, so the two differ by a hair. The minimum shown already leaves room for that.
 */
const DRIFT_BPS = 10;
/**
 * Used to keep back enough of the network's coin for the fee when swapping all of it. Nodes
 * on Base estimate swaps far above what they end up using, and the limit has to be covered up front.
 */
const gasCeiling = (a: AssetDef) => (a.chain === 'base' ? 2_000_000n : 900_000n);
const APPROVE_GAS = 120_000n;

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const tokenOf = (a: AssetDef) => (a.kind === 'eth' ? SWAP_NATIVE : (a.contract ?? ''));
const text = (a: AssetDef, units: bigint) => formatUnits(units, a.decimals, a.shown);
const usdOf = (a: AssetDef, units: bigint, prices: UsdPrices | null) =>
  prices ? ` ≈ ${usdFormat.format(Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price])}` : '';

interface Quote {
  from: AssetDef;
  to: AssetDef;
  amount: bigint;
  route: SwapRoute;
  /** The least the wallet will accept; the swap is refused on-chain below it. */
  minOut: bigint;
  feeCeiling: bigint;
}

/** A finished swap, as the trading section records it. */
export interface SwapResult {
  from: AssetDef;
  to: AssetDef;
  amountIn: bigint;
  /** What actually came out, read from the transaction; the quoted amount if that could not be read. */
  amountOut: bigint;
  tx: string;
}

export function Swap({
  t,
  wallet,
  prices,
  onClose,
  embedded = false,
  initial,
  onPair,
  onSwapped,
}: {
  t: Dict;
  wallet: Wallet;
  prices: UsdPrices | null;
  onClose: (done: boolean) => void;
  /** Shown as part of a larger screen: no way "back", and after a swap the form returns. */
  embedded?: boolean;
  /**
   * An order handed over from the trading terminal: the pair and the amount are already chosen
   * there, so the quote is fetched at once and the screen opens on the review. `all` spends the
   * whole balance (less the network fee when the coin itself pays it).
   */
  initial?: { fromId: string; toId: string; amount?: bigint; all?: boolean };
  onPair?: (from: AssetDef, to: AssetDef) => void;
  onSwapped?: (result: SwapResult) => void;
}) {
  const s = t.swap;
  const start = SWAPPABLE.find((a) => a.id === initial?.fromId);
  const [fromId, setFromId] = useState(start?.id ?? SWAPPABLE[0]?.id ?? '');
  const [toId, setToId] = useState(initial?.toId ?? '');
  const [amount, setAmount] = useState(start && initial?.amount !== undefined ? formatUnits(initial.amount, start.decimals, start.decimals) : '');
  const [all, setAll] = useState(initial?.all === true);
  const [view, setView] = useState<'form' | 'review' | 'running' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<'approve' | 'swap'>('swap');
  const [txHash, setTxHash] = useState('');
  // A swap for a coin on another network runs on a screen of its own (see src/app/bridge.tsx).
  const [bridge, setBridge] = useState<{ order?: { from: AssetDef; to: AssetDef; units: bigint | null }; resume?: Bridging } | null>(null);
  const [pending, setPending] = useState<Bridging | null>(() => openBridgings(wallet)[0] ?? null);

  // Which coin list is open, what the wallet holds of each coin, and what the amount typed would buy.
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [estimate, setEstimate] = useState<{ key: string; out: bigint | null } | null>(null);

  const from = SWAPPABLE.find((a) => a.id === fromId) ?? SWAPPABLE[0];
  // A coin is swapped within its own network, or for a coin on another one through the crossing service.
  const here = SWAPPABLE.filter((a) => a.net === from?.net);
  const others = from ? bridgeTargets(from) : [];
  const to = [...here, ...others].find((a) => a.id === toId && a.id !== from?.id) ?? here.find((a) => a.id !== from?.id);
  useEffect(() => {
    // The trading terminal follows pairs within one network only.
    if (from && to && to.net === from.net) onPair?.(from, to);
    // Reported when the pair changes, not on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.id, to?.id]);
  if (!from || !to) return null;
  const chain = evmOf(from);
  const network = chain.swap ?? '';

  useEffect(() => {
    let live = true;
    for (const a of SWAPPABLE) {
      const held = a.kind === 'eth' ? fetchEvmBalance(evmOf(a).rpc, wallet.evm).then((r) => r.value) : fetchErc20Balance(evmOf(a).rpc, a.contract ?? '', wallet.evm);
      void held.then(
        (units) => live && setBalances((known) => ({ ...known, [a.id]: units })),
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [wallet]);

  // What the amount would buy, asked a moment after the typing stops. It binds nobody: the review asks again.
  const wanted = all ? (from.kind === 'eth' ? null : (balances[from.id] ?? null)) : parseUnits(amount, from.decimals);
  const estimateKey = `${from.id}>${to.id}>${wanted ?? ''}`;
  useEffect(() => {
    if (view !== 'form' || bridge || wanted === null || wanted <= 0n) return;
    let live = true;
    const timer = setTimeout(() => {
      const asked = to.net === from.net ? fetchSwapRoute(network, { tokenIn: tokenOf(from), tokenOut: tokenOf(to), amountIn: wanted }).then((r) => r.amountOut) : estimateBridge(wallet, from, to, wanted);
      void asked.then(
        (out) => live && setEstimate({ key: estimateKey, out }),
        () => live && setEstimate({ key: estimateKey, out: null }),
      );
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey, view, !!bridge]);

  const pick = (side: 'from' | 'to', a: AssetDef) => {
    setPicking(null);
    setError('');
    if (side === 'to') return setToId(a.id);
    // The coin given changed: the coin wanted stays if it can still be had for it.
    if (a.id === to.id) setToId(from.id);
    setFromId(a.id);
  };
  const canFlip = SWAPPABLE.some((a) => a.id === to.id);
  const flip = () => {
    if (!canFlip) return;
    setError('');
    setFromId(to.id);
    setToId(from.id);
  };

  const prepare = async (e?: Event) => {
    e?.preventDefault();
    setError('');
    if (to.net !== from.net) {
      const units = all ? null : parseUnits(amount, from.decimals);
      if (!all && (units === null || units <= 0n)) return setError(s.badAmount);
      if (!prices) return setError(t.bridge.errPrice);
      if (NET.base && from.contract === NET.base.usdc && quarantineOf(wallet, 'base', wallet.evm)) return setError(t.held.errSwap);
      return setBridge({ order: { from, to, units } });
    }
    // USDC on a quarantined address is not swapped here: the swap's fee would come to me7 from that address.
    if (NET.base && from.contract === NET.base.usdc && quarantineOf(wallet, 'base', wallet.evm)) return setError(t.held.errSwap);
    setBusy(true);
    try {
      const native = from.kind === 'eth';
      const [coin, fees] = await Promise.all([fetchEvmBalance(chain.rpc, wallet.evm).then((r) => r.value), fetchEvmFees(chain.rpc)]);
      const held = native ? coin : await fetchErc20Balance(chain.rpc, from.contract ?? '', wallet.evm);
      const l1 = from.chain === 'base' ? BASE_L1_RESERVE : 0n;
      // Swapping all of the network's own coin still has to leave enough of it to pay for the swap.
      const spendable = native ? held - gasCeiling(from) * fees.maxFeePerGas - l1 : held;
      const units = all ? spendable : parseUnits(amount, from.decimals);
      if (units === null || units <= 0n) return setError(all ? s.noFunds : s.badAmount);
      if (units > spendable) return setError(s.noFunds);
      const route = await fetchSwapRoute(network, { tokenIn: tokenOf(from), tokenOut: tokenOf(to), amountIn: units });
      const feeCeiling = ((route.gas * 3n) / 2n + (native ? 0n : APPROVE_GAS)) * fees.maxFeePerGas + l1;
      if (feeCeiling > (native ? coin - units : coin)) return setError(s.noGas);
      const minOut = (route.amountOut * BigInt(10_000 - SLIPPAGE_BPS - DRIFT_BPS)) / 10_000n;
      setQuote({ from, to, amount: units, route, minOut, feeCeiling });
      setConfirm('');
      setView('review');
    } catch (err) {
      setError(`${s.quoteFailed} ${err instanceof Error ? err.message.slice(0, 120) : ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!quote) return;
    if (!isSessionPassword(confirm)) {
      setError(t.wrongPassword);
      return;
    }
    setConfirm('');
    setError('');
    setView('running');
    try {
      if (quote.from.kind === 'erc20') {
        setStep('approve');
        const token = quote.from.contract ?? '';
        const allowed = await fetchTokenAllowance(chain.rpc, token, wallet.evm, SWAP_ROUTER);
        if (allowed < quote.amount) {
          // Some tokens (USDT) refuse to change a non-zero permission directly; it is cleared first.
          if (allowed > 0n) await sendEvmCall(chain, wallet, token, erc20ApproveData(SWAP_ROUTER, 0n));
          await sendEvmCall(chain, wallet, token, erc20ApproveData(SWAP_ROUTER, quote.amount));
        }
      }
      setStep('swap');
      const built = await buildSwap(network, quote.route, wallet.evm, SLIPPAGE_BPS);
      // The server built this transaction. Nothing is signed unless it does exactly what was shown.
      checkSwap(built.data, {
        to: built.to,
        value: built.value,
        srcToken: tokenOf(quote.from),
        dstToken: tokenOf(quote.to),
        receiver: wallet.evm,
        amount: quote.amount,
        minReturn: quote.minOut,
        feeReceiver: SWAP_FEE.receiver || null,
        feeBps: SWAP_FEE.receiver ? BigInt(SWAP_FEE.bps) : 0n,
      });
      const receipt = await sendEvmCall(chain, wallet, SWAP_ROUTER, hexToBytes(built.data.slice(2)), built.value);
      setTxHash(receipt.hash);
      setView('done');
      onSwapped?.({
        from: quote.from,
        to: quote.to,
        amountIn: quote.amount,
        amountOut: swapReturned(receipt.logs, { dstToken: tokenOf(quote.to), receiver: wallet.evm }) ?? quote.route.amountOut,
        tx: receipt.hash,
      });
    } catch (err) {
      setError(`${s.runFailed} ${err instanceof Error ? err.message.slice(0, 160) : ''}`.trim());
      setView('review');
    }
  };

  // An order from the terminal goes straight to its quote.
  useEffect(() => {
    if (initial) void prepare();
    // Once, when the order arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The terminal already has its own form: here only the wait for the quote, or why there is none.
  if (initial && view === 'form') {
    return (
      <section class="panel" role="status">
        <h2 class="title">{s.reviewTitle}</h2>
        {error ? (
          <p class="alert" role="alert">
            {error}
          </p>
        ) : (
          <p class="dim">
            <Spinner /> {s.quoting}
          </p>
        )}
        <div class="row">
          <button class="btn" onClick={() => onClose(false)}>
            {t.back}
          </button>
          <button class="btn btn--accent" disabled={busy} onClick={() => void prepare()}>
            {s.retry}
          </button>
        </div>
      </section>
    );
  }

  if (bridge) {
    return (
      <Bridge
        t={t}
        wallet={wallet}
        prices={prices}
        {...bridge}
        onClose={(done) => {
          setBridge(null);
          setPending(openBridgings(wallet)[0] ?? null);
          if (done) {
            setAmount('');
            setAll(false);
            if (!embedded) onClose(true);
          }
        }}
      />
    );
  }

  if (view === 'done') {
    return (
      <section class="panel">
        <h2 class="title">{s.doneTitle}</h2>
        <p class="lead">{s.doneLead}</p>
        {txHash && (
          <a class="btn" href={chain.explorerTx(txHash)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        <button
          class="btn btn--accent"
          onClick={() => {
            if (embedded) {
              setAmount('');
              setAll(false);
              setQuote(null);
              setView('form');
            }
            onClose(true);
          }}
        >
          {t.done}
        </button>
      </section>
    );
  }

  if (view === 'running') {
    const steps = [...(quote?.from.kind === 'erc20' ? [{ id: 'approve', label: s.stepApprove }] : []), { id: 'swap', label: s.stepSwap }];
    const at = steps.findIndex((x) => x.id === step);
    return (
      <section class="panel" role="status">
        <h2 class="title">{s.runningTitle}</h2>
        <ol class="peer-steps">
          {steps.map((x, i) => (
            <li key={x.id} class={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
              <span class="peer-step-mark">{i < at ? '✓' : i === at ? <Spinner /> : '·'}</span>
              {x.label}
            </li>
          ))}
        </ol>
        <p class="note">{s.keepOpen}</p>
      </section>
    );
  }

  if (view === 'review' && quote) {
    return (
      <section class="panel">
        <h2 class="title">{s.reviewTitle}</h2>
        <dl class="review">
          <dt>{s.youPay}</dt>
          <dd>
            {text(quote.from, quote.amount)} {quote.from.ticker} <span class="dim">{quote.from.net}</span>
            <span class="dim">{usdOf(quote.from, quote.amount, prices)}</span>
          </dd>
          <dt>{s.youGet}</dt>
          <dd class="review-total">
            ≈ {text(quote.to, quote.route.amountOut)} {quote.to.ticker}
            <span class="dim">{usdOf(quote.to, quote.route.amountOut, prices)}</span>
          </dd>
          <dt>{s.atLeast}</dt>
          <dd>
            {text(quote.to, quote.minOut)} {quote.to.ticker}
          </dd>
          {SWAP_FEE.receiver && (
            <>
              <dt>{s.ourFee}</dt>
              <dd>
                {(SWAP_FEE.bps / 100).toFixed(2)}% <span class="dim">{s.feeIncluded}</span>
              </dd>
            </>
          )}
          <dt>{t.feeUpTo}</dt>
          <dd>
            {formatUnits(quote.feeCeiling, 18, 6)} eth
            <span class="dim">{prices ? ` ≈ ${usdFormat.format(Number(formatUnits(quote.feeCeiling, 18, 18)) * prices.eth)}` : ''}</span>
          </dd>
        </dl>
        <p class="note">{s.reviewNote}</p>
        {quote.from.kind === 'erc20' && <p class="note">{s.reviewApprove}</p>}
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input
            class="input"
            type="password"
            autocomplete="off"
            value={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
          />
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" onClick={() => (initial ? onClose(false) : setView('form'))}>
            {t.back}
          </button>
          <button class="btn btn--accent" onClick={() => void run()}>
            {s.confirm}
          </button>
        </div>
      </section>
    );
  }

  const typed = all ? null : parseUnits(amount, from.decimals);
  const known = estimate && estimate.key === estimateKey ? estimate : null;
  const giveCoin = <CoinButton asset={from} open={picking === 'from'} label={s.from} onToggle={() => setPicking((p) => (p === 'from' ? null : 'from'))} />;
  const getCoin = <CoinButton asset={to} open={picking === 'to'} label={s.to} onToggle={() => setPicking((p) => (p === 'to' ? null : 'to'))} />;
  const flipButton = (
    <button type="button" class="swapf-flip" disabled={!canFlip} aria-label={s.flip} title={s.flip} onClick={flip}>
      ⇅
    </button>
  );
  const amountInput = (
    <input class="swapf-amount" type="text" inputMode="decimal" aria-label={`${s.amount}, ${from.ticker}`} placeholder={all ? t.sendAllHint : '0.0'} disabled={all} value={all ? '' : amount} onInput={(e) => setAmount(e.currentTarget.value)} />
  );
  const estimateNode =
    wanted === null || wanted <= 0n ? (
      <span class="swapf-est swapf-est--none">0.0</span>
    ) : !known ? (
      <span class="swapf-est swapf-est--none">
        <Spinner />
      </span>
    ) : known.out === null ? (
      <span class="swapf-est swapf-est--none">—</span>
    ) : (
      <span class="swapf-est">≈ {text(to, known.out)}</span>
    );
  const giveSub = (
    <div class="swapf-sub">
      <span aria-live="polite">{typed !== null && typed > 0n && prices ? usdOf(from, typed, prices).trim() : ' '}</span>
      <span>
        {balances[from.id] !== undefined && `${s.balance} ${text(from, balances[from.id] as bigint)} `}
        <button type="button" class="swapf-max" aria-pressed={all} onClick={() => setAll((v) => !v)}>
          {t.sendMax}
        </button>
      </span>
    </div>
  );
  const getSub = (
    <div class="swapf-sub">
      <span>{known?.out && prices ? usdOf(to, known.out, prices).trim() : ' '}</span>
      <span>{balances[to.id] !== undefined && `${s.balance} ${text(to, balances[to.id] as bigint)}`}</span>
    </div>
  );
  const list =
    picking === 'from' ? (
      <CoinList groups={[{ title: '', list: SWAPPABLE }]} chosen={from.id} balances={balances} onPick={(a) => pick('from', a)} />
    ) : picking === 'to' ? (
      <CoinList
        groups={[
          { title: s.sameNet.replace('{net}', from.net), list: here.filter((a) => a.id !== from.id) },
          { title: s.otherNet, list: others },
        ]}
        chosen={to.id}
        balances={balances}
        onPick={(a) => pick('to', a)}
      />
    ) : null;
  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
      <h2 class="title">{s.title}</h2>
      <UsdcElsewhere t={t} wallet={wallet} />
      {pending && (
        <p class="note">
          {t.bridge.pending}{' '}
          <button type="button" class="linklike" onClick={() => setBridge({ resume: pending })}>
            {t.bridge.look}
          </button>
        </p>
      )}
      <div class="swapf">
        <div class="swapf-side">
          <span class="field-label">{s.from}</span>
          <div class="swapf-line">
            {amountInput}
            {giveCoin}
          </div>
          {giveSub}
        </div>
        {flipButton}
        <div class="swapf-side">
          <span class="field-label">{s.to}</span>
          <div class="swapf-line">
            {estimateNode}
            {getCoin}
          </div>
          {getSub}
        </div>
      </div>
      {list}
      {to.net !== from.net && <p class="note">{t.bridge.trust}</p>}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      {embedded ? (
        <button type="submit" class="btn btn--accent btn--wide" disabled={busy}>
          {busy ? <Spinner /> : t.next}
        </button>
      ) : (
        <div class="row">
          <button type="button" class="btn" onClick={() => onClose(false)}>
            {t.back}
          </button>
          <button type="submit" class="btn btn--accent" disabled={busy}>
            {busy ? <Spinner /> : t.next}
          </button>
        </div>
      )}
    </form>
  );
}
