import { useEffect, useState } from 'preact/hooks';
import { networkOfAddress, readRiskReport } from '../core/aml.ts';
import { planFromPockets, type PaymentPlan } from '../core/rotation.ts';
import { AML, NET } from '../net/endpoints.ts';
import { AmlError, fetchRelayPricing, relayAml } from '../net/relay.ts';
import { loadRotation } from './addresses.ts';
import { Spinner } from './fx.tsx';
import { announcePlan, relayErrorText, signPlan } from './home.tsx';
import type { Dict } from './i18n.ts';
import { markTold } from './quarantine.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

/** Sums of a few dollars at most, always shown to the cent. */
const money = (units: bigint) => (Number(units) / 1e6).toFixed(2);
/** The networks of the Ethereum kind an address can be asked about: the address alone does not say which. */
const EVM_CHAINS = AML.chains.filter((c) => c !== 'tron' && c !== 'bitcoin');

/** A payment that went through without a report coming: kept in this browser so the question can be asked again, free. */
interface Ticket {
  ticket: string;
  chain: string;
  address: string;
  until: number;
}
const ticketKey = (wallet: Wallet) => `me7.aml.${NET.mode}.${wallet.evm.toLowerCase()}`;
function loadTicket(wallet: Wallet): Ticket | null {
  try {
    const t = JSON.parse(localStorage.getItem(ticketKey(wallet)) ?? 'null') as Ticket | null;
    return t && typeof t.ticket === 'string' && typeof t.chain === 'string' && typeof t.address === 'string' && t.until > Date.now() ? t : null;
  } catch {
    return null;
  }
}
function saveTicket(wallet: Wallet, ticket: Ticket | null): void {
  try {
    if (ticket) localStorage.setItem(ticketKey(wallet), JSON.stringify(ticket));
    else localStorage.removeItem(ticketKey(wallet));
  } catch {
    /* the ticket then lives for this screen only */
  }
}

/**
 * A risk report on any address: the user's own or somebody else's (see AML in endpoints.ts).
 * The address is typed in or handed over from the send screen; the report is bought from a
 * screening service and paid for in USDC on Base, through me7's service.
 */
export function AmlCheck({ t, wallet, initial = '', onClose }: { t: Dict; wallet: Wallet; initial?: string; onClose: () => void }) {
  const a = t.aml;
  const [address, setAddress] = useState(initial);
  const [evmChain, setEvmChain] = useState<string>('ethereum');
  const [step, setStep] = useState<'form' | 'pricing' | 'review' | 'working' | 'report'>('form');
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<unknown>(null);
  const [raw, setRaw] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(() => loadTicket(wallet));
  useEffect(() => saveTicket(wallet, ticket), [ticket]);

  const asked = address.trim();
  const kind = networkOfAddress(asked);
  const chain = kind === 'evm' ? evmChain : kind;

  const price = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!chain) return setError(a.badAddress);
    setStep('pricing');
    try {
      const [rotation, pricing] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
      if (!pricing) throw new Error(t.gasless.unavailable);
      // From one pocket, the ordinary one first: a twenty-cent payment is no reason to tie addresses together.
      const planned = planFromPockets(rotation.spendable, [{ to: AML.payTo, value: AML.price }], pricing, rotation.fresh, { prefer: 'plain', choice: 'auto', mix: false });
      if (typeof planned === 'string') throw new Error(a.noFunds.replace('{sum}', money(AML.price + pricing.base)));
      announcePlan(planned.plan);
      setPlan(planned.plan);
      setConfirm('');
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : a.errOther);
      setStep('form');
    }
  };

  const ask = async (paid: { plan: PaymentPlan } | { ticket: Ticket }) => {
    setError('');
    setStep('working');
    const about = 'ticket' in paid ? paid.ticket : { chain: chain ?? '', address: asked };
    try {
      const got = await relayAml(about.chain, about.address, 'ticket' in paid ? { ticket: paid.ticket.ticket } : { payment: signPlan(wallet, paid.plan) });
      setTicket(null);
      setAddress(about.address);
      setReport(got.report);
      setStep('report');
    } catch (err) {
      if (err instanceof AmlError && err.ticket) {
        // The payment went through and the report did not come: the same question can be asked again, free.
        setTicket({ ticket: err.ticket, chain: about.chain, address: about.address, until: Date.now() + 86_400_000 });
        setError(a.failed);
      } else {
        if (err instanceof AmlError && err.code === 'held' && err.address && /^0x[0-9a-fA-F]{40}$/.test(err.address) && err.address.toLowerCase() === wallet.evm.toLowerCase()) markTold(wallet, 'base', err.address);
        setError(err instanceof AmlError && err.code === 'bad-ticket' ? a.ticketGone : relayErrorText(t, err));
        if (err instanceof AmlError && err.code === 'bad-ticket') setTicket(null);
      }
      setStep('ticket' in paid ? 'form' : 'review');
    }
  };
  const pay = () => {
    if (!plan) return;
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    void ask({ plan });
  };

  if (step === 'pricing' || step === 'working') {
    return (
      <section class="panel" role="status">
        <h2 class="title">{a.title}</h2>
        <p class="dim">
          <Spinner /> {step === 'working' ? a.working : t.preparing}
        </p>
      </section>
    );
  }

  if (step === 'report') {
    const read = readRiskReport(report);
    return (
      <section class="panel">
        <h2 class="title">{a.title}</h2>
        <dl class="review">
          <dt>{a.address}</dt>
          <dd class="review-addr">{asked}</dd>
          <dt>{a.score}</dt>
          <dd class="review-total">{read.score === null ? '—' : read.score}</dd>
          <dt>{a.found}</dt>
          <dd>{read.indicators.length > 0 ? read.indicators.join(', ') : a.foundNone}</dd>
        </dl>
        {read.score === null && <p class="note">{a.scoreNone}</p>}
        <p class="note">{a.disclaimer}</p>
        <button type="button" class="linklike" onClick={() => setRaw((v) => !v)}>
          {a.raw}
        </button>
        {raw && <pre class="aml-raw">{JSON.stringify(report, null, 2)}</pre>}
        <div class="row">
          <button
            class="btn"
            onClick={() => {
              setAddress('');
              setReport(null);
              setRaw(false);
              setStep('form');
            }}
          >
            {a.another}
          </button>
          <button class="btn btn--accent" onClick={onClose}>
            {t.done}
          </button>
        </div>
      </section>
    );
  }

  if (step === 'review' && plan && chain) {
    return (
      <section class="panel">
        <h2 class="title">{a.title}</h2>
        <dl class="review">
          <dt>{a.address}</dt>
          <dd class="review-addr">{asked}</dd>
          <dt>{a.network}</dt>
          <dd>{chain}</dd>
          <dt>{a.price}</dt>
          <dd>{money(AML.price)} usdc</dd>
          <dt>{t.gasless.feeLabel}</dt>
          <dd>{money(plan.fee)} usdc</dd>
          <dt>{a.total}</dt>
          <dd class="review-total">
            {money(AML.price + plan.fee)} usdc <span class="dim">base</span>
          </dd>
        </dl>
        <p class="note">{a.privacy}</p>
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && pay()} />
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" onClick={() => (setError(''), setStep('form'))}>
            {t.back}
          </button>
          <button class="btn btn--accent" onClick={pay}>
            {a.check}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void price(e)}>
      <h2 class="title">{a.title}</h2>
      <p class="note">{a.lead}</p>
      {ticket && (
        <p class="note">
          {a.ticketNote.replace('{address}', `${ticket.address.slice(0, 8)}…${ticket.address.slice(-6)}`)}{' '}
          <button type="button" class="linklike" onClick={() => void ask({ ticket })}>
            {a.retry}
          </button>
        </p>
      )}
      <label class="field">
        <span class="field-label">{a.address}</span>
        <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} value={address} onInput={(e) => (setAddress(e.currentTarget.value), setError(''))} />
      </label>
      {kind === 'evm' && (
        <div class="field">
          <span class="field-label">{a.network}</span>
          <span class="chips" role="radiogroup" aria-label={a.network}>
            {EVM_CHAINS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={evmChain === c} class={evmChain === c ? 'chip chip--on' : 'chip'} onClick={() => setEvmChain(c)}>
                {c}
              </button>
            ))}
          </span>
        </div>
      )}
      {kind && kind !== 'evm' && (
        <p class="note">
          {a.network}: {kind}
        </p>
      )}
      <p class="note">{a.costs.replace('{price}', money(AML.price))}</p>
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={onClose}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent">
          {t.next}
        </button>
      </div>
    </form>
  );
}
