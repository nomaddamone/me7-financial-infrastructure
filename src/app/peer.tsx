import { UsdcElsewhere } from './elsewhere.tsx';
import { useCallback, useEffect, useState } from 'preact/hooks';
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
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { NET } from '../net/endpoints.ts';
import {
  fetchAllowance,
  fetchPeerOrder,
  fetchPeerRate,
  findPeerDepositIds,
  registerPeerPayee,
  type PeerOrder,
} from '../net/peer.ts';
import { fetchErc20Balance, fetchEvmFees } from '../net/send.ts';
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

function Copy({ t, value }: { t: Dict; value: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      class={`btn btn--small${done ? ' btn--accent' : ''}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setDone(true),
          () => undefined,
        );
      }}
    >
      {done ? t.copied : t.copy}
    </button>
  );
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
}

type RunStep = 'register' | 'approve' | 'deposit';

function Withdraw({ t, wallet, base, home }: { t: Dict; wallet: Wallet; base: Base; home: number }) {
  const p = t.peer;
  const [view, setView] = useState<'main' | 'faq' | 'review' | 'running' | 'done'>('main');
  // The tab was tapped again: back to the first page, unless an order is being created right now.
  useEffect(() => {
    if (home !== 0) setView((v) => (v === 'running' ? v : 'main'));
  }, [home]);
  const [balance, setBalance] = useState<{ usdc: bigint; eth: bigint } | null>(null);
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
  const [txHash, setTxHash] = useState('');
  const [taking, setTaking] = useState<bigint | null>(null);
  // Money only leaves after the account password is typed again.
  const [confirm, setConfirm] = useState('');

  const refresh = useCallback(async () => {
    const [u, e] = await Promise.allSettled([
      fetchErc20Balance(base.rpc, base.usdc, wallet.evm),
      fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value),
    ]);
    if (u.status === 'fulfilled' && e.status === 'fulfilled') setBalance({ usdc: u.value, eth: e.value });

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
  }, [base, wallet, p]);

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
      const [held, eth, fees, rate] = await Promise.all([
        fetchErc20Balance(base.rpc, base.usdc, wallet.evm),
        fetchEvmBalance(base.rpc, wallet.evm).then((r) => r.value),
        fetchEvmFees(base.rpc),
        fetchPeerRate(base.rpc, currency),
      ]);
      setBalance({ usdc: held, eth });
      const units = all ? held : parseUnits(amount, 6);
      if (units === null || units <= 0n) return setError(p.badAmount);
      if (units > held) return setError(p.noUsdc);
      const feeCeiling = GAS_CEILING * fees.maxFeePerGas + 2n * BASE_L1_RESERVE;
      if (feeCeiling > eth) return setError(p.noGas);
      setDraft({ platform, currency, handle: clean, amount: units, rate, feeCeiling });
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
    setView('running');
    try {
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
          <dt>{t.feeUpTo}</dt>
          <dd>{formatUnits(draft.feeCeiling, 18, 6)} eth</dd>
        </dl>
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
          <UsdcElsewhere t={t} wallet={wallet} />
          <button type="button" class="btn btn--small" onClick={() => setView('faq')}>
            {p.faq}
          </button>
        </div>
        <p class="lead">{p.lead}</p>
        <dl class="review peer-balance">
          <dt>usdc · {base.name}</dt>
          <dd>{balance ? usdc(balance.usdc) : <Spinner />}</dd>
          <dt>eth · {base.name}</dt>
          <dd>{balance ? formatUnits(balance.eth, 18, 6) : <Spinner />}</dd>
        </dl>
        <p class="note">{p.fundNote}</p>
        <div class="peer-addr">
          <code class="addr-value">{wallet.evm}</code>
          <Copy t={t} value={wallet.evm} />
        </div>

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
