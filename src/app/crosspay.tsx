import { useEffect, useRef, useState } from 'preact/hooks';
import { crossAssetName, crossBudget, type CrossOrder } from '../core/cross.ts';
import { isValidEvmAddress } from '../core/evm.ts';
import { isValidTronAddress, parseUnits } from '../core/index.ts';
import { addressCode, type PayRequest } from '../core/payqr.ts';
import { planFromPockets, pocketTotals, type Pocket } from '../core/rotation.ts';
import { formatUnits } from '../net/balances.ts';
import { fetchCrossQuote, fetchCrossState, tellCrossDeposit } from '../net/cross.ts';
import { CROSS, ETH_GASLESS, NET } from '../net/endpoints.ts';
import { fetchEthGasTerms, fetchRelayPricing, fetchTronQuote } from '../net/relay.ts';
import { fetchTrc20Frozen } from '../net/tron.ts';
import { loadRotation } from './addresses.ts';
import { ASSETS, type AssetDef } from './assets.ts';
import { crossingBalance, dropCrossing, freshEthAddress, freshTronAddress, payOnward, planOnward, saveCrossing, type Crossing, type OnwardPayment } from './crossing.ts';
import { SentFilm, WorkingFilm } from './hold.tsx';
import { Spinner } from './fx.tsx';
import { Hold } from './hold.tsx';
import { announcePlan, relayErrorText, sendPlan } from './home.tsx';
import type { Dict } from './i18n.ts';
import { Scanner } from './payqr.tsx';
import { isSessionPassword, type Wallet } from './wallet.ts';

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
/** Both coins have six decimals and are shown to the cent; a remainder smaller than a cent still shows. */
const money = (units: bigint) => {
  const text = formatUnits(units, 6, 2);
  return units > 0n && text === '0' ? '< 0.01' : text;
};
/** Stands in for the service's address while the price is only being looked at. Nothing is ever sent to it. */
const NOWHERE = '0x000000000000000000000000000000000000dEaD';
/** How often the chain and the service are asked while the money crosses, in milliseconds. */
const EVERY = 6_000;
/** A crossing whose USDC was never seen leaving can be forgotten after this long. */
const FORGET_AFTER = 15 * 60_000;

/** Whether this wallet, in this session, can pay USDT out of USDC at all. */
export const canCross = (wallet: Wallet): boolean => NET.mode === 'mainnet' && !!NET.base && wallet.seed instanceof Uint8Array && wallet.seed.length === 64;

/**
 * Where the payment comes out: the coin and the network the recipient is paid on. USDT on Tron was the first; USDT
 * and USDC on Ethereum go the same way, with an Ethereum address used once and me7's Ethereum service for the second half.
 */
export interface Rail {
  net: 'tron' | 'eth';
  coin: string;
  netName: string;
  /** The token's contract on Ethereum; empty on Tron. */
  token: string;
  /** The crossing service's name for the coin delivered. */
  destination: string;
  /** Whether me7's lower fees for this kind of payment apply (set by the owner for Tron only). */
  discount: boolean;
}
const TRON_RAIL: Rail = { net: 'tron', coin: 'USDT', netName: 'Tron', token: '', destination: CROSS.destination, discount: true };
const ethRail = (a: AssetDef): Rail => ({ net: 'eth', coin: a.ticker.toUpperCase(), netName: 'Ethereum', token: a.contract ?? '', destination: crossAssetName('eth', a.contract), discount: false });

/** The way a coin can be paid out of USDC on Base, if there is one for it in this wallet and session. */
export function railFor(wallet: Wallet, asset: AssetDef): Rail | null {
  if (!canCross(wallet)) return null;
  if (asset.contract === NET.tron.usdt) return TRON_RAIL;
  if (asset.kind === 'erc20' && asset.chain !== 'base' && !!asset.contract && asset.contract.toLowerCase() in ETH_GASLESS.tokens) return ethRail(asset);
  return null;
}
/** The way a payment under way was made. */
export function railOfCrossing(c: Crossing): Rail {
  const asset = c.net === 'eth' ? ASSETS.find((a) => a.chain !== 'base' && a.contract?.toLowerCase() === c.token?.toLowerCase()) : undefined;
  return asset ? ethRail(asset) : TRON_RAIL;
}

/** The texts were written for USDT on Tron; for another coin and network the names in them are changed. */
export function textsFor<T extends Record<string, unknown>>(texts: T, rail: Rail): T {
  if (rail.net === 'tron') return texts;
  const swap = (v: string) => v.replaceAll('Tron', rail.netName).replaceAll('tron', rail.netName.toLowerCase()).replaceAll('USDT', rail.coin).replaceAll('usdt', rail.coin.toLowerCase());
  return Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, typeof v === 'string' ? swap(v) : v])) as T;
}

interface Reviewed {
  to: string;
  amount: bigint;
  fresh: { index: number; address: string };
  order: CrossOrder;
  /** What each part costs: the USDC the crossing takes, me7's fee on Base, the estimate of me7's fee on Tron. */
  usdcIn: bigint;
  /** The least of `usdcIn` the crossing service expects to use; the rest is room it sends back if unused. */
  leastIn: bigint;
  feeBase: bigint;
  feeTron: bigint;
  from: Pocket | 'both';
  joined: number;
  seconds: number;
}

type Phase = 'cross' | 'paying' | 'short' | 'payError' | 'done' | 'refunded' | 'failed' | 'unsent';

/**
 * USDT on Tron paid out of USDC on Base, by way of a Tron address used once. Two halves: the USDC
 * goes to the crossing service, then the USDT that arrived on the new address is paid on. The
 * screen stays with the payment through both, and can be opened again on one left unfinished.
 */
export function CrossPay({
  t,
  wallet,
  initialTo = '',
  initialAmount = '',
  resume,
  rail: asked,
  onPlain,
  onClose,
}: {
  t: Dict;
  wallet: Wallet;
  initialTo?: string;
  initialAmount?: string;
  resume?: Crossing;
  /** Which coin and network the recipient is paid on; USDT on Tron unless said, or whatever the payment resumed was. */
  rail?: Rail;
  /** Back to the ordinary transfer; absent when the screen was opened on an unfinished crossing. */
  onPlain?: (to: string, amount: string) => void;
  onClose: (sent: boolean) => void;
}) {
  const rail = resume ? railOfCrossing(resume) : (asked ?? TRON_RAIL);
  const x = textsFor(t.cross, rail);
  const coin = rail.coin.toLowerCase();
  const [to, setTo] = useState(initialTo);
  const [amount, setAmount] = useState(initialAmount);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState('');
  const [step, setStep] = useState<'form' | 'preparing' | 'review' | 'holding' | 'sending' | 'working'>(resume ? 'working' : 'form');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [pocket, setPocket] = useState<'auto' | Pocket>('auto');
  const [totals, setTotals] = useState<Record<Pocket, bigint> | null>(null);
  const [mixOk, setMixOk] = useState('');
  const [crossing, setCrossing] = useState<Crossing | null>(resume ?? null);
  const [phase, setPhase] = useState<Phase>('cross');
  const [arrived, setArrived] = useState(false);
  const [onward, setOnward] = useState<OnwardPayment | null>(null);
  const [why, setWhy] = useState('');
  const busy = useRef(false);
  // While the payment is under way the browser asks before the page is closed or reloaded: the second half needs this page.
  const underWay = step === 'working' && (phase === 'cross' || phase === 'paying');
  useEffect(() => {
    if (!underWay) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', ask);
    return () => removeEventListener('beforeunload', ask);
  }, [underWay]);

  useEffect(() => {
    let live = true;
    loadRotation(wallet).then(
      (r) => live && setTotals(pocketTotals(r.spendable)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  /** Work out the USDC side of the payment: which addresses pay `usdcIn` to `deposit`. Throws the text to show. */
  const planUsdc = async (deposit: string, usdcIn: bigint, mix: boolean) => {
    const [rotation, pricing] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
    if (!pricing) throw new Error(t.gasless.unavailable);
    setTotals(pocketTotals(rotation.spendable));
    // Stealth money first: its addresses are tied to nothing, which is the point of paying this way.
    // A payment into a crossing has me7's lower fee; the service checks for itself that it is one.
    const planned = planFromPockets(rotation.spendable, [{ to: deposit, value: usdcIn }], rail.discount ? { ...pricing, base: CROSS.baseFee } : pricing, rotation.fresh, { prefer: 'stealth', choice: pocket, mix });
    if (planned === 'needs-mix') throw new Error('needs-mix');
    if (planned === 'pocket-short') throw new Error(t.pockets.short.replace('{sum}', pocket === 'auto' ? '' : money((totals ?? { plain: 0n, stealth: 0n })[pocket])));
    if (planned === 'too-many') throw new Error(t.gasless.tooMany);
    if (typeof planned === 'string') throw new Error(x.noFunds.replace('{sum}', money(usdcIn)));
    announcePlan(planned.plan);
    return { ...planned, refundTo: rotation.receive.address };
  };

  const prepare = async (e: Event) => {
    e.preventDefault();
    setError('');
    const recipient = to.trim();
    if (!(rail.net === 'tron' ? isValidTronAddress(recipient) : isValidEvmAddress(recipient))) return setError(t.badAddress);
    const units = parseUnits(amount, 6);
    if (units === null || units <= 0n) return setError(t.badAmount);
    if (units < CROSS.min) return setError(x.min.replace('{min}', money(CROSS.min)));
    const mixKey = `${recipient}|${amount.trim()}|${pocket}`;
    setStep('preparing');
    try {
      // On Ethereum the service itself turns away a frozen recipient when the payment comes; on Tron the wallet asks first.
      const frozen = rail.net === 'tron' && (await fetchTrc20Frozen(NET.tron.nodes, NET.tron.usdt, recipient).catch(() => false));
      if (frozen) throw new Error(t.guard.frozenTo);
      const fresh = rail.net === 'tron' ? await freshTronAddress(wallet) : await freshEthAddress(wallet, rail.token);
      // What paying on from the new address will cost is asked ahead of the money; the real price is asked again when it arrives.
      const feeTron = rail.net === 'tron' ? (await fetchTronQuote(fresh.address, recipient, units, true, true)).fee : (await fetchEthGasTerms(fresh.address, rail.token, recipient, units, true)).fee;
      const budget = crossBudget(units, feeTron);
      const refundTo = (await loadRotation(wallet)).receive.address;
      const order: CrossOrder = { origin: CROSS.origin, destination: rail.destination, recipient: fresh.address, refundTo, amountOut: budget, slippageBps: CROSS.slippageBps, deadline: Date.now() + CROSS.lifetime };
      const quote = await fetchCrossQuote(CROSS.api, order, true, CROSS);
      const usdc = await planUsdc(NOWHERE, quote.amountIn, mixOk === mixKey);
      setReviewed({ to: recipient, amount: units, fresh, order, usdcIn: quote.amountIn, leastIn: quote.leastIn, feeBase: usdc.plan.fee, feeTron, from: usdc.from, joined: usdc.joined, seconds: quote.seconds });
      setConfirm('');
      setStep('review');
    } catch (err) {
      const text = err instanceof Error ? err.message : '';
      setMixOk(text === 'needs-mix' ? mixKey : '');
      // Texts made above are shown as they are; anything else is the service or the nodes not answering.
      setError(text === 'needs-mix' ? t.pockets.mixStop : [t.guard.frozenTo, t.gasless.unavailable, t.gasless.tooMany].includes(text) || text.startsWith(x.noFunds.split('{')[0] ?? '\0') || text.startsWith(t.pockets.short.split('{')[0] ?? '\0') ? text : x.unavailable);
      setStep('form');
    }
  };

  const send = () => {
    setError('');
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    setStep('holding');
  };

  const launch = async () => {
    if (!reviewed) return;
    setStep('sending');
    let written: Crossing | null = null;
    try {
      // Now the order is placed for real: the service names the address to pay to.
      const order = { ...reviewed.order, deadline: Date.now() + CROSS.lifetime };
      const quote = await fetchCrossQuote(CROSS.api, order, false, CROSS).catch(() => null);
      if (!quote?.depositAddress) throw new Error(x.unavailable);
      // The price is the one that was shown, give or take a third of a percent; a dearer one is shown again first.
      if (quote.amountIn > reviewed.usdcIn + reviewed.usdcIn / 300n) {
        setReviewed({ ...reviewed, order, usdcIn: quote.amountIn, leastIn: quote.leastIn });
        throw new Error(x.priceMoved.replace('{sum}', money(quote.amountIn)));
      }
      const usdc = await planUsdc(quote.depositAddress, quote.amountIn, reviewed.from === 'both').catch((err: unknown) => {
        throw new Error(err instanceof Error && err.message === 'needs-mix' ? t.pockets.mixStop : err instanceof Error ? err.message : x.unavailable);
      });
      // me7's own fee is what the review showed, or a hair more: a dearer one is shown again first.
      if (usdc.plan.fee > reviewed.feeBase + reviewed.feeBase / 20n) {
        setReviewed({ ...reviewed, order, feeBase: usdc.plan.fee });
        throw new Error(t.bridge.errMoved);
      }
      written = {
        id: crypto.randomUUID(),
        index: reviewed.fresh.index,
        address: reviewed.fresh.address,
        to: reviewed.to,
        amount: reviewed.amount.toString(),
        budget: order.amountOut.toString(),
        deposit: quote.depositAddress,
        usdcIn: quote.amountIn.toString(),
        baseTx: '',
        started: Date.now(),
        deadline: order.deadline,
        stage: 'open',
        payTx: '',
        ...(rail.net === 'eth' ? { net: 'eth' as const, token: rail.token } : {}),
      };
      // Written down before anything leaves: without the record a crossing cut short could not be finished.
      if (!saveCrossing(wallet, written)) {
        written = null;
        throw new Error(x.noStorage);
      }
      let hash: string;
      try {
        hash = await sendPlan(wallet, usdc.plan, undefined, rail.discount);
      } catch (err) {
        throw new Error(relayErrorText(t, err));
      }
      const sent = { ...written, baseTx: hash };
      written = null;
      saveCrossing(wallet, sent);
      void tellCrossDeposit(CROSS.api, sent.deposit, hash);
      setCrossing(sent);
      setPhase('cross');
      setStep('working');
    } catch (err) {
      // Nothing left the wallet: the record of a crossing that never started is not kept.
      if (written) dropCrossing(wallet, written.id);
      setError(err instanceof Error ? err.message : x.unavailable);
      setStep('review');
    }
  };

  /** The second half: pay the USDT on. `less` is the user's consent to a smaller payment when the fee has grown. */
  const payOn = async (c: Crossing, less = false) => {
    if (busy.current) return;
    busy.current = true;
    setPhase('paying');
    try {
      const pay = await planOnward(c);
      setOnward(pay);
      if (pay.amount <= 0n) throw new Error(x.payEmpty);
      if (pay.short > 0n && !less) return setPhase('short');
      const payTx = await payOnward(wallet, c, pay);
      const paid: Crossing = { ...c, stage: 'paid', payTx, amount: pay.amount.toString() };
      saveCrossing(wallet, paid);
      setCrossing(paid);
      setPhase('done');
    } catch (err) {
      setWhy(relayErrorText(t, err));
      setPhase('payError');
    } finally {
      busy.current = false;
    }
  };

  // While the money crosses: the new address is watched on Tron itself, and the service is asked only whether it gave up.
  useEffect(() => {
    if (step !== 'working' || !crossing || phase !== 'cross') return;
    let live = true;
    const look = async () => {
      const [held, state] = await Promise.all([crossingBalance(crossing).catch(() => null), fetchCrossState(CROSS.api, crossing.deposit)]);
      if (!live) return;
      if (held !== null && held >= BigInt(crossing.amount)) {
        setArrived(true);
        return void payOn(crossing);
      }
      const finish = (stage: 'paid' | 'refunded', next: Phase) => {
        const closed: Crossing = { ...crossing, stage };
        saveCrossing(wallet, closed);
        setCrossing(closed);
        setPhase(next);
      };
      if (state === 'refunded') return finish('refunded', 'refunded');
      // The service says it delivered, and the address holds next to nothing: it was paid on before the tab was closed.
      if (state === 'done' && held !== null && held < BigInt(crossing.amount) / 2n && Date.now() - crossing.started > 120_000) return finish('paid', 'done');
      if (state === 'failed' || (held !== null && Date.now() > crossing.deadline + 600_000)) return setPhase('failed');
      // The USDC was never seen leaving: after a quarter of an hour the crossing may be forgotten.
      if (crossing.baseTx === '' && (state === 'waiting' || state === null) && Date.now() - crossing.started > FORGET_AFTER) setPhase('unsent');
    };
    void look();
    const id = setInterval(() => void look(), EVERY);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [step, crossing?.id, phase]);

  if (step === 'holding' && reviewed) {
    return (
      <Hold
        t={t}
        lines={[`${t.hold.to}: ${reviewed.to}`, `${t.pay.code}: ${addressCode(reviewed.to)}`]}
        onDone={() => void launch()}
        onCancel={() => {
          setError(t.hold.cancelled);
          setStep('review');
        }}
      />
    );
  }
  if (step === 'preparing' || step === 'sending') {
    return (
      <section class="panel" role="status">
        <p class="dim">
          <Spinner /> {step === 'preparing' ? x.asking : t.sending}…
        </p>
      </section>
    );
  }

  if (step === 'working' && crossing) {
    const got = arrived || phase === 'done' || phase === 'paying' || phase === 'short' || phase === 'payError';
    const final = phase === 'done' || phase === 'refunded' || phase === 'unsent';
    return (
      <section class="panel hold">
        {/* The film says where things stand: the name while the payment is on its way, the tick once the recipient has it. */}
        {phase === 'done' ? <SentFilm key="done" /> : phase === 'cross' || phase === 'paying' ? <WorkingFilm key="working" /> : null}
        <h2 class="title">{phase === 'done' ? x.sentTitle : x.workingTitle}</h2>
        <p class="lead">
          {phase === 'done' ? x.sentLead.replace('{sum}', money(BigInt(crossing.amount))).replace('{to}', `${crossing.to.slice(0, 8)}…${crossing.to.slice(-6)}`) : phase === 'paying' ? x.step3 : got ? x.step2done : x.step2}{' '}
          {(phase === 'cross' || phase === 'paying') && <Spinner />}
        </p>
        {phase === 'done' && crossing.payTx && (
          <a class="btn" href={(rail.net === 'tron' ? NET.tron.explorerTx : NET.evm.explorerTx)(crossing.payTx)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        {(phase === 'cross' || phase === 'paying') && (
          <p class="alert" role="note">
            <b>{x.stayTitle}</b> {x.stay}
          </p>
        )}
        {phase === 'refunded' && <p class="alert">{x.refunded}</p>}
        {phase === 'failed' && <p class="alert">{x.failed.replace('{deposit}', crossing.deposit)}</p>}
        {phase === 'unsent' && <p class="alert">{x.unsent}</p>}
        {phase === 'short' && onward && (
          <p class="alert" role="alert">
            {x.short.replace('{held}', money(onward.held)).replace('{can}', money(onward.amount)).replace('{want}', money(BigInt(crossing.amount)))}
          </p>
        )}
        {phase === 'payError' && (
          <p class="alert" role="alert">
            {x.payFailed.replace('{why}', why)}
          </p>
        )}
        <div class="row">
          {phase === 'short' && onward && (
            <button class="btn btn--accent" onClick={() => void payOn(crossing, true)}>
              {x.sendLess.replace('{can}', money(onward.amount))}
            </button>
          )}
          {phase === 'payError' && (
            <button class="btn btn--accent" onClick={() => void payOn(crossing)}>
              {x.retry}
            </button>
          )}
          {phase === 'unsent' && (
            <button
              class="btn"
              onClick={() => {
                dropCrossing(wallet, crossing.id);
                onClose(false);
              }}
            >
              {x.forget}
            </button>
          )}
          <button class={cls('btn', final && phase !== 'unsent' && 'btn--accent')} onClick={() => onClose(phase === 'done')}>
            {final ? t.done : x.later}
          </button>
        </div>
        {!final && phase !== 'cross' && phase !== 'paying' && <p class="note">{x.laterNote}</p>}
      </section>
    );
  }

  if (step === 'review' && reviewed) {
    // What the service asks over what it delivers is the most the crossing can cost; the least is by its own lower figure.
    const over = reviewed.usdcIn - reviewed.order.amountOut;
    const most = over > 0n ? over : 0n;
    const least = reviewed.leastIn > reviewed.order.amountOut ? reviewed.leastIn - reviewed.order.amountOut : 0n;
    const room = reviewed.usdcIn - reviewed.leastIn;
    return (
      <section class="panel">
        <h2 class="title">{t.reviewTitle}</h2>
        <dl class="review">
          <dt>{x.gets}</dt>
          <dd class="review-total">
            {money(reviewed.amount)} {coin} <span class="dim">{rail.netName.toLowerCase()}</span>
          </dd>
          <dt>{t.sendTo}</dt>
          <dd class="review-addr">{reviewed.to}</dd>
          <dt>{t.pay.code}</dt>
          <dd>{addressCode(reviewed.to)}</dd>
          <dt>{x.via}</dt>
          <dd class="review-addr">{reviewed.fresh.address}</dd>
          <dt>{x.spends}</dt>
          <dd class="review-total">
            {money(reviewed.usdcIn + reviewed.feeBase)} usdc <span class="dim">base</span>
          </dd>
          <dt>{x.feeBase}</dt>
          <dd>{money(reviewed.feeBase)} usdc</dd>
          <dt>{x.feeCross}</dt>
          <dd>{room > 0n ? x.feeRange.replace('{from}', money(least)).replace('{to}', money(most)) : money(most)} usdc</dd>
          <dt>{x.feeTron}</dt>
          <dd>
            {money(reviewed.order.amountOut - reviewed.amount)} {coin} <span class="dim">{x.estimate}</span>
          </dd>
        </dl>
        {room > 0n && <p class="note">{x.roomNote.replace('{sum}', money(room))}</p>}
        <p class="alert">{x.trust}</p>
        {reviewed.from === 'both' && <p class="alert">{t.pockets.reviewMix}</p>}
        {reviewed.from !== 'both' && reviewed.joined > 0 && <p class="note">{t.pockets.reviewJoined.replace('{n}', String(reviewed.joined))}</p>}
        {reviewed.from === 'plain' && <p class="note">{x.fromPlain}</p>}
        <p class="note">{x.reviewNote.replace('{min}', String(Math.max(1, Math.round(reviewed.seconds / 60))))}</p>
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
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
          <button class="btn btn--accent" onClick={send}>
            {t.sendNow}
          </button>
        </div>
      </section>
    );
  }

  /**
   * Put what the scanner read into the form. The coin and the network are this screen's own, so a code that names
   * another coin or network is refused, and nothing is sent: it is checked and confirmed like anything typed.
   */
  const applyScan = (r: PayRequest) => {
    setScanning(false);
    setError('');
    setScanned('');
    const here = `${rail.coin} ${rail.netName}`;
    const contract = rail.net === 'tron' ? NET.tron.usdt : rail.token.toLowerCase();
    const same = (c: string | undefined) => !!c && (rail.net === 'tron' ? c === contract : c.toLowerCase() === contract);
    const network = rail.net === 'tron' ? r.network === 'tron' : r.network === 'evm' && (r.chainId === undefined || r.chainId === 1n);
    const coin = r.asset ? same(ASSETS.find((a) => a.id === r.asset)?.contract) : r.token ? same(r.token) : !r.baseUnits;
    if (!network || !coin) return setError(t.pay.scanOther.replace('{coin}', here));
    setTo(r.address);
    if (r.amount) setAmount(r.baseUnits ? formatUnits(BigInt(r.amount), 6, 6) : r.amount);
    if (r.asset || r.token) setScanned(t.pay.scanned.replace('{coin}', here));
  };
  if (scanning) return <Scanner t={t} onResult={applyScan} onClose={() => setScanning(false)} />;

  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
      <h2 class="title">{t.sendTitle}</h2>
      {onPlain && (
        <div class="field">
          <span class="field-label">{x.modeLabel}</span>
          <span class="chips" role="radiogroup" aria-label={x.modeLabel}>
            <button type="button" role="radio" aria-checked={false} class="chip" onClick={() => onPlain(to, amount)}>
              {x.modePlain}
            </button>
            <button type="button" role="radio" aria-checked={true} class="chip chip--on">
              {x.modeCross}
            </button>
          </span>
        </div>
      )}
      <p class="note">{x.lead}</p>
      <label class="field">
        <span class="field-label">
          {t.sendTo} <span class="dim">({rail.netName.toLowerCase()})</span>
        </span>
        <span class="field-row">
          <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} value={to} onInput={(e) => (setTo(e.currentTarget.value), setScanned(''))} />
          <button type="button" class="btn" onClick={() => setScanning(true)}>
            {t.pay.scan}
          </button>
        </span>
        {scanned && <span class="dim">{scanned}</span>}
      </label>
      <label class="field">
        <span class="field-label">{x.amount}</span>
        <input class="input" type="text" inputMode="decimal" placeholder="0.0" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
      </label>
      {totals && totals.stealth > 0n && (
        <div class="field">
          <span class="field-label">{t.pockets.label}</span>
          <span class="chips" role="radiogroup" aria-label={t.pockets.label}>
            {(['auto', 'plain', 'stealth'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={pocket === p} class={cls('chip', pocket === p && 'chip--on')} onClick={() => (setPocket(p), setError(''))}>
                {t.pockets[p]}
                {p !== 'auto' && <span class="dim"> {money(totals[p])}</span>}
              </button>
            ))}
          </span>
        </div>
      )}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent">
          {t.next}
        </button>
      </div>
    </form>
  );
}
