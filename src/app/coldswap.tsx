import { useEffect, useState } from 'preact/hooks';
import { erc20TransferData, parseUnits, type EvmTransaction } from '../core/index.ts';
import type { SwapQuote } from '../core/cross.ts';
import { LedgerError, ledgerTokenDescription } from '../core/ledger.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { fetchCrossSwapQuote, tellCrossDeposit } from '../net/cross.ts';
import { CROSS, NET } from '../net/endpoints.ts';
import { fetchEthGasTerms, fetchTronQuote, RelayError } from '../net/relay.ts';
import { broadcastEvm, estimateEvmGas, fetchErc20Balance, fetchEvmFees, fetchEvmNonce, type UsdPrices } from '../net/send.ts';
import { fetchTrc20Balance } from '../net/tron.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, type AssetDef } from './assets.ts';
import { bridgeName, floorFor, noteBridging, STAND_IN, swapOrderFor, tronStandIn, type Bridging } from './bridge.ts';
import { coldEthless, coldHeld, coldTronless, ledgerText, requireApp, servedOnEth, servedOnTron, serviceText, WrongApp, type ColdSession, type DeviceApp } from './cold.tsx';
import { Spinner } from './fx.tsx';
import { SentFilm } from './hold.tsx';
import type { Dict } from './i18n.ts';
import { CoinButton, CoinList } from './swapform.tsx';

/**
 * Swapping a coin for a coin on another network with a Ledger (see src/app/bridge.ts for the swap itself).
 *
 * What is given leaves the device's address by a plain transfer to the crossing service's address, which the
 * device shows in full: the address and the amount. USDT and USDC on Ethereum, and USDT on Tron, go through
 * me7's service as two such transfers; any other coin by one, for which the address pays the gas itself.
 * Nothing here is a contract call, so the device is never asked to sign what it cannot show.
 */
const isTron = (a: AssetDef) => a.kind === 'trx' || a.kind === 'trc20';
const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type Way = 'eth' | 'tron' | 'own';
const wayOf = (a: AssetDef): Way => (servedOnTron(a) ? 'tron' : servedOnEth(a) ? 'eth' : 'own');

/** What the open app can give: a network's own coin, or a token the device knows by name. On Tron, USDT through me7's service. */
function givable(app: DeviceApp): AssetDef[] {
  if (NET.mode !== 'mainnet') return [];
  if (app === 'Tron') return ASSETS.filter(servedOnTron);
  return ASSETS.filter((a) => bridgeName(a) !== null && (a.kind === 'eth' || (a.kind === 'erc20' && !!a.contract && ledgerTokenDescription(evmOf(a).chainId, a.contract) !== null)));
}

/** The session's own address on the network a coin lives on, if it is known. Bitcoin is not held in this mode. */
const addressFor = (session: ColdSession, a: AssetDef): string | null => (a.kind === 'btc' ? null : isTron(a) ? session.tron : session.evm);

interface Plan {
  from: AssetDef;
  to: AssetDef;
  amountIn: bigint;
  quote: SwapQuote;
  way: Way;
  /** me7's fee, in the units of the coin given; nought when the address pays the gas itself. */
  fee: bigint;
  /** The most the network takes, in wei, when the address pays the gas itself. */
  gas: bigint;
}

const TRANSFER_GAS = 100_000n;
const COIN_GAS = 21_000n;

export function ColdSwap({
  t,
  session,
  balances,
  prices,
  onClose,
}: {
  t: Dict;
  session: ColdSession;
  balances: Record<string, bigint | null>;
  prices: UsdPrices | null;
  onClose: (done: boolean) => void;
}) {
  const b = t.bridge;
  const s = t.swap;
  const l = t.ledger;
  const gives = givable(session.app);
  const [fromId, setFromId] = useState(gives[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [step, setStep] = useState<'form' | 'pricing' | 'review' | 'signing' | 'sending' | 'done'>('form');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [deposit, setDeposit] = useState('');
  const [txid, setTxid] = useState('');
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<{ key: string; out: bigint | null } | null>(null);

  const from = gives.find((a) => a.id === fromId) ?? gives[0];
  // Only to a network whose address this session knows: the result must arrive on the device's own address.
  const targets = from ? ASSETS.filter((a) => a.net !== from.net && bridgeName(a) !== null && addressFor(session, a) !== null) : [];
  const to = targets.find((a) => a.id === toId) ?? targets[0];
  const me = from ? (addressFor(session, from) ?? '') : '';
  const held: Record<string, bigint> = Object.fromEntries(Object.entries(balances).filter((e): e is [string, bigint] => typeof e[1] === 'bigint'));
  const text = (a: AssetDef, units: bigint) => `${formatUnits(units, a.decimals, a.shown)} ${a.ticker}`;
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price])}` : '');
  const otherApp: DeviceApp = session.app === 'Tron' ? 'Ethereum' : 'Tron';
  const otherKnown = (session.app === 'Tron' ? session.evm : session.tron) !== null;

  const typed = from && !all ? parseUnits(amount, from.decimals) : null;
  const estimateKey = `${from?.id}>${to?.id}>${typed ?? ''}`;
  useEffect(() => {
    if (step !== 'form' || !from || !to || typed === null || typed <= 0n) return;
    let live = true;
    const timer = setTimeout(() => {
      const order = swapOrderFor(from, to, typed, Date.now() + CROSS.lifetime, addressFor(session, to) ?? '', me);
      void fetchCrossSwapQuote(CROSS.api, order, true, 0n).then(
        (q) => live && setEstimate({ key: estimateKey, out: q.amountOut }),
        () => live && setEstimate({ key: estimateKey, out: null }),
      );
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey, step]);

  if (!from || !to) {
    return (
      <section class="panel">
        <h2 class="title">{b.title}</h2>
        <p class="note">{gives.length === 0 ? l.swapNothing : l.swapNeedOther.replace('{app}', otherApp)}</p>
        <button class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
      </section>
    );
  }

  const why = (err: unknown): string => {
    if (err instanceof LedgerError || err instanceof WrongApp || /Ledger|disconnected/i.test(String((err as Error | null)?.message))) return ledgerText(t, err);
    if (err instanceof RelayError) return err.code === 'busy' || err.code === 'empty' ? b.errBusy : serviceText(t, err, me);
    const m = err instanceof Error ? err.message : '';
    if (m === 'tron-min' || /minimum swap amount/i.test(m)) return b.errTronMin.replace('{min}', formatUnits(CROSS.tronSwapMin, 6, 0));
    return m === 'no-funds' ? s.noFunds : m === 'no-gas' ? s.noGas : m === 'moved' ? b.errMoved : m === 'too dear' ? b.errDear : m === 'unsaved' ? b.errUnsaved : m === 'held' ? l.heldNote : `${b.errOther} ${m.slice(0, 140)}`.trim();
  };

  /** The price, asked without binding anyone, and what leaving the address will cost. */
  const price = async (e?: Event) => {
    e?.preventDefault();
    setError('');
    const units = all ? null : parseUnits(amount, from.decimals);
    if (!all && (units === null || units <= 0n)) return setError(s.badAmount);
    if (!prices) return setError(b.errPrice);
    setStep('pricing');
    try {
      const way = wayOf(from);
      const recipient = addressFor(session, to) ?? '';
      const priced = async (amountIn: bigint, fee: bigint, gas: bigint): Promise<Plan> => ({
        from,
        to,
        amountIn,
        way,
        fee,
        gas,
        quote: await fetchCrossSwapQuote(CROSS.api, swapOrderFor(from, to, amountIn, Date.now() + CROSS.lifetime, recipient, me), true, floorFor(from, to, amountIn, prices)),
      });
      let next: Plan;
      if (way !== 'own' && coldHeld(me)) throw new Error('held');
      if (way === 'tron') {
        const have = await fetchTrc20Balance(NET.tron.nodes, from.contract ?? '', me);
        if (have <= 0n) throw new Error('no-funds');
        const fee = (await fetchTronQuote(me, tronStandIn(), units ?? have)).fee;
        const amountIn = units ?? have - fee;
        if (amountIn <= 0n || amountIn + fee > have) throw new Error('no-funds');
        if (amountIn < CROSS.tronSwapMin) throw new Error('tron-min');
        next = await priced(amountIn, fee, 0n);
      } else if (way === 'eth') {
        const token = from.contract ?? '';
        const have = await fetchErc20Balance(NET.evm.rpc, token, me);
        if (have <= 0n) throw new Error('no-funds');
        const terms = await fetchEthGasTerms(me, token, STAND_IN, units ?? have);
        // The real terms are asked again once the service's address is known, and may differ by a little: room is left for that.
        const amountIn = units ?? have - terms.fee - terms.fee / 10n;
        if (amountIn <= 0n || amountIn + terms.fee > have) throw new Error('no-funds');
        next = await priced(amountIn, terms.fee, 0n);
      } else {
        const chain = evmOf(from);
        const native = from.kind === 'eth';
        const [coin, fees] = await Promise.all([fetchEvmBalance(chain.rpc, me).then((r) => r.value), fetchEvmFees(chain.rpc)]);
        const have = native ? coin : await fetchErc20Balance(chain.rpc, from.contract ?? '', me);
        const gas = (native ? COIN_GAS : TRANSFER_GAS) * fees.maxFeePerGas + (from.chain === 'base' ? BASE_L1_RESERVE : 0n);
        const amountIn = units ?? (native ? have - gas : have);
        if (amountIn <= 0n || amountIn > have) throw new Error('no-funds');
        if (gas > (native ? coin - amountIn : coin)) throw new Error('no-gas');
        next = await priced(amountIn, 0n, gas);
      }
      setPlan(next);
      setStep('review');
    } catch (err) {
      setError(why(err));
      setStep('form');
    }
  };

  /** Send what is given to the crossing service's address. Returns the transaction's id; throws if nothing was sent. */
  const sendDeposit = async (p: Plan, address: string): Promise<string> => {
    if (p.way === 'tron') {
      const quote = await fetchTronQuote(me, address, p.amountIn);
      if (quote.fee > p.fee + p.fee / 10n) throw new Error('moved');
      return coldTronless(session.ledger, me, p.from.contract ?? '', address, p.amountIn, quote.fee, quote.receiver, () => setStep('sending'));
    }
    const chain = evmOf(p.from);
    const description = p.from.kind === 'erc20' ? ledgerTokenDescription(chain.chainId, p.from.contract ?? '') : null;
    if (p.way === 'eth') {
      const token = p.from.contract ?? '';
      const terms = await fetchEthGasTerms(me, token, address, p.amountIn);
      if (terms.fee > p.fee + p.fee / 10n || !description) throw new Error('moved');
      return coldEthless(session.ledger, me, token, description, address, p.amountIn, terms, () => setStep('sending'));
    }
    const [fees, nonce] = await Promise.all([fetchEvmFees(chain.rpc), fetchEvmNonce(chain.rpc, me)]);
    const base = { chainId: chain.chainId, nonce, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas };
    let tx: EvmTransaction;
    if (p.from.kind === 'erc20') {
      // Without Ledger's description of the token the device would ask for blind signing.
      if (!description || !p.from.contract) throw new Error(l.errNoToken);
      const data = erc20TransferData(address, p.amountIn);
      const gasLimit = await estimateEvmGas(chain.rpc, { from: me, to: p.from.contract, value: 0n, data: hexOf(data) }, 200_000n);
      tx = { ...base, gasLimit, to: p.from.contract, value: 0n, data };
    } else {
      tx = { ...base, gasLimit: await estimateEvmGas(chain.rpc, { from: me, to: address, value: p.amountIn }), to: address, value: p.amountIn };
    }
    const signed = await session.ledger.sign(tx, me, description ?? undefined);
    setStep('sending');
    return broadcastEvm(chain.rpc, signed.raw, signed.hash);
  };

  const run = async () => {
    if (!plan || !prices) return;
    setError('');
    setStep('signing');
    try {
      await requireApp(session.ledger, session.app);
      const deadline = Date.now() + CROSS.lifetime;
      const real = await fetchCrossSwapQuote(CROSS.api, swapOrderFor(plan.from, plan.to, plan.amountIn, deadline, addressFor(session, plan.to) ?? '', me), false, floorFor(plan.from, plan.to, plan.amountIn, prices));
      // What was shown is what is done: a price that moved by more than a third of a percent is asked about again.
      if (real.minOut < plan.quote.minOut - plan.quote.minOut / 300n || !real.depositAddress) throw new Error('moved');
      const record: Bridging = { id: `${Date.now()}-${real.depositAddress.slice(2, 10)}`, fromId: plan.from.id, toId: plan.to.id, amountIn: plan.amountIn.toString(), minOut: real.minOut.toString(), deposit: real.depositAddress, tx: '', started: Date.now(), deadline, stage: 'open', delivered: '' };
      // Nothing leaves before the swap is written down: the note names the address the money went to.
      if (!noteBridging(me, record.id, record)) throw new Error('unsaved');
      // The address the device is about to show is the crossing service's: it is put on the screen to compare with.
      setDeposit(real.depositAddress);
      let hash: string;
      try {
        hash = await sendDeposit(plan, real.depositAddress);
      } catch (err) {
        noteBridging(me, record.id, null);
        throw err;
      }
      noteBridging(me, record.id, { ...record, tx: hash });
      void tellCrossDeposit(CROSS.api, real.depositAddress, hash);
      setTxid(hash);
      setStep('done');
    } catch (err) {
      setError(why(err));
      setDeposit('');
      setStep('review');
    }
  };

  if (step === 'done' && plan) {
    return (
      <section class="panel hold">
        <SentFilm />
        <h2 class="title">{b.sentTitle}</h2>
        <p class="lead">{b.sentLead
            .replace('{coin}', `${plan.to.ticker} ${plan.to.net}`)
            .replace('{to}', short(addressFor(session, plan.to) ?? ''))
            .replace('{time}', plan.quote.seconds < 90 ? b.sentQuick : b.minutes.replace('{n}', String(Math.round(plan.quote.seconds / 60))))}</p>
        <p class="note">{b.sentNote}</p>
        {txid && (
          <a class="btn" href={(isTron(plan.from) ? NET.tron.explorerTx : evmOf(plan.from).explorerTx)(txid)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        <button class="btn btn--accent" onClick={() => onClose(true)}>
          {t.done}
        </button>
      </section>
    );
  }

  if ((step === 'review' || step === 'signing' || step === 'sending') && plan) {
    const waiting = step !== 'review';
    return (
      <section class="panel">
        <h2 class="title">{b.title}</h2>
        <p class="note">{b.trust}</p>
        <dl class="review">
          <dt>{s.youPay}</dt>
          <dd>
            {text(plan.from, plan.amountIn)} <span class="dim">{plan.from.net}</span>
            <span class="dim">{usd(plan.from, plan.amountIn)}</span>
          </dd>
          <dt>{s.youGet}</dt>
          <dd class="review-total">
            ≈ {text(plan.to, plan.quote.amountOut)} <span class="dim">{plan.to.net}</span>
            <span class="dim">{usd(plan.to, plan.quote.amountOut)}</span>
          </dd>
          <dt>{s.atLeast}</dt>
          <dd>{text(plan.to, plan.quote.minOut)}</dd>
          <dt>{b.arrives}</dt>
          <dd>
            <code class="addr-value">{addressFor(session, plan.to) ?? ''}</code> <span class="dim">{b.yours}</span>
          </dd>
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
                {text(plan.from, plan.fee)}
                <span class="dim">{usd(plan.from, plan.fee)}</span>
              </dd>
            </>
          )}
        </dl>
        <p class="note">{plan.way === 'own' ? b.reviewNote : b.reviewNoteService}</p>
        {plan.way !== 'own' && <p class="note">{l.twoSigns.replace('{fee}', text(plan.from, plan.fee))}</p>}
        {isTron(plan.to) !== (session.app === 'Tron') && <p class="note">{l.swapYours}</p>}
        {deposit ? (
          <p class="alert" role="status">
            {l.swapOnDevice} <code class="addr-value">{deposit}</code>
          </p>
        ) : (
          <p class="note">{l.swapBefore.replace('{app}', session.app)}</p>
        )}
        {step === 'sending' && <p class="alert">{l.sending}</p>}
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" disabled={waiting} onClick={() => setStep('form')}>
            {t.back}
          </button>
          <button class="btn btn--accent" disabled={waiting} onClick={() => void run()}>
            {waiting ? <Spinner /> : l.signOnDevice}
          </button>
        </div>
      </section>
    );
  }

  const known = estimate && estimate.key === estimateKey ? estimate : null;
  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void price(e)}>
      <h2 class="title">{b.title}</h2>
      <div class="swapf">
        <div class="swapf-side">
          <span class="field-label">{s.from}</span>
          <div class="swapf-line">
            <input class="swapf-amount" type="text" inputMode="decimal" aria-label={`${s.amount}, ${from.ticker}`} placeholder={all ? t.sendAllHint : '0.0'} disabled={all} value={all ? '' : amount} onInput={(e) => setAmount(e.currentTarget.value)} />
            <CoinButton asset={from} open={picking === 'from'} label={s.from} onToggle={() => setPicking((p) => (p === 'from' ? null : 'from'))} />
          </div>
          <div class="swapf-sub">
            <span aria-live="polite">{typed !== null && typed > 0n ? usd(from, typed).trim() : ' '}</span>
            <span>
              {held[from.id] !== undefined && `${s.balance} ${text(from, held[from.id] as bigint)} `}
              <button type="button" class="swapf-max" aria-pressed={all} onClick={() => setAll((v) => !v)}>
                {t.sendMax}
              </button>
            </span>
          </div>
        </div>
        <div class="swapf-side">
          <span class="field-label">{s.to}</span>
          <div class="swapf-line">
            {typed === null || typed <= 0n ? <span class="swapf-est swapf-est--none">0.0</span> : !known ? <span class="swapf-est swapf-est--none"><Spinner /></span> : known.out === null ? <span class="swapf-est swapf-est--none">—</span> : <span class="swapf-est">≈ {text(to, known.out)}</span>}
            <CoinButton asset={to} open={picking === 'to'} label={s.to} onToggle={() => setPicking((p) => (p === 'to' ? null : 'to'))} />
          </div>
          <div class="swapf-sub">
            <span>{known?.out && prices ? usd(to, known.out).trim() : ' '}</span>
            <span>{held[to.id] !== undefined && `${s.balance} ${text(to, held[to.id] as bigint)}`}</span>
          </div>
        </div>
      </div>
      {picking === 'from' ? (
        <CoinList groups={[{ title: '', list: gives }]} chosen={from.id} balances={held} onPick={(a) => (setPicking(null), setError(''), setFromId(a.id))} />
      ) : picking === 'to' ? (
        <CoinList groups={[{ title: s.otherNet, list: targets }]} chosen={to.id} balances={held} onPick={(a) => (setPicking(null), setError(''), setToId(a.id))} />
      ) : null}
      <p class="note">{b.trust}</p>
      {!otherKnown && <p class="note">{l.swapNeedOther.replace('{app}', otherApp)}</p>}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent" disabled={step === 'pricing'}>
          {step === 'pricing' ? <Spinner /> : t.next}
        </button>
      </div>
    </form>
  );
}
