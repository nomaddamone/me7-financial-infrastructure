import { useEffect, useState } from 'preact/hooks';
import { formatUnits } from '../net/balances.ts';
import { CROSS, NET } from '../net/endpoints.ts';
import { RelayError } from '../net/relay.ts';
import type { UsdPrices } from '../net/send.ts';
import { evmOf, type AssetDef } from './assets.ts';
import { ownAddress, planBridge, startBridge, type BridgePlan, type Bridging } from './bridge.ts';
import { SentFilm } from './hold.tsx';
import { Spinner } from './fx.tsx';
import { relayErrorText } from './home.tsx';
import type { Dict } from './i18n.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

/**
 * A swap between networks, from its price to the moment what is given has left (see src/app/bridge.ts).
 */
export function Bridge({
  t,
  wallet,
  prices,
  order,
  onClose,
}: {
  t: Dict;
  wallet: Wallet;
  prices: UsdPrices | null;
  order: { from: AssetDef; to: AssetDef; units: bigint | null };
  onClose: (done: boolean) => void;
}) {
  const b = t.bridge;
  const [plan, setPlan] = useState<BridgePlan | null>(null);
  const [record, setRecord] = useState<Bridging | null>(null);
  const [step, setStep] = useState<'pricing' | 'review' | 'sending' | 'working'>('pricing');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  // The amount is there only in the stealth pocket and the ordinary one together: the user is asked before they are joined.
  const [askMix, setAskMix] = useState(false);

  const { from, to } = order;
  const text = (a: AssetDef, units: bigint) => `${formatUnits(units, a.decimals, a.shown)} ${a.ticker}`;
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price])}` : '');
  const why = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    if (err instanceof RelayError) return err.code === 'small' ? b.errSmall : err.code === 'pending' ? t.ethless.pending : err.code === 'busy' || err.code === 'empty' ? b.errBusy : relayErrorText(t, err);
    if (m === 'tron-min' || /minimum swap amount/i.test(m)) return b.errTronMin.replace('{min}', formatUnits(CROSS.tronSwapMin, 6, 0));
    return m === 'no-funds' ? t.swap.noFunds : m === 'no-gas' ? t.swap.noGas : m === 'moved' ? b.errMoved : m === 'too dear' ? b.errDear : m === 'unsaved' ? b.errUnsaved : m === 'needs-mix' ? b.mixAsk : m === 'too-many' ? t.gasless.tooMany : m === 'no-relay' ? t.gasless.unavailable : `${b.errOther} ${m.slice(0, 140)}`.trim();
  };

  const price = async (mix = false) => {
    if (!prices) return;
    setError('');
    setAskMix(false);
    setStep('pricing');
    try {
      setPlan(await planBridge(wallet, order.from, order.to, order.units, prices, mix));
      setStep('review');
    } catch (err) {
      if (err instanceof Error && err.message === 'needs-mix') return setAskMix(true);
      setError(why(err));
    }
  };
  // The price is asked once, when the screen opens with an order.
  useEffect(() => {
    void price();
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

  if (!from || !to) return null;

  // What was given has left for the crossing service. From here it needs nothing from the wallet: the result arrives by itself.
  if (step === 'working' && record) {
    return (
      <section class="panel hold">
        <SentFilm />
        <h2 class="title">{b.sentTitle}</h2>
        <p class="lead">{b.sentLead
            .replace('{coin}', `${to.ticker} ${to.net}`)
            .replace('{to}', short(ownAddress(wallet, to)))
            .replace('{time}', !plan || plan.quote.seconds < 90 ? b.sentQuick : b.minutes.replace('{n}', String(Math.round(plan.quote.seconds / 60))))}</p>
        <p class="note">{b.sentNote}</p>
        {record.tx && (
          <a class="btn" href={(plan?.way === 'tron' ? NET.tron.explorerTx : evmOf(from).explorerTx)(record.tx)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        <button class="btn btn--accent" onClick={() => onClose(true)}>
          {t.done}
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
      {askMix && <p class="alert">{b.mixAsk}</p>}
      {step === 'pricing' && !error && !askMix && (
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
            {plan.way === 'own' ? (
              <>
                <dt>{t.feeUpTo}</dt>
                <dd>
                  {formatUnits(plan.gas, 18, 6)} eth
                  <span class="dim">{prices ? ` ≈ ${usdFormat.format(Number(formatUnits(plan.gas, 18, 18)) * prices.eth)}` : ''}</span>
                </dd>
              </>
            ) : (
              <>
                <dt>{t.gasless.feeLabel}</dt>
                <dd>
                  {text(from, plan.fee)}
                  <span class="dim">{usd(from, plan.fee)}</span>
                </dd>
              </>
            )}
          </dl>
          <p class="note">{plan.way === 'own' ? b.reviewNote : b.reviewNoteService}</p>
          {plan.mixed && <p class="alert">{t.pockets.reviewMix}</p>}
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
        ) : askMix ? (
          <button class="btn btn--accent" onClick={() => void price(true)}>
            {b.mixAgree}
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
