import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SignedAuthorization } from '../core/gasless.ts';
import { parseUnits } from '../core/index.ts';
import {
  erc20ApproveData,
  PEER_ESCROW,
  PEER_PLATFORMS,
  peerCreateDepositData,
  peerDepositIdFromLogs,
  peerWithdrawData,
  type PeerCurrency,
  type PeerPlatform,
} from '../core/peer.ts';
import { fuelAuthorizations, planFuel, pocketOf, type FuelPlan, type Holding } from '../core/rotation.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { GASLESS, NET } from '../net/endpoints.ts';
import {
  fetchAllowance,
  fetchPeerOrder,
  fetchPeerRate,
  findPeerDepositIds,
  registerPeerPayee,
  type PeerOrder,
} from '../net/peer.ts';
import { fetchFuelCost, fetchRelayPricing, RelayError, relayFuel, relaySend } from '../net/relay.ts';
import { fetchErc20Balance, fetchEvmFees } from '../net/send.ts';
import { loadRotation, signWithAddresses } from './addresses.ts';
import { BASE_L1_RESERVE } from './assets.ts';
import { sendEvmCall } from './evm-call.ts';
import { Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';
import './peer.css';

type Base = NonNullable<typeof NET.base>;

const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const usdc = (units: bigint) => formatUnits(units, 6, 2);
/** Amount of currency for an amount of USDC at a rate scaled by 1e18, to the cent, rounded down. */
const fiatText = (units: bigint, rate: bigint) => {
  const cents = (units * rate) / 10n ** 22n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};
/** Generous ceilings used only to show the fee and to check there is enough ETH before starting. */
const GAS_CEILING = 60_000n + 1_300_000n;
/** The same for taking an order back. ETH for it is asked of me7's service along with the ETH for making the order. */
const TAKE_GAS = 400_000n;
const randomNonce = () => hexOf(crypto.getRandomValues(new Uint8Array(32)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const AGREED_KEY = 'me7.peer.agreed';
const ordersKey = (owner: string) => `me7.peer.orders.${owner.toLowerCase()}`;

function loadAgreed(): boolean {
  try {
    return localStorage.getItem(AGREED_KEY) === '1';
  } catch {
    return false;
  }
}
function loadOrderIds(owner: string): bigint[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(ordersKey(owner)) ?? '[]');
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && /^\d{1,15}$/.test(x)).map(BigInt) : [];
  } catch {
    return [];
  }
}
function saveOrderIds(owner: string, ids: readonly bigint[]): void {
  try {
    localStorage.setItem(ordersKey(owner), JSON.stringify([...new Set(ids.map(String))]));
  } catch {
    /* private mode: the orders are still found through the indexer */
  }
}

/** What has to be read and ticked before the first withdrawal on this device. */
function Intro({ t, agreed, onAccept, onBack }: { t: Dict; agreed: boolean; onAccept: () => void; onBack: () => void }) {
  const p = t.peer;
  const [checked, setChecked] = useState<boolean[]>(() => p.checks.map(() => agreed));
  const all = checked.every(Boolean);
  return (
    <form
      class="panel terms"
      onSubmit={(e) => {
        e.preventDefault();
        if (all) onAccept();
      }}
    >
      <h2 class="title">{p.introTitle}</h2>
      <p class="lead terms-intro">{p.intro}</p>
      {p.sections.map((section) => (
        <section class="terms-sec" key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      {agreed ? (
        <button type="button" class="btn" onClick={onBack}>
          {t.back}
        </button>
      ) : (
        <>
          <div class="terms-checks">
            {p.checks.map((label, i) => (
              <label class="check" key={label}>
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.currentTarget.checked : v)))}
                />
                <span class="check-box" aria-hidden="true" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button type="submit" class="btn btn--accent btn--wide" disabled={!all}>
            {p.accept}
          </button>
        </>
      )}
    </form>
  );
}

interface Draft {
  platform: PeerPlatform;
  currency: PeerCurrency;
  handle: string;
  amount: bigint;
  rate: bigint;
  feeCeiling: bigint;
  /** What me7's service is asked for first, when the main address lacks gas or USDC: the gathering, the fee, and so much ETH. */
  fuel: { plan: FuelPlan; wei: bigint } | null;
}

type RunStep = 'fuel' | 'register' | 'approve' | 'deposit';

function Withdraw({ t, wallet, base, home }: { t: Dict; wallet: Wallet; base: Base; home: number }) {
  const p = t.peer;
  const [view, setView] = useState<'main' | 'faq' | 'review' | 'running' | 'done'>('main');
  // The tab was tapped again: back to the first page, unless an order is being created right now.
  useEffect(() => {
    if (home !== 0) setView((v) => (v === 'running' ? v : 'main'));
  }, [home]);
  const [balance, setBalance] = useState<{ usdc: bigint; eth: bigint } | null>(null);
  // Money the wallet holds on Base that an order is not made from, so that the figure above does not look short.
  const [apart, setApart] = useState<{ stealth: bigint; held: bigint }>({ stealth: 0n, held: 0n });
  const [orders, setOrders] = useState<PeerOrder[] | null>(null);
  const [ordersNote, setOrdersNote] = useState('');
  const [platform, setPlatform] = useState<PeerPlatform>(PEER_PLATFORMS[0] as PeerPlatform);
  const [currency, setCurrency] = useState<PeerCurrency>((PEER_PLATFORMS[0] as PeerPlatform).currencies[0] as PeerCurrency);
  const [handle, setHandle] = useState('');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runStep, setRunStep] = useState<RunStep>('register');
  const [withFuel, setWithFuel] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [taking, setTaking] = useState<bigint | null>(null);
  // Money only leaves after the account password is typed again.
  const [confirm, setConfirm] = useState('');

  /** The addresses an order may be paid for from: the pocket's own, the main one among them; stealth money stays apart, and so does anything in quarantine. */
  const sources = useCallback(async (fresh = false): Promise<Holding[]> => (await loadRotation(wallet, fresh)).spendable.filter((h) => pocketOf(h) === 'plain'), [wallet]);
  // Permissions signed for the service and not yet answered for: sent again as they are, they cannot be carried twice.
  const signedFuel = useRef<{ key: string; request: { chain: string; transfers: SignedAuthorization[]; fee: SignedAuthorization } } | null>(null);
  /** Ask me7's service to get the main address ready, and wait until the money and the ETH are there. */
  const fuelUp = useCallback(
    async (fuel: { plan: FuelPlan; wei: bigint }, needUsdc: bigint, needEth: bigint) => {
      const key = `${fuel.plan.fee}:${fuel.plan.amount}:${fuel.wei}:${fuel.plan.gather.map((g) => `${g.holding.index}=${g.value}`).join(',')}`;
      if (signedFuel.current?.key !== key) {
        const unsigned = fuelAuthorizations(fuel.plan, wallet.evm, { feeReceiver: GASLESS.receiver, now: BigInt(Math.floor(Date.now() / 1000)), lifetime: 600n, random: randomNonce });
        const [fee, ...transfers] = signWithAddresses(wallet, { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc }, [unsigned.fee, ...unsigned.transfers]);
        if (!fee) throw new Error('nothing to sign');
        signedFuel.current = { key, request: { chain: 'base', transfers, fee } };
      }
      try {
        if (fuel.wei > 0n) await relayFuel(signedFuel.current.request, wallet.evm, fuel.wei);
        else await relaySend(signedFuel.current.request);
      } catch (e) {
        // "Already taken" is good news here: an earlier try went through and only its answer was lost.
        if (!(e instanceof RelayError) || e.code !== 'duplicate') {
          if (!(e instanceof RelayError) || e.code !== 'down') signedFuel.current = null;
          throw e;
        }
      }
      for (let i = 0; i < 60; i++) {
        const [u, e] = await Promise.all([fetchErc20Balance(base.rpc, base.usdc, wallet.evm), fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value)]).catch(() => [0n, 0n] as const);
        if (u >= needUsdc && e >= needEth) {
          signedFuel.current = null;
          return;
        }
        await sleep(2000);
      }
      throw new Error('Timed out waiting for the service');
    },
    [base, wallet],
  );

  const refresh = useCallback(async () => {
    const [u, e] = await Promise.allSettled([
      sources().then((list) => list.reduce((sum, h) => sum + h.balance, 0n)),
      fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value),
    ]);
    if (u.status === 'fulfilled' && e.status === 'fulfilled') setBalance({ usdc: u.value, eth: e.value });
    void loadRotation(wallet).then(
      (r) => {
        const usable = new Set(r.spendable.map((h) => h.address));
        setApart({
          stealth: r.holdings.reduce((sum, h) => (pocketOf(h) === 'stealth' ? sum + h.balance : sum), 0n),
          held: r.holdings.reduce((sum, h) => (pocketOf(h) === 'plain' && !usable.has(h.address) ? sum + h.balance : sum), 0n),
        });
      },
      () => undefined,
    );

    // Order numbers come from this device and from Peer's indexer; what they hold comes from the contract.
    const known = loadOrderIds(wallet.evm);
    let found: bigint[] = [];
    let note = '';
    try {
      found = await findPeerDepositIds(wallet.evm);
    } catch {
      note = p.ordersPartial;
    }
    const ids = [...new Set([...known, ...found].map(String))].map(BigInt);
    const results = await Promise.allSettled(ids.map((id) => fetchPeerOrder(base.rpc, id, wallet.evm)));
    const live: PeerOrder[] = [];
    const keep: bigint[] = [];
    results.forEach((r, i) => {
      const id = ids[i] as bigint;
      if (r.status === 'rejected') {
        keep.push(id);
        note = p.ordersPartial;
      } else if (r.value) {
        keep.push(id);
        // An order with nothing for sale and nothing reserved has nothing to show or take back.
        if (r.value.remaining > 0n || r.value.reserved > 0n) live.push(r.value);
      }
    });
    saveOrderIds(wallet.evm, keep);
    setOrders(live.sort((a, b) => (a.id < b.id ? 1 : -1)));
    setOrdersNote(note);
  }, [base, wallet, p, sources]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const prepare = async (e: Event) => {
    e.preventDefault();
    setError('');
    const clean = platform.normalize(handle);
    if (!platform.valid(clean)) return setError(p.badHandle);
    setBusy(true);
    try {
      const [pocket, eth, fees, rate] = await Promise.all([
        sources(true),
        fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value),
        fetchEvmFees(base.rpc),
        fetchPeerRate(base.rpc, currency),
      ]);
      const total = pocket.reduce((sum, h) => sum + h.balance, 0n);
      const onMain = pocket.find((h) => h.index === 0)?.balance ?? 0n;
      setBalance({ usdc: total, eth });
      const units = all ? total : parseUnits(amount, 6);
      if (units === null || units <= 0n) return setError(p.badAmount);
      if (units > total) return setError(p.noUsdc);
      const feeCeiling = GAS_CEILING * fees.maxFeePerGas + 2n * BASE_L1_RESERVE;
      // The main address has the gas and the money already: nothing is asked of the service.
      if (eth >= feeCeiling && units <= onMain) {
        setDraft({ platform, currency, handle: clean, amount: units, rate, feeCeiling, fuel: null });
        setView('review');
        return;
      }
      // Otherwise me7's service gathers the USDC onto the main address and puts the ETH there, for a fee in USDC.
      // The ETH asked for covers taking the order back later as well.
      const wei = eth >= feeCeiling ? 0n : feeCeiling + TAKE_GAS * fees.maxFeePerGas + BASE_L1_RESERVE - eth;
      const pricing = await fetchRelayPricing();
      if (!pricing || wei > GASLESS.fuelMax) return setError(p.noService);
      const cost = wei > 0n ? await fetchFuelCost(wei) : 0n;
      const plan = planFuel(pocket, all ? 'all' : units, pricing, cost);
      if (plan === 'no-funds' || plan === 'too-many') return setError(p.noUsdc);
      setDraft({ platform, currency, handle: clean, amount: plan.amount, rate, feeCeiling, fuel: { plan, wei } });
      setView('review');
    } catch {
      setError(p.loadFailed);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!draft) return;
    if (!isSessionPassword(confirm)) {
      setError(t.wrongPassword);
      return;
    }
    setConfirm('');
    setError('');
    setWithFuel(draft.fuel !== null);
    setView('running');
    try {
      if (draft.fuel) {
        setRunStep('fuel');
        await fuelUp(draft.fuel, draft.amount, draft.fuel.wei > 0n ? draft.feeCeiling : 0n);
        // Done and paid for: a second try of what follows must not ask for it again.
        setDraft((d) => (d ? { ...d, fuel: null } : d));
      }
      setRunStep('register');
      const payeeHash = await registerPeerPayee(draft.platform.id, draft.handle);
      const data = peerCreateDepositData({
        token: base.usdc,
        amount: draft.amount,
        platform: draft.platform.id,
        currencies: [draft.currency],
        payeeHash,
      });

      setRunStep('approve');
      // The escrow is allowed to take exactly this amount. If an earlier attempt already allowed it, skip.
      if ((await fetchAllowance(base.rpc, base.usdc, wallet.evm)) < draft.amount) {
        await sendEvmCall(base, wallet, base.usdc, erc20ApproveData(PEER_ESCROW, draft.amount));
      }

      setRunStep('deposit');
      const receipt = await sendEvmCall(base, wallet, PEER_ESCROW, data);
      const id = peerDepositIdFromLogs(receipt.logs, wallet.evm);
      if (id !== null) saveOrderIds(wallet.evm, [...loadOrderIds(wallet.evm), id]);
      setTxHash(receipt.hash);
      setHandle('');
      setAmount('');
      setAll(false);
      setView('done');
      void refresh();
    } catch (e) {
      setError(`${p.runFailed} ${e instanceof Error ? e.message.slice(0, 160) : ''}`.trim());
      setView('review');
      void refresh();
    }
  };

  const takeBack = async (order: PeerOrder) => {
    setError('');
    setTaking(order.id);
    try {
      // No ETH left on the main address for this: me7's service puts some there, for its fee in USDC.
      const [eth, fees] = await Promise.all([fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value), fetchEvmFees(base.rpc)]);
      const need = TAKE_GAS * fees.maxFeePerGas + BASE_L1_RESERVE;
      if (eth < need) {
        const wei = need * 2n - eth;
        const pricing = await fetchRelayPricing();
        if (!pricing || wei > GASLESS.fuelMax) throw new Error(p.noService);
        const plan = planFuel(await sources(true), 0n, pricing, await fetchFuelCost(wei));
        if (plan === 'no-funds' || plan === 'too-many') throw new Error(p.takeNeedsFee);
        await fuelUp({ plan, wei }, 0n, need);
      }
      await sendEvmCall(base, wallet, PEER_ESCROW, peerWithdrawData(order.id));
    } catch (e) {
      setError(`${p.takeFailed} ${e instanceof Error ? e.message.slice(0, 160) : ''}`.trim());
    } finally {
      setTaking(null);
      void refresh();
    }
  };

  if (view === 'faq') return <Intro t={t} agreed onAccept={() => setView('main')} onBack={() => setView('main')} />;

  if (view === 'running') {
    const steps: { id: RunStep; label: string }[] = [
      ...(withFuel ? [{ id: 'fuel' as const, label: p.stepFuel }] : []),
      { id: 'register', label: p.stepRegister },
      { id: 'approve', label: p.stepApprove },
      { id: 'deposit', label: p.stepDeposit },
    ];
    const at = steps.findIndex((s) => s.id === runStep);
    return (
      <section class="panel" role="status">
        <h2 class="title">{p.runningTitle}</h2>
        <ol class="peer-steps">
          {steps.map((s, i) => (
            <li key={s.id} class={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
              <span class="peer-step-mark">{i < at ? '✓' : i === at ? <Spinner /> : '·'}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <p class="note">{p.keepOpen}</p>
      </section>
    );
  }

  if (view === 'done') {
    return (
      <section class="panel">
        <h2 class="title">{p.doneTitle}</h2>
        <p class="lead">{p.doneLead}</p>
        {txHash && (
          <a class="btn" href={base.explorerTx(txHash)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        )}
        <button class="btn btn--accent" onClick={() => setView('main')}>
          {t.done}
        </button>
      </section>
    );
  }

  if (view === 'review' && draft) {
    return (
      <section class="panel">
        <h2 class="title">{p.reviewTitle}</h2>
        <dl class="review">
          <dt>{p.youSell}</dt>
          <dd>
            {usdc(draft.amount)} usdc <span class="dim">{base.name}</span>
          </dd>
          <dt>{p.youGet}</dt>
          <dd class="review-total">
            ≈ {fiatText(draft.amount, draft.rate)} {draft.currency}
            <span class="dim">
              {p.rateNow}: 1 usdc = {formatUnits(draft.rate, 18, 4)} {draft.currency}
            </span>
          </dd>
          <dt>{p.payTo}</dt>
          <dd>
            {draft.platform.label}
            <span class="peer-handle">{draft.handle}</span>
          </dd>
          {draft.fuel ? (
            <>
              <dt>{p.feeMe7}</dt>
              <dd>{usdc(draft.fuel.plan.fee)} usdc</dd>
            </>
          ) : (
            <>
              <dt>{t.feeUpTo}</dt>
              <dd>{formatUnits(draft.feeCeiling, 18, 6)} eth</dd>
            </>
          )}
        </dl>
        {draft.fuel && <p class="note">{p.reviewFuel}</p>}
        <p class="alert">{p.reviewHandle}</p>
        <p class="note">{p.reviewRate}</p>
        <p class="note">{p.reviewSigns}</p>
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
          <button class="btn" onClick={() => setView('main')}>
            {t.back}
          </button>
          <button class="btn btn--accent" onClick={() => void run()}>
            {p.confirm}
          </button>
        </div>
      </section>
    );
  }

  const hint = p.hints[platform.id as keyof typeof p.hints];
  return (
    <>
      <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
        <div class="kv">
          <h2 class="title">{p.title}</h2>
          <button type="button" class="btn btn--small" onClick={() => setView('faq')}>
            {p.faq}
          </button>
        </div>
        <p class="lead">{p.lead}</p>
        <dl class="review peer-balance">
          <dt>usdc · {base.name}</dt>
          <dd>{balance ? usdc(balance.usdc) : <Spinner />}</dd>
        </dl>
        {apart.stealth > 0n && <p class="note">{p.stealthApart.replace('{sum}', usdc(apart.stealth))}</p>}
        {apart.held > 0n && <p class="note">{p.heldApart.replace('{sum}', usdc(apart.held))}</p>}

        <span class="field-label">{p.platform}</span>
        <div class="seg seg--three" role="tablist">
          {PEER_PLATFORMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === platform.id}
              class="seg-item"
              onClick={() => {
                setPlatform(item);
                setCurrency(item.currencies[0] as PeerCurrency);
                setError('');
              }}
            >
              {item.label}
              <span class="seg-net">{item.currencies.join(' ')}</span>
            </button>
          ))}
        </div>
        {platform.currencies.length > 1 && (
          <>
            <span class="field-label">{p.currency}</span>
            <div class="seg seg--three" role="tablist">
              {platform.currencies.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={c === currency} class="seg-item" onClick={() => setCurrency(c)}>
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
        <label class="field">
          <span class="field-label">
            {p.handle} <span class="dim">({hint})</span>
          </span>
          <input
            class="input"
            type="text"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            value={handle}
            onInput={(e) => setHandle(e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="field-label">{p.amount}</span>
          <span class="amount-row">
            <input
              class="input"
              type="text"
              inputMode="decimal"
              placeholder={all ? t.sendAllHint : '0.0'}
              disabled={all}
              value={all ? (balance ? formatUnits(balance.usdc, 6, 6) : '') : amount}
              onInput={(e) => setAmount(e.currentTarget.value)}
            />
            <button type="button" class={`btn${all ? ' btn--accent' : ''}`} aria-pressed={all} onClick={() => setAll((v) => !v)}>
              {t.sendMax}
            </button>
          </span>
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn btn--accent btn--wide" disabled={busy}>
          {busy ? <Spinner /> : t.next}
        </button>
      </form>

      <section class="panel">
        <div class="kv">
          <h2 class="title">{p.ordersTitle}</h2>
          <button type="button" class="btn btn--small" onClick={() => void refresh()}>
            {t.refresh}
          </button>
        </div>
        {orders === null ? (
          <p class="dim">
            <Spinner /> {p.ordersLoading}
          </p>
        ) : orders.length === 0 ? (
          <p class="dim">{p.ordersEmpty}</p>
        ) : (
          <ul class="peer-orders">
            {orders.map((o) => (
              <li key={String(o.id)}>
                <div class="kv">
                  <span>
                    #{String(o.id)}{' '}
                    <span class="dim">
                      {o.platform ?? p.otherMethod} {o.currencies.join(' ')}
                    </span>
                  </span>
                  <span class="tag">{o.reserved > 0n ? p.statusReserved : o.accepting ? p.statusWaiting : p.statusStopped}</span>
                </div>
                <dl class="review">
                  <dt>{p.forSale}</dt>
                  <dd>{usdc(o.remaining)} usdc</dd>
                  <dt>{p.reserved}</dt>
                  <dd>{usdc(o.reserved)} usdc</dd>
                </dl>
                {o.reserved > 0n && <p class="note">{p.reservedNote}</p>}
                <button type="button" class="btn" disabled={taking !== null} onClick={() => void takeBack(o)}>
                  {taking === o.id ? <Spinner /> : p.takeBack}
                </button>
              </li>
            ))}
          </ul>
        )}
        {ordersNote && <p class="note">{ordersNote}</p>}
      </section>
    </>
  );
}

/** The withdrawal tab: sell USDC on Base for money on a payment app, through the Peer protocol. */
export function Peer({ t, wallet, home = 0 }: { t: Dict; wallet: Wallet; home?: number }) {
  const [agreed, setAgreed] = useState(loadAgreed);
  const base = NET.base;
  if (!base) {
    return (
      <section class="panel">
        <h2 class="title">{t.peer.title}</h2>
        <p class="lead">{t.peer.testnet}</p>
      </section>
    );
  }
  if (!agreed) {
    return (
      <Intro
        t={t}
        agreed={false}
        onBack={() => undefined}
        onAccept={() => {
          try {
            localStorage.setItem(AGREED_KEY, '1');
          } catch {
            /* private mode: asked again next time */
          }
          setAgreed(true);
        }}
      />
    );
  }
  return <Withdraw t={t} wallet={wallet} base={base} home={home} />;
}
