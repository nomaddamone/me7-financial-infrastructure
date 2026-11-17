import { useEffect, useState } from 'preact/hooks';
import { formatUnits } from '../net/balances.ts';
import type { UsdPrices } from '../net/send.ts';
import { ASSETS, evmOf, type AssetDef } from './assets.ts';
import { followBridge, ownAddress, planBridge, startBridge, type BridgePlan, type Bridging } from './bridge.ts';
import { CrossBar, useCrossProgress } from './crossbar.tsx';
import { Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

/**
 * A swap between networks, from its price to its end (see src/app/bridge.ts). Opened from the swap
 * form with a pair and an amount, or with a swap already under way to show how it ends.
 */
export function Bridge({
  t,
  wallet,
  prices,
  order,
  resume,
  onClose,
}: {
  t: Dict;
  wallet: Wallet;
  prices: UsdPrices | null;
  order?: { from: AssetDef; to: AssetDef; units: bigint | null };
  resume?: Bridging;
  onClose: (done: boolean) => void;
}) {
  const b = t.bridge;
  const [plan, setPlan] = useState<BridgePlan | null>(null);
  const [record, setRecord] = useState<Bridging | null>(resume ?? null);
  const [step, setStep] = useState<'pricing' | 'review' | 'sending' | 'working'>(resume ? 'working' : 'pricing');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const from = order?.from ?? ASSETS.find((a) => a.id === record?.fromId);
  const to = order?.to ?? ASSETS.find((a) => a.id === record?.toId);
  const text = (a: AssetDef, units: bigint) => `${formatUnits(units, a.decimals, a.shown)} ${a.ticker}`;
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price])}` : '');
  const why = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    return m === 'no-funds' ? t.swap.noFunds : m === 'no-gas' ? t.swap.noGas : m === 'moved' ? b.errMoved : m === 'too dear' ? b.errDear : m === 'unsaved' ? b.errUnsaved : `${b.errOther} ${m.slice(0, 140)}`.trim();
  };

  const price = async () => {
    if (!order || !prices) return;
    setError('');
    setStep('pricing');
    try {
      setPlan(await planBridge(wallet, order.from, order.to, order.units, prices));
      setStep('review');
    } catch (err) {
      setError(why(err));
    }
  };
  // The price is asked once, when the screen opens with an order.
  useEffect(() => {
    if (order) void price();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!plan || !prices) return;
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    setError('');
    setStep('sending');
    try {
      setRecord(await startBridge(wallet, plan, prices));
      setStep('working');
    } catch (err) {
      setError(why(err));
      setStep('review');
    }
  };

  // Once the deposit is in the network the service does the rest by itself; the wallet only asks how it stands.
  const open = step === 'working' && record?.stage === 'open';
  useEffect(() => {
    if (!open || !record) return;
    let live = true;
    const id = setInterval(() => {
      void followBridge(wallet, record).then((next) => live && next.stage !== 'open' && setRecord(next));
    }, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [open, record?.id]);
  const { p, seconds } = useCrossProgress(!record ? 'halt' : record.stage === 'open' ? 'cross' : record.stage === 'done' ? 'done' : 'halt', record?.started ?? 0);

  if (!from || !to) return null;

  if (step === 'working' && record) {
    const stops = [from.net, b.stop, to.net] as const;
    return (
      <section class="panel" role="status">
        <h2 class="title">{record.stage === 'done' ? t.swap.doneTitle : b.title}</h2>
        <CrossBar phase={record.stage === 'open' ? 'cross' : record.stage === 'done' ? 'done' : 'halt'} p={p} stops={stops} />
        {record.stage === 'open' && (
          <>
            <p class="cbar-meta">
              {b.working} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </p>
            <p class="note">{b.mayClose}</p>
          </>
        )}
        {record.stage === 'done' && <p class="lead">{b.done.replace('{sum}', record.delivered ? text(to, BigInt(record.delivered)) : `${to.ticker} ${to.net}`).replace('{to}', short(ownAddress(wallet, to)))}</p>}
        {record.stage === 'refunded' && <p class="alert">{b.refunded}</p>}
        {record.stage === 'failed' && <p class="alert">{b.failed.replace('{deposit}', record.deposit)}</p>}
        {record.tx && (
          <a class="btn" href={evmOf(from).explorerTx(record.tx)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        <button class="btn btn--accent" onClick={() => onClose(record.stage === 'done')}>
          {record.stage === 'open' ? t.back : t.done}
        </button>
      </section>
    );
  }

  if (step === 'sending') {
    return (
      <section class="panel" role="status">
        <h2 class="title">{b.title}</h2>
        <p class="lead">
          <Spinner /> {b.sending.replace('{coin}', `${from.ticker} ${from.net}`)}
        </p>
        <p class="alert">{b.stay}</p>
      </section>
    );
  }

  return (
    <section class="panel">
      <h2 class="title">{b.title}</h2>
      <p class="note">{b.trust}</p>
      {step === 'pricing' && !error && (
        <p class="lead" role="status">
          <Spinner /> {b.pricing}
        </p>
      )}
      {step === 'review' && plan && (
        <>
          <dl class="review">
            <dt>{t.swap.youPay}</dt>
            <dd>
              {text(from, plan.amountIn)} <span class="dim">{from.net}</span>
              <span class="dim">{usd(from, plan.amountIn)}</span>
            </dd>
            <dt>{t.swap.youGet}</dt>
            <dd class="review-total">
              ≈ {text(to, plan.quote.amountOut)} <span class="dim">{to.net}</span>
              <span class="dim">{usd(to, plan.quote.amountOut)}</span>
            </dd>
            <dt>{t.swap.atLeast}</dt>
            <dd>{text(to, plan.quote.minOut)}</dd>
            <dt>{b.arrives}</dt>
            <dd>
              <code>{short(ownAddress(wallet, to))}</code> <span class="dim">{b.yours}</span>
            </dd>
            <dt>{b.takes}</dt>
            <dd>{plan.quote.seconds < 90 ? b.aMinute : b.minutes.replace('{n}', String(Math.round(plan.quote.seconds / 60)))}</dd>
            <dt>{t.feeUpTo}</dt>
            <dd>
              {formatUnits(plan.gas, 18, 6)} eth
              <span class="dim">{prices ? ` ≈ ${usdFormat.format(Number(formatUnits(plan.gas, 18, 18)) * prices.eth)}` : ''}</span>
            </dd>
          </dl>
          <p class="note">{b.reviewNote}</p>
          <label class="field">
            <span class="field-label">{t.confirmPassword}</span>
            <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void run()} />
          </label>
        </>
      )}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
        {step === 'review' && plan ? (
          <button class="btn btn--accent" onClick={() => void run()}>
            {t.swap.confirm}
          </button>
        ) : (
          error && (
            <button class="btn btn--accent" onClick={() => void price()}>
              {b.again}
            </button>
          )
        )}
      </div>
    </section>
  );
}
