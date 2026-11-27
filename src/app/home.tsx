import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BitcoinSendError,
  buildTrc20Transfer,
  buildTronTransfer,
  dustLimit,
  entropyToPhrase,
  erc20TransferData,
  findKeyBlob,
  isValidBitcoinAddress,
  isValidEvmAddress,
  isValidTronAddress,
  openSecret,
  parseUnits,
  planBitcoinSend,
  signBitcoinSend,
  signEvmTransaction,
  signTronTransaction,
  tronRef,
  vaultCode,
  vaultPassphrase,
  wipe,
  type BitcoinSendPlan,
  type EvmTransaction,
} from '../core/index.ts';
import { gaslessFee, type GaslessPricing } from '../core/gasless.ts';
import { isUsed, planAuthorizations, planCollect, planFromPockets, pocketOf, pocketTotals, type Holding, type PaymentPlan, type Pocket, type PocketedPlan } from '../core/rotation.ts';
import { fetchBitcoinBalance, fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { ETH_GASLESS, GASLESS, hostOf, NET, TRON_GASLESS } from '../net/endpoints.ts';
import { parseName } from '../core/names.ts';
import { resolveName } from '../net/names.ts';
import { fetchEthGasTerms, fetchRelayPricing, fetchTronQuote, RelayError, relayEthSend, relayLook, relaySend, relayTronSend } from '../net/relay.ts';
import { buildEthGasPair, type EthGasTerms } from '../core/ethgas.ts';
import { findEvmTransaction, PERIODS, type Change, type Period } from '../net/history.ts';
import {
  broadcastBitcoin,
  broadcastEvm,
  estimateEvmGas,
  fetchBitcoinFeeRate,
  fetchBitcoinUtxos,
  fetchDayChanges,
  fetchErc20Balance,
  fetchEvmFees,
  fetchEvmNonce,
  fetchUsdPrices,
  type PriceId,
  type UsdPrices,
} from '../net/send.ts';
import {
  broadcastTron,
  estimateTrc20Energy,
  fetchTrc20Balance,
  fetchTrc20Frozen,
  fetchTronAccount,
  fetchTronBlock,
  fetchTronFeeRates,
  fetchTronResources,
} from '../net/tron.ts';
import { buildPayText, parsePayText, type PayRequest } from '../core/payqr.ts';
import { loadRotation, rotationOwners, signWithAddresses, type Rotation } from './addresses.ts';
import { AddressCode, AddressLine, BrandQr, Scanner } from './payqr.tsx';
import { Hold } from './hold.tsx';
import { Naming } from './naming.tsx';
import { CrossPay, railFor, railOfCrossing, type Rail } from './crosspay.tsx';
import { CrossList } from './crosslist.tsx';
import { openCrossings, type Crossing } from './crossing.ts';
import { AmlCheck } from './aml.tsx';
import { HeldNote } from './held.tsx';
import { markTold, quarantined, quarantineOf, syncQuarantine, type Quarantined } from './quarantine.ts';
import { useOwnName } from './ownname.ts';
import { PassCard, usePassSync } from './passcard.tsx';
import { SignOrQr } from './sign.tsx';
import { Hearer, heardNote, Whisper } from './whisper.tsx';
import { addressCode } from '../core/payqr.ts';
import { CONTACT_NAME_MAX, loadContacts, markContactsChanged, saveContacts, syncContacts, withContact, type Contact } from './contacts.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, feeAssetOf, type AssetDef } from './assets.ts';
import { errorText, FileDrop, useProgress, Working, type Picked } from './auth.tsx';
import { BalanceChart } from './chart.tsx';
import { Scramble, Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { CoinIcon } from './icons.tsx';
import { Peer } from './peer.tsx';
import { Swap, SWAPPABLE } from './swap.tsx';
import { loadHistory, paidAddresses, portfolioSeries, rememberPaid, seenAddresses, type History, type HistoryPoint } from './portfolio.ts';
import { lookalikeOf } from '../core/lookalike.ts';
import { STEALTH_INDEX } from './stealth.ts';
import { cleanNote, PAY_MAX, PAY_MIN, payAskHash } from '../core/payrequest.ts';
import { freshEthAddress, freshTronAddress } from './crossing.ts';
import { ASKED_MOST, askedIndices, dropAsked, loadAsked, saveAsked, type Asked } from './requests.ts';
import { parseStealthCode, stealthAddressFor, stealthCode, stealthKeys, stealthMetaAddress, tokenMetadata } from '../core/stealth.ts';
import { GASLESS_MAX_NOTES, type GaslessRequest, type StealthNote } from '../core/gasless.ts';
import { isGuessablePassword } from '../core/keyfile.ts';
import { hush } from './quiet.ts';
import { closeWallet, isSessionPassword, openWallet, withBitcoinKey, withEvmKey, withTronKey, type Wallet } from './wallet.ts';
import './home.css';

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** Amount for display. A non-zero amount too small for the shown precision reads "< 0.000001", never "0". */
const amountText = (a: AssetDef, units: bigint) => {
  const text = formatUnits(units, a.decimals, a.shown);
  return units > 0n && text === '0' ? `< 0.${'0'.repeat(a.shown - 1)}1` : text;
};
/** Dollar value of an amount in base units. Display only, so floating point is fine here. */
const usdValue = (a: AssetDef, units: bigint, prices: UsdPrices) =>
  Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price];
const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

type Network = 'evm' | 'tron' | 'btc';
/** USDC on Base: received on rotating addresses and always sent through me7's relay. */
const isRotated = (a: AssetDef | undefined): boolean => !!a && a.chain === 'base' && !!NET.base && a.contract === NET.base.usdc;
const randomNonce = () => hexOf(crypto.getRandomValues(new Uint8Array(32)));
const shortAddress = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
/** The addresses this wallet knows: its contacts and those it has paid to. A look-alike is told from these. */
function knownAddresses(wallet: Wallet): { address: string; name?: string; seen?: true }[] {
  const contacts = loadContacts(wallet.evm).map((c) => ({ address: c.address, name: c.name }));
  // What the history services report is compared with, but never trusted: `seen` marks it.
  return [...contacts, ...paidAddresses(wallet).map((address) => ({ address })), ...seenAddresses(wallet).map((address) => ({ address, seen: true as const }))];
}
/** The known address this one imitates, as the user would recognise it: the contact's name, or the address shortened. */
function twinOf(address: string, known: readonly { address: string; name?: string; seen?: true }[]): string | null {
  const same = (a: string) => a === address || (address.startsWith('0x') && a.toLowerCase() === address.toLowerCase());
  // An address is familiar only if the user wrote it down or paid to it from here. One that merely appears in the
  // history is no proof: it is left out of the comparison with itself, and the rest of the list still speaks.
  const trusted = known.filter((k) => !k.seen).map((k) => k.address);
  const twin = trusted.some(same) ? null : lookalikeOf(address, [...trusted, ...known.filter((k) => k.seen && !same(k.address)).map((k) => k.address)]);
  if (!twin) return null;
  const name = known.find((k) => k.address === twin)?.name;
  return name ? `«${name}» (${shortAddress(twin)})` : shortAddress(twin);
}
const networkOf = (a: AssetDef): Network => (a.kind === 'btc' ? 'btc' : a.kind === 'trx' || a.kind === 'trc20' ? 'tron' : 'evm');

/**
 * Bytes a signed Tron transaction counts against the account's bandwidth: the
 * transaction with its 65-byte signature and framing, plus a fixed 64 the network adds.
 */
const tronBandwidth = (raw: Uint8Array) => BigInt(raw.length + 3 + 67 + 64);

export function CopyButton({ t, value }: { t: Dict; value: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      class={cls('btn btn--small', done && 'btn--accent')}
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

/** me7's QR code for a text, in the look the wallet uses everywhere. */
export function Qr({ text }: { text: string }) {
  return <BrandQr text={text} />;
}

/** The addresses a plan pays from are named to me7's service ahead of the payment (see relayLook). */
export const announcePlan = (plan: PaymentPlan): void => relayLook([...new Set([...plan.sources.map((s) => s.holding.address), ...(plan.via ? [plan.via.address] : [])])]);

/** Sign a plan's permissions, each with the key of the address it takes from: the request me7's relay carries. Nothing is sent. */
export function signPlan(wallet: Wallet, plan: PaymentPlan, notes?: StealthNote[], cross = false): GaslessRequest {
  const base = NET.base;
  if (!base) throw new Error('no Base network');
  const unsigned = planAuthorizations(plan, {
    feeReceiver: GASLESS.receiver,
    now: BigInt(Math.floor(Date.now() / 1000)),
    // Ten minutes: enough for the relay to deliver, and then the permissions are worth nothing.
    lifetime: 600n,
    random: randomNonce,
  });
  const [fee, ...transfers] = signWithAddresses(wallet, { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc }, [unsigned.fee, ...unsigned.transfers]);
  if (!fee) throw new Error('nothing to sign');
  return { chain: 'base', transfers, fee, ...(notes && notes.length > 0 ? { notes } : {}), ...(cross ? { cross: true } : {}) };
}

/**
 * What was signed for a payment whose answer never came. When the service cannot be heard (the connection dropped,
 * the answer was lost), nobody knows whether it took the payment. Signing again would make a second payment beside
 * the first; sending the very same signatures cannot: the service carries them once. So they are kept until the
 * service gives a definite answer, or until they expire.
 */
const signedOnce = new Map<string, { until: number; value: unknown }>();
function signOnce<T>(key: string, lifeMs: number, sign: () => T): T {
  const kept = signedOnce.get(key);
  if (kept && kept.until > Date.now()) return kept.value as T;
  const value = sign();
  signedOnce.set(key, { until: Date.now() + lifeMs, value });
  return value;
}
/** A definite answer, good or bad, ends the keeping; silence does not. */
const heard = (key: string, err?: unknown) => {
  if (!(err instanceof RelayError) || err.code !== 'down') signedOnce.delete(key);
};

/** Sign a plan's permissions and hand them to the relay. Returns the transaction hash. */
export async function sendPlan(wallet: Wallet, plan: PaymentPlan, notes?: StealthNote[], cross = false): Promise<string> {
  const key = `base:${JSON.stringify([plan.sources.map((s) => [s.holding.address, s.value.toString()]), plan.via?.address ?? '', plan.payouts.map((p) => [p.to, p.value.toString()]), plan.fee.toString(), notes?.length ?? 0, cross])}`;
  // Nine minutes: the permissions themselves are good for ten.
  const request = signOnce(key, 540_000, () => signPlan(wallet, plan, notes, cross));
  let hash: string;
  try {
    hash = await relaySend(request);
    heard(key);
  } catch (err) {
    heard(key, err);
    // The service found one of the addresses in quarantine: the wallet marks it, and the next payment goes round it.
    // Only an address this very payment was to come from can be marked: the service's word is not taken about any other.
    const named = err instanceof RelayError && err.code === 'held' ? err.address : undefined;
    if (named && [...plan.sources.map((s) => s.holding.address), plan.via?.address ?? ''].some((a) => a.toLowerCase() === named.toLowerCase())) markTold(wallet, 'base', named);
    throw err;
  }
  // What was just read about the addresses is out of date now.
  void loadRotation(wallet, true).catch(() => undefined);
  return hash;
}

export const relayErrorText = (t: Dict, err: unknown): string => {
  const g = t.gasless;
  if (!(err instanceof RelayError)) return `${t.sendFailed} ${err instanceof Error ? err.message : String(err)}`;
  return err.code === 'duplicate'
    ? g.errDuplicate
    : err.code === 'held'
    ? t.held.errService
    : err.code === 'checking'
    ? t.held.errChecking
    : err.code === 'missed'
    ? t.ethless.missed
    : err.code === 'limit'
    ? g.errLimit
    : err.code === 'blocked'
      ? g.errBlocked
      : err.code === 'busy'
        ? g.errBusy
        : err.code === 'would-fail'
          ? g.errFail
          : err.code === 'down' || err.code === 'empty'
            ? g.errDown
            : g.errOther;
};

/**
 * The wallet's USDC addresses, for those who want to see them, and the one
 * thing that needs them: bringing everything onto the main address, which the
 * swap, the P2P withdrawal and trading work from.
 */
function AddressList({ t, wallet, rotation, prices, onChanged }: { t: Dict; wallet: Wallet; rotation: Rotation; prices: UsdPrices | null; onChanged: () => void }) {
  const g = t.gasless;
  const usdc = ASSETS.find(isRotated);
  const [step, setStep] = useState<'idle' | 'review' | 'sending' | 'done'>('idle');
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  if (!usdc) return null;
  // Addresses that were used and are empty now (emptied by a payment, or made only to gather money on) are
  // of no use to look at; they stay out of the list unless asked for.
  const [showEmpty, setShowEmpty] = useState(false);
  const emptied = rotation.holdings.filter((h) => h.index !== 0 && h.index !== rotation.receive.index && isUsed(h) && h.balance === 0n);
  const shown = rotation.holdings.filter((h) => h.index === 0 || h.balance > 0n || h.index === rotation.receive.index || (showEmpty && isUsed(h)));
  // Only the rotating addresses are brought onto the main one: stealth money moved there would be tied to it for all to see.
  const elsewhere = rotation.holdings.filter((h) => h.index !== 0 && h.balance > 0n && pocketOf(h) === 'plain');
  const hidden = pocketTotals(rotation.holdings).stealth;
  const marks = quarantined(wallet);
  const markOf = (h: Holding) => marks.find((m) => m.chain === 'base' && m.address === h.address.toLowerCase());

  const prepare = async () => {
    setError('');
    const pricing = await fetchRelayPricing();
    if (!pricing) return setError(g.unavailable);
    const next = planCollect((await loadRotation(wallet, true)).spendable.filter((h) => pocketOf(h) === 'plain'), pricing);
    if (next === 'no-funds') return setError(t.noFunds);
    if (next === 'too-many') return setError(g.tooMany);
    announcePlan(next);
    setPlan(next);
    setStep('review');
  };
  const collect = async () => {
    if (!plan) return;
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    setError('');
    setStep('sending');
    try {
      await sendPlan(wallet, plan);
      setStep('done');
      onChanged();
    } catch (err) {
      setError(relayErrorText(t, err));
      setStep('review');
    }
  };

  return (
    <>
      <ul class="rows addr-rows">
        {shown.map((h) => (
          <li key={h.index} class={markOf(h) ? 'addr-row addr-row--held' : 'addr-row'}>
            <span class="addr-row-name">
              <code>{shortAddress(h.address)}</code>
              <span class="dim">{h.index === 0 ? g.addrMain : h.index === rotation.receive.index ? g.addrNext : h.index >= STEALTH_INDEX ? `stealth #${h.index - STEALTH_INDEX + 1}` : `#${h.index}`}</span>
            </span>
            <span class="addr-row-sum">{amountText(usdc, h.balance)}</span>
            <CopyButton t={t} value={h.address} />
            {markOf(h) && <HeldNote t={t} wallet={wallet} mark={markOf(h) as Quarantined} holding={h} onChanged={onChanged} amount={`${amountText(usdc, BigInt((markOf(h) as Quarantined).amount))} ${usdc.ticker}`} />}
          </li>
        ))}
      </ul>
      {emptied.length > 0 && (
        <button type="button" class="linklike" onClick={() => setShowEmpty((v) => !v)}>
          {(showEmpty ? g.hideEmpty : g.showEmpty).replace('{n}', String(emptied.length))}
        </button>
      )}
      <p class="note">{g.collectLead}</p>
      {hidden > 0n && <p class="note">{t.pockets.collectNote.replace('{sum}', amountText(usdc, hidden))}</p>}
      {step === 'done' ? (
        <p class="note">{g.collectDone}</p>
      ) : step === 'review' && plan ? (
        <>
          <p class="note">
            {g.collectReview
              .replace('{n}', String(plan.sources.length))
              .replace('{sum}', amountText(usdc, plan.sources.reduce((sum, s) => sum + s.value, 0n)))
              .replace('{fee}', amountText(usdc, plan.fee))}
            {prices ? ` ≈ ${usdFormat.format(usdValue(usdc, plan.fee, prices))}` : ''}
          </p>
          <label class="field">
            <span class="field-label">{t.confirmPassword}</span>
            <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void collect()} />
          </label>
          <div class="row">
            <button class="btn" onClick={() => setStep('idle')}>
              {t.back}
            </button>
            <button class="btn btn--accent" onClick={() => void collect()}>
              {g.collectButton}
            </button>
          </div>
        </>
      ) : (
        <button class="btn" disabled={elsewhere.length === 0 || step === 'sending'} onClick={() => void prepare()}>
          {step === 'sending' ? <Spinner /> : g.collectButton}
        </button>
      )}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** What a receiving code carries: the bare address, or for USDC on Base with an amount asked for, a payment request. */
function payText(tab: string, address: string, ask: string): string {
  const units = tab === 'usdc' && NET.base ? parseUnits(ask.trim(), 6) : null;
  if (!units || units <= 0n || !NET.base) return address;
  return buildPayText({ network: 'evm', address, chainId: NET.base.chainId, asset: 'usdc-base', amount: formatUnits(units, 6, 6) });
}

/** Asking for an amount: the form, the link it makes, and the requests made before with whether each was paid (see src/app/requests.ts). */
function RequestMode({ t, wallet, rotation, onChanged }: { t: Dict; wallet: Wallet; rotation: Rotation | null; onChanged: () => void }) {
  const r = t.request;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // How long the link stands, in hours: an hour, a day or a week.
  const [life, setLife] = useState(24);
  // The list follows the wallet to its other devices: what they hold is fetched when the screen opens, and every change is sent on.
  const carry = () => {
    markContactsChanged(wallet.evm);
    void syncContacts(wallet).then(() => setList(loadAsked(wallet)));
  };
  useEffect(() => void syncContacts(wallet).then(() => (setList(loadAsked(wallet)), onChanged())), [wallet]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState<Asked[]>(() => loadAsked(wallet));
  const [shown, setShown] = useState<string | null>(null);
  const linkOf = (a: Asked) => `${location.origin}${location.pathname}${a.hash}`;
  const paidOf = (a: Asked) => {
    const h = rotation?.holdings.find((x) => x.index === a.index && x.address === a.address);
    return h ? h.balance >= BigInt(a.amount) || h.spent : null;
  };

  const create = async (e: Event) => {
    e.preventDefault();
    setError('');
    const units = parseUnits(amount.trim(), 6);
    if (units === null || units < PAY_MIN || units > PAY_MAX) return setError(r.badAmount);
    if (loadAsked(wallet).length >= ASKED_MOST) return setError(r.tooMany);
    setBusy(true);
    try {
      const fresh = await loadRotation(wallet, true);
      const plain = fresh.holdings.filter((h) => h.index < STEALTH_INDEX);
      const aside = askedIndices(wallet);
      // An address of its own for this request: past the one handed out next, unused, and set aside for nothing else.
      const spot = plain.find((h) => h.index > fresh.fresh.index && !isUsed(h) && !aside.has(h.index));
      if (!spot) return setError(r.tooMany);
      // Where a payer's coin returns if a swap from another network fails and the payer named no address: one-time addresses of this wallet.
      const [refundTron, refundEth] = await Promise.all([freshTronAddress(wallet).then((a): string | undefined => a.address, () => undefined), freshEthAddress(wallet, '0xdAC17F958D2ee523a2206206994597C13D831ec7').then((a): string | undefined => a.address, () => undefined)]);
      const until = Math.floor(Date.now() / 1000) + life * 3600;
      const hash = payAskHash({ to: spot.address, amount: units, note, until, ...(refundTron ? { refundTron } : {}), ...(refundEth ? { refundEth } : {}) });
      const one: Asked = { id: `${Date.now()}-${spot.index}`, index: spot.index, address: spot.address, amount: units.toString(), note: cleanNote(note), created: Date.now(), until, hash };
      if (!saveAsked(wallet, one)) return setError(r.unsaved);
      setList(loadAsked(wallet));
      carry();
      setShown(one.id);
      setAmount('');
      setNote('');
      onChanged();
    } catch {
      setError(t.nodesDown);
    } finally {
      setBusy(false);
    }
  };

  const open = list.find((a) => a.id === shown);
  return (
    <>
      <p class="note">{r.how}</p>
      <form class="ask-form" autocomplete="off" onSubmit={(e) => void create(e)}>
        <label class="field">
          <span class="field-label">{r.amount}</span>
          <input class="input" type="text" inputMode="decimal" placeholder="0.0" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field-label">{r.note}</span>
          <input class="input" type="text" maxLength={80} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        <div class="field">
          <span class="field-label">{r.life}</span>
          <div class="seg seg--two ask-life" role="radiogroup" aria-label={r.life}>
            {([1, 24] as const).map((hours) => (
              <button key={hours} type="button" role="radio" aria-checked={life === hours} aria-selected={life === hours} class="seg-item" onClick={() => setLife(hours)}>
                {hours === 1 ? r.lifeHour : r.lifeDay}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn btn--accent btn--wide" disabled={busy}>
          {busy ? <Spinner /> : r.create}
        </button>
      </form>
      {open && (
        <>
          <span class="field-label">
            {r.link} · {formatUnits(BigInt(open.amount), 6, 2)} USDC
          </span>
          <Qr text={linkOf(open)} />
          <code class="addr-value">{linkOf(open)}</code>
          <CopyButton t={t} value={linkOf(open)} />
          <AddressCode t={t} address={open.address} />
          <p class="note">{r.linkNote}</p>
          <p class="note">{r.refundNote}</p>
        </>
      )}
      {list.length > 0 && (
        <>
          <h3 class="label">{r.list}</h3>
          <ul class="rows addr-rows">
            {[...list].reverse().map((a) => {
              const paid = paidOf(a);
              return (
                <li key={a.id} class="addr-row">
                  <span class="addr-row-name">
                    <b>{formatUnits(BigInt(a.amount), 6, 2)} USDC</b>
                    <span class="dim">
                      {a.note ? `${a.note} · ` : ''}
                      {new Date(a.created).toLocaleDateString()} · {paid === null ? '…' : paid ? r.paid : a.until && Date.now() > a.until * 1000 ? r.lapsedShort : r.waiting}
                    </span>
                  </span>
                  <button type="button" class="linklike" onClick={() => setShown(shown === a.id ? null : a.id)}>
                    {r.show}
                  </button>
                  <button
                    type="button"
                    class="linklike"
                    onClick={() => {
                      dropAsked(wallet, a.id);
                      setList(loadAsked(wallet));
                      carry();
                      if (shown === a.id) setShown(null);
                      onChanged();
                    }}
                  >
                    {r.remove}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function Receive({ t, wallet, prices, initial, onClose }: { t: Dict; wallet: Wallet; prices: UsdPrices | null; initial?: Network; onClose: () => void }) {
  const g = t.gasless;
  const rotating = !!NET.base;
  const [net, setNet] = useState<Network | 'usdc'>(initial ?? (rotating ? 'usdc' : 'evm'));
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState(false);
  // An amount to ask for, which turns the code into a payment request.
  const [ask, setAsk] = useState('');
  // USDC on Base is received one of two ways: on an address that changes after each payment (rotation),
  // or by a code that never changes and gives every payer an address of their own (stealth).
  const [mode, setMode] = useState<'rotation' | 'stealth' | 'request'>('rotation');
  const [stealthInfo, setStealthInfo] = useState(false);
  const stealth = useMemo(() => {
    const meta = stealthMetaAddress(stealthKeys(wallet.seed));
    return { meta, code: stealthCode(meta) };
  }, [wallet]);
  const reload = useCallback(() => {
    if (!rotating) return;
    loadRotation(wallet, true).then(
      (r) => {
        setRotation(r);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [wallet, rotating]);
  useEffect(() => {
    reload();
    // The address changes once it has been paid to, so the screen keeps an eye on it while it is open.
    const id = setInterval(reload, 20_000);
    return () => clearInterval(id);
  }, [reload]);

  const options: { id: Network | 'usdc'; label: string; sub: string; address: string | null; note: string }[] = [
    ...(rotating ? [{ id: 'usdc' as const, label: 'usdc', sub: NET.base?.name ?? '', address: rotation?.receive.address ?? null, note: g.receiveNote }] : []),
    // One short word and one short line each, so the four tabs stay the same height on a phone.
    { id: 'evm', label: 'eth', sub: t.receiveEvmSub, address: wallet.evm, note: t.receiveEvmNote },
    { id: 'tron', label: 'trx', sub: t.receiveTronSub, address: wallet.tron, note: t.receiveTronNote },
    { id: 'btc', label: 'btc', sub: NET.btc.name, address: wallet.btc, note: t.receiveNote },
  ];
  // A name for the main address, issued or attached on its own screen.
  const [naming, setNaming] = useState(false);
  const [nameInfo, setNameInfo] = useState(false);
  const ownName = useOwnName(wallet.evm);
  const current = options.find((o) => o.id === net) ?? options[0];
  if (!current) return null;
  if (naming) return <Naming t={t} wallet={wallet} onClose={() => setNaming(false)} />;
  return (
    <section class="panel">
      <h2 class="title">{t.receiveTitle}</h2>
      <div class={options.length > 3 ? 'seg seg--four seg--tabs' : 'seg seg--three seg--tabs'} role="tablist">
        {options.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={o.id === net} class="seg-item" onClick={() => setNet(o.id)}>
            {o.label}
            <span class="seg-net">{o.sub}</span>
          </button>
        ))}
      </div>
      {current.id === 'usdc' && (
        <div class="seg seg--three seg--mode" role="tablist" aria-label={t.stealth.modes}>
          {(['rotation', 'stealth', 'request'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === mode} class="seg-item" onClick={() => setMode(m)}>
              {m === 'request' ? t.request.mode : `${m} mode`}
              <span class="seg-net">
                {m === 'rotation' ? t.stealth.rotationSub : m === 'stealth' ? t.stealth.stealthSub : t.request.sub}
                {m === 'stealth' && (
                  // What stealth mode is: a mark inside the tab, which opens the explanation without switching the tab.
                  <span
                    class="info-dot info-dot--in"
                    role="button"
                    tabIndex={0}
                    aria-expanded={stealthInfo}
                    aria-label={t.stealth.infoLabel}
                    title={t.stealth.infoLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStealthInfo((v) => !v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      setStealthInfo((v) => !v);
                    }}
                  >
                    i
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {current.id === 'usdc' && stealthInfo && (
        <ul class="policy policy--aside">
          {t.stealth.info.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {current.id === 'usdc' && mode === 'request' ? (
        <RequestMode t={t} wallet={wallet} rotation={rotation} onChanged={reload} />
      ) : current.id === 'usdc' && mode === 'stealth' ? (
        <>
          <BrandQr text={stealth.code} reveal={stealth.code} />
          <AddressLine t={t} address={stealth.code} />
          <AddressCode t={t} address={stealth.meta} note />
          <p class="note">{t.stealth.note}</p>
        </>
      ) : current.address ? (
        <>
          {current.id === 'usdc' || current.id === 'evm' ? (
            // An Ethereum-style address is shown as me7's sign; a tap turns it into the ordinary code.
            <SignOrQr t={t} address={current.address} kind={current.id === 'usdc' ? 'usdc-base' : 'evm'} text={payText(current.id, current.address, ask)} />
          ) : (
            <BrandQr text={payText(current.id, current.address, ask)} reveal={current.address} />
          )}
          <AddressLine t={t} address={current.address} />
          <AddressCode t={t} address={current.address} note />
          {/* The changing address can be said as sound to a sender standing by. */}
          {current.id === 'usdc' && <Whisper t={t} address={current.address} />}
          {/* A name for the main address. It is offered beside USDC too, where people ask for something short to give out. */}
          {(current.id === 'evm' || current.id === 'usdc') && NET.base && NET.mode === 'mainnet' && (
            <span class="name-found">
              {ownName ? (
                <>
                  <span class="dim">{t.naming.yours}</span>
                  <b>{ownName}</b>
                  <CopyButton t={t} value={ownName} />
                </>
              ) : (
                <span class="dim">{t.naming.offer}</span>
              )}
              <span class="name-actions">
                <button type="button" class="linklike" onClick={() => setNaming(true)}>
                  {ownName ? t.naming.another : t.naming.open}
                </button>
                <button type="button" class="info-dot" aria-expanded={nameInfo} aria-label={t.naming.infoLabel} title={t.naming.infoLabel} onClick={() => setNameInfo((v) => !v)}>
                  i
                </button>
              </span>
              {nameInfo && (
                <ul class="policy">
                  {t.naming.info.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </span>
          )}
          {current.id === 'usdc' && (
            <label class="field">
              <span class="field-label">{t.pay.askAmount}</span>
              <input class="input" type="text" inputMode="decimal" placeholder="0.0" value={ask} onInput={(e) => setAsk(e.currentTarget.value)} />
              {ask.trim() !== '' && <span class="dim">{parseUnits(ask, 6) ? t.pay.askNote : t.badAmount}</span>}
            </label>
          )}
        </>
      ) : (
        <p class="dim" role="status">
          {failed ? t.nodesDown : <Spinner />}
        </p>
      )}
      {!(current.id === 'usdc' && mode !== 'rotation') && <p class="note">{current.note}</p>}
      {current.id === 'usdc' && mode === 'rotation' && rotation && (
        <>
          <button type="button" class="linklike" onClick={() => setShowAll((v) => !v)}>
            {g.allAddresses}
          </button>
          {showAll && <AddressList t={t} wallet={wallet} rotation={rotation} prices={prices} onChanged={reload} />}
        </>
      )}
      <button class="btn" onClick={onClose}>
        {t.back}
      </button>
    </section>
  );
}

type ProblemCode = 'noFunds' | 'noGas' | 'noRelay' | 'noTron' | 'tooMany' | 'frozenTo' | 'frozenMe' | 'needsMix' | 'pocketShort' | 'held' | 'heldShort' | 'noEth' | 'ethSmall' | 'ethPending';
/** A problem the user can fix, shown as a message on the form. */
class Problem extends Error {
  readonly code: ProblemCode;
  constructor(code: ProblemCode) {
    super(code);
    this.code = code;
  }
}

interface PreparedBase {
  asset: AssetDef;
  to: string;
  amount: bigint;
  /** In the fee asset's base units. For Tron this is an upper bound. */
  fee: bigint;
}
type Prepared =
  | (PreparedBase & { kind: 'evm'; tx: EvmTransaction })
  // USDC sent without ETH: the fee is in USDC, and me7's relay pays the gas.
  | (PreparedBase & { kind: 'gasless'; plan: PaymentPlan; from: PocketedPlan['from']; joined: number; note?: StealthNote })
  | (PreparedBase & { kind: 'btc'; plan: BitcoinSendPlan })
  // A Tron transaction expires a minute after it is built, so it is built at send time.
  | (PreparedBase & { kind: 'tron'; feeLimit: bigint; activates: boolean })
  // USDT on Tron sent without TRX: me7's service rents the energy, and the fee is in USDT, paid by a second transfer to `receiver`.
  | (PreparedBase & { kind: 'tronless'; receiver: string })
  // USDT or USDC on Ethereum sent without ETH: me7's service lends the gas, and the fee is in the token, paid by a transfer of its own (see src/core/ethgas.ts).
  | (PreparedBase & { kind: 'ethless'; terms: EthGasTerms });

async function prepareBitcoin(wallet: Wallet, asset: AssetDef, recipient: string, units: bigint | null): Promise<Prepared> {
  const [utxos, rate] = await Promise.all([
    fetchBitcoinUtxos(NET.btc.esplora, wallet.btc),
    fetchBitcoinFeeRate(NET.btc.esplora),
  ]);
  const plan = planBitcoinSend(utxos, units ?? 'max', rate, dustLimit(recipient, NET.btc.network));
  return { kind: 'btc', asset, to: recipient, plan, amount: plan.amount, fee: plan.fee };
}

async function prepareEvm(wallet: Wallet, asset: AssetDef, recipient: string, units: bigint | null, fixedNonce?: bigint): Promise<Prepared> {
  const chain = evmOf(asset);
  // On Base a little ETH is kept back for the fee that is charged outside the gas estimate.
  const reserve = asset.chain === 'base' ? BASE_L1_RESERVE : 0n;
  const [fees, nonce, coin] = await Promise.all([
    fetchEvmFees(chain.rpc),
    // A run of transfers numbers them itself: the node may not have seen the previous one yet.
    fixedNonce !== undefined ? Promise.resolve(fixedNonce) : fetchEvmNonce(chain.rpc, wallet.evm),
    fetchEvmBalance(chain.rpc, wallet.evm).then((r) => r.value),
  ]);
  const base = { chainId: chain.chainId, nonce, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas };
  if (asset.kind === 'erc20' && asset.contract) {
    // A token transfer is a call to the token contract; the fee is still paid in ETH.
    const held = await fetchErc20Balance(chain.rpc, asset.contract, wallet.evm);
    const value = units ?? held;
    if (value <= 0n || value > held) throw new Problem('noFunds');
    const data = erc20TransferData(recipient, value);
    const gasLimit = await estimateEvmGas(chain.rpc, { from: wallet.evm, to: asset.contract, value: 0n, data: hexOf(data) }, 200_000n);
    const fee = gasLimit * fees.maxFeePerGas;
    if (fee + reserve > coin) throw new Problem('noGas');
    return { kind: 'evm', asset, to: recipient, tx: { ...base, gasLimit, to: asset.contract, value: 0n, data }, amount: value, fee };
  }
  const gasLimit = await estimateEvmGas(chain.rpc, { from: wallet.evm, to: recipient, value: units ?? 1n });
  const fee = gasLimit * fees.maxFeePerGas;
  const value = units ?? coin - fee - reserve;
  if (value <= 0n || value + fee + reserve > coin) throw new Problem('noFunds');
  return { kind: 'evm', asset, to: recipient, tx: { ...base, gasLimit, to: recipient, value }, amount: value, fee };
}

async function prepareTron(wallet: Wallet, asset: AssetDef, recipient: string, units: bigint | null): Promise<Prepared> {
  const [me, them, rates, resources, block] = await Promise.all([
    fetchTronAccount(NET.tron.nodes, wallet.tron),
    fetchTronAccount(NET.tron.nodes, recipient),
    fetchTronFeeRates(NET.tron.nodes),
    fetchTronResources(NET.tron.nodes, wallet.tron),
    fetchTronBlock(NET.tron.nodes),
  ]);
  const ref = tronRef(block, Date.now());
  // Bytes are free while the day's allowance lasts; otherwise each one is paid for.
  const bandwidthFee = (raw: Uint8Array) => (resources.bandwidth >= tronBandwidth(raw) ? 0n : tronBandwidth(raw) * rates.perByte);
  if (asset.kind === 'trc20' && asset.contract) {
    const held = await fetchTrc20Balance(NET.tron.nodes, asset.contract, wallet.tron);
    const value = units ?? held;
    if (value <= 0n || value > held) throw new Problem('noFunds');
    const energy = await estimateTrc20Energy(NET.tron.nodes, asset.contract, wallet.tron, recipient, value);
    // The cap gets a 30% margin: a transfer that runs out of it fails and still costs the fee.
    const feeLimit = (energy * rates.perEnergy * 13n) / 10n;
    const paidEnergy = energy > resources.energy ? ((energy - resources.energy) * rates.perEnergy * 13n) / 10n : 0n;
    const sample = buildTrc20Transfer(wallet.tron, asset.contract, recipient, value, ref, feeLimit);
    const fee = paidEnergy + bandwidthFee(sample);
    if (fee > me.balance) throw new Problem('noGas');
    return { kind: 'tron', asset, to: recipient, amount: value, fee, feeLimit, activates: false };
  }
  // Sending to an address nobody has used yet activates it, for a flat fee instead of the per-byte one.
  const fee = them.exists ? bandwidthFee(buildTronTransfer(wallet.tron, recipient, 1n, ref)) : rates.newAccount;
  const value = units ?? me.balance - fee;
  if (value <= 0n || value + fee > me.balance) throw new Problem('noFunds');
  return { kind: 'tron', asset, to: recipient, amount: value, fee, feeLimit: 0n, activates: !them.exists };
}

/**
 * USDT on Tron for a wallet with no TRX to pay the network: me7's service is asked what it would
 * charge to rent the energy, and the fee comes out of the same USDT.
 */
async function prepareTronless(wallet: Wallet, asset: AssetDef, recipient: string, units: bigint | null): Promise<Prepared> {
  if (!asset.contract) throw new Problem('noGas');
  // An address in quarantine is not served: its owner pays the network in TRX, by their own means.
  if (quarantineOf(wallet, 'tron', wallet.tron)) throw new Problem('held');
  const held = await fetchTrc20Balance(NET.tron.nodes, asset.contract, wallet.tron);
  if (held <= 0n) throw new Problem('noFunds');
  try {
    // Sending everything: the fee is found first, for the whole balance, and what is left after it is sent.
    const first = await fetchTronQuote(wallet.tron, recipient, units ?? held);
    const value = units ?? held - first.fee;
    if (value <= 0n || value + first.fee > held) throw new Problem('noFunds');
    return { kind: 'tronless', asset, to: recipient, amount: value, fee: first.fee, receiver: first.receiver };
  } catch (err) {
    if (err instanceof Problem) throw err;
    // The service could not be asked or would not take it: said as such, not as a lack of TRX the sender can do nothing about.
    throw new Problem(err instanceof RelayError && err.code === 'no-funds' ? 'noFunds' : 'noTron');
  }
}

/** Whether a token on Ethereum can go without ETH: the main network, a token the service carries, and a session that holds the key. */
const canEthless = (wallet: Wallet, asset: AssetDef): boolean =>
  NET.mode === 'mainnet' && asset.kind === 'erc20' && asset.chain !== 'base' && !!asset.contract && asset.contract.toLowerCase() in ETH_GASLESS.tokens && wallet.seed instanceof Uint8Array && wallet.seed.length === 64;

/**
 * A token on Ethereum for a wallet with no ETH to pay the network: me7's service is asked for its terms, and the
 * fee comes out of the same token.
 */
async function prepareEthless(wallet: Wallet, asset: AssetDef, recipient: string, units: bigint | null): Promise<Prepared> {
  const token = asset.contract ?? '';
  const held = await fetchErc20Balance(NET.evm.rpc, token, wallet.evm);
  if (held <= 0n) throw new Problem('noFunds');
  try {
    // Sending everything: the fee is found first, for the whole balance, and what is left after it is sent.
    const first = await fetchEthGasTerms(wallet.evm, token, recipient, units ?? held);
    const value = units ?? held - first.fee;
    if (value <= 0n || value + first.fee > held) throw new Problem('noFunds');
    const terms = units === null ? await fetchEthGasTerms(wallet.evm, token, recipient, value) : first;
    if (value + terms.fee > held) throw new Problem('noFunds');
    return { kind: 'ethless', asset, to: recipient, amount: value, fee: terms.fee, terms };
  } catch (err) {
    if (err instanceof Problem) throw err;
    const code = err instanceof RelayError ? err.code : '';
    throw new Problem(code === 'no-funds' ? 'noFunds' : code === 'small' ? 'ethSmall' : code === 'pending' ? 'ethPending' : 'noEth');
  }
}

/** Sign the fee and the payment, and hand both to me7's service unsent. Returns the payment's transaction hash. */
async function sendEthless(wallet: Wallet, prepared: Extract<Prepared, { kind: 'ethless' }>): Promise<string> {
  const pair = buildEthGasPair(NET.evm.chainId, prepared.asset.contract ?? '', prepared.to, prepared.amount, prepared.terms);
  return withEvmKey(wallet, (key) => relayEthSend(signEvmTransaction(pair.fee, key).raw, signEvmTransaction(pair.main, key).raw));
}

/** Sign the payment and the fee, and hand both to me7's service unsent. Returns the payment's transaction id. */
async function sendTronless(wallet: Wallet, prepared: Extract<Prepared, { kind: 'tronless' }>): Promise<string> {
  const contract = prepared.asset.contract;
  if (!contract) throw new Error('no token contract');
  const once = `tron:${wallet.tron}:${prepared.to}:${prepared.amount}:${prepared.fee}`;
  let pair = signedOnce.get(once);
  if (!pair || pair.until <= Date.now()) {
    const block = await fetchTronBlock(NET.tron.nodes);
    // The service needs time to rent the energy before it sends them, so they stay good for ten minutes, not one.
    const ref = { ...tronRef(block, Date.now()), expiration: block.timestamp + TRON_GASLESS.lifetime };
    const main = buildTrc20Transfer(wallet.tron, contract, prepared.to, prepared.amount, ref, TRON_GASLESS.feeLimit);
    const fee = buildTrc20Transfer(wallet.tron, contract, prepared.receiver, prepared.fee, ref, TRON_GASLESS.feeLimit);
    // Kept while the service is silent, so that a second press sends the same two transfers and not two new ones.
    pair = { until: Date.now() + TRON_GASLESS.lifetime - 60_000, value: await withTronKey(wallet, (key) => ({ main: signTronTransaction(main, key).signedHex, fee: signTronTransaction(fee, key).signedHex })) };
    signedOnce.set(once, pair);
  }
  const signed = pair.value as { main: string; fee: string };
  try {
    const id = await relayTronSend(signed.main, signed.fee);
    heard(once);
    return id;
  } catch (err) {
    heard(once, err);
    if (err instanceof RelayError && err.code === 'held') markTold(wallet, 'tron', wallet.tron);
    throw err;
  }
}

/** Sign and broadcast a prepared transfer of any coin but relayed USDC. Returns the transaction id. */
async function executeTransfer(wallet: Wallet, prepared: Exclude<Prepared, { kind: 'gasless' }>): Promise<string> {
  if (prepared.kind === 'tronless') return sendTronless(wallet, prepared);
  if (prepared.kind === 'ethless') return sendEthless(wallet, prepared);
  if (prepared.kind === 'evm') {
    return withEvmKey(wallet, (key) => {
      const { raw, hash } = signEvmTransaction(prepared.tx, key);
      return broadcastEvm(evmOf(prepared.asset).rpc, raw, hash);
    });
  }
  if (prepared.kind === 'btc') {
    return withBitcoinKey(wallet, (key) => {
      const { hex } = signBitcoinSend(prepared.plan, prepared.to, wallet.btc, key, NET.btc.network);
      return broadcastBitcoin(NET.btc.esplora, hex);
    });
  }
  const ref = tronRef(await fetchTronBlock(NET.tron.nodes), Date.now());
  const contract = prepared.asset.contract;
  const raw =
    prepared.asset.kind === 'trc20' && contract
      ? buildTrc20Transfer(wallet.tron, contract, prepared.to, prepared.amount, ref, prepared.feeLimit)
      : buildTronTransfer(wallet.tron, prepared.to, prepared.amount, ref);
  return withTronKey(wallet, (key) => {
    const signed = signTronTransaction(raw, key);
    return broadcastTron(NET.tron.nodes, signed.signedHex, signed.txid);
  });
}

const isValidRecipient = (a: AssetDef, recipient: string): boolean => {
  const network = networkOf(a);
  return network === 'btc' ? isValidBitcoinAddress(recipient, NET.btc.network) : network === 'tron' ? isValidTronAddress(recipient) : isValidEvmAddress(recipient);
};

function Send({
  t,
  wallet,
  prices,
  initial,
  onClose,
  onAml,
}: {
  t: Dict;
  wallet: Wallet;
  prices: UsdPrices | null;
  initial?: AssetDef;
  onClose: (sent: boolean) => void;
  /** Leave for the address check with the recipient's address in hand. */
  onAml?: (address: string) => void;
}) {
  const [asset, setAsset] = useState<AssetDef | undefined>(initial ?? ASSETS[0]);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [step, setStep] = useState<'form' | 'preparing' | 'review' | 'holding' | 'sending' | 'done'>('form');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [txid, setTxid] = useState('');
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  // Money only leaves after the account password is typed again.
  const [confirm, setConfirm] = useState('');
  // USDC on Base always goes through me7's relay: no ETH is needed, the fee is in USDC.
  const viaRelay = isRotated(asset);
  const [pricing, setPricing] = useState<GaslessPricing | null>(null);
  const [relayAsked, setRelayAsked] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  // The way out when the relay cannot be reached: USDC on the main address can still be sent the
  // ordinary way, paying gas in ETH, so that nobody's money waits on me7's server.
  const [byGas, setByGas] = useState(false);
  // Which pocket pays: left to the wallet, or named by the user. Shown only to those who hold stealth money.
  const [pocket, setPocket] = useState<'auto' | Pocket>('auto');
  const [totals, setTotals] = useState<Record<Pocket, bigint> | null>(null);
  // Joining the two pockets ties their addresses together: it is done only on a second press, for the same payment.
  const [mixOk, setMixOk] = useState('');
  // USDT on Tron can also be paid out of USDC on Base, by way of a Tron address used once.
  const [cross, setCross] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [scanned, setScanned] = useState('');
  // What kind of address is in the field. An address belongs to one family of networks, so the coins of the
  // others cannot be sent to it: their buttons are greyed out, and a coin that no longer fits is changed.
  // A name in the field ("anna.base.eth") is looked up in the blockchain; the money goes to the address it points to.
  const [named, setNamed] = useState<{ name: string; address: string } | 'looking' | 'missing' | 'down' | null>(null);
  useEffect(() => {
    const parsed = parseName(to);
    if (!parsed) return setNamed(null);
    setNamed('looking');
    let live = true;
    // A moment's pause, so that a name is asked about once it is typed, not at every letter.
    const id = setTimeout(() => {
      resolveName(parsed.name).then(
        (found) => live && setNamed(found ? { name: found.name, address: found.address } : 'missing'),
        () => live && setNamed('down'),
      );
    }, 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [to]);
  /** Where the money goes: the address the name stands for, or what is in the field itself. */
  const dest = named && typeof named === 'object' ? named.address : to;
  const destParsed = useMemo(() => parsePayText(dest, NET.btc.network), [dest]);
  // An address that passes for one the wallet knows, yet is another: the mark of a planted fake.
  const known = useMemo(() => knownAddresses(wallet), [wallet]);
  const twin = destParsed ? twinOf(destParsed.address, known) : null;
  const [twinAccepted, setTwinAccepted] = useState('');
  // A stealth code in the field: not an address but the way to make one, for USDC on Base only.
  const stealthTo = useMemo(() => parseStealthCode(to), [to]);
  useEffect(() => {
    if (!stealthTo || isRotated(asset)) return;
    const usdc = ASSETS.find(isRotated);
    if (usdc) setAsset(usdc);
  }, [stealthTo]);
  const toNetwork = destParsed?.network ?? null;
  useEffect(() => {
    if (!toNetwork || !asset || networkOf(asset) === toNetwork) return;
    const next = ASSETS.find((x) => networkOf(x) === toNetwork && (toNetwork !== 'tron' || x.kind === 'trc20')) ?? ASSETS.find((x) => networkOf(x) === toNetwork);
    if (!next) return;
    setAsset(next);
    setScanned(t.pay.switched.replace('{net}', t.pay.nets[toNetwork]).replace('{coin}', `${next.ticker} ${next.net}`));
  }, [toNetwork]);
  const relayDown = viaRelay && relayAsked && !pricing;
  useEffect(() => {
    setPricing(null);
    setRelayAsked(false);
    setByGas(false);
    setTotals(null);
    setPocket('auto');
    if (!viaRelay) return;
    let live = true;
    void fetchRelayPricing().then((prices) => {
      if (!live) return;
      setPricing(prices);
      setRelayAsked(true);
    });
    loadRotation(wallet).then(
      (r) => live && setTotals(pocketTotals(r.spendable)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [viaRelay]);

  if (!asset) return null;
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(usdValue(a, units, prices))}` : '');

  const prepareGasless = async (recipient: string, units: bigint | null, prefer: Pocket, mix: boolean): Promise<Prepared> => {
    // Balances and the price are read again at this moment: both may have moved since the form was opened.
    const [rotation, prices] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
    if (!prices) {
      // The relay went away after the form was opened: show the way out.
      setPricing(null);
      setRelayAsked(true);
      throw new Problem('noRelay');
    }
    setPricing(prices);
    // The fee comes out of the same USDC, on top of what the recipient gets.
    setTotals(pocketTotals(rotation.spendable));
    // Stealth money pays stealth codes and the rest pays ordinary addresses; the two are joined only when the user has agreed.
    const planned = planFromPockets(rotation.spendable, units === null ? { all: recipient } : [{ to: recipient, value: units }], prices, rotation.fresh, { prefer, choice: pocket, mix });
    // Money on a quarantined address is the user's, but me7's service does not pay from it: say so, and not "no funds".
    if (planned === 'no-funds') throw new Problem(rotation.spendable.length < rotation.holdings.length ? 'heldShort' : 'noFunds');
    if (planned === 'too-many') throw new Problem('tooMany');
    if (planned === 'needs-mix') throw new Problem('needsMix');
    if (planned === 'pocket-short') throw new Problem('pocketShort');
    announcePlan(planned.plan);
    const { plan, from, joined } = planned;
    return { kind: 'gasless', asset, to: recipient, amount: plan.payouts[0]?.value ?? 0n, fee: plan.fee, plan, from, joined };
  };

  const prepare = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (named === 'looking') return setError(t.pay.nameLooking);
    if (named === 'missing') return setError(t.pay.nameMissing);
    if (named === 'down') return setError(t.pay.nameDown);
    let recipient = dest.trim();
    const network = networkOf(asset);
    // Paying by a stealth code: a new address is worked out here, with a key used this once, and the money goes there.
    let hidden: { address: string; ephemeralPubKey: string; viewTag: number } | null = null;
    if (stealthTo) {
      if (!isRotated(asset) || !viaRelay || byGas || !NET.base) return setError(t.stealth.onlyUsdc);
      try {
        const paid = stealthAddressFor(stealthTo, crypto.getRandomValues(new Uint8Array(32)));
        hidden = { address: paid.address, ephemeralPubKey: hexOf(paid.ephemeralPubKey), viewTag: paid.viewTag };
        recipient = paid.address;
      } catch {
        return setError(t.badAddress);
      }
    }
    if (!isValidRecipient(asset, recipient)) return setError(t.badAddress);
    const units = all ? null : parseUnits(amount, asset.decimals);
    if (!all && (units === null || units <= 0n)) return setError(t.badAmount);
    // A look-alike of a known address stops the first press: the second one is the user's own decision.
    if (twin && twinAccepted !== recipient) {
      setTwinAccepted(recipient);
      return setError(t.guard.lookalikeStop);
    }
    const mixKey = `${to.trim()}|${all ? 'all' : amount.trim()}|${pocket}`;
    setStep('preparing');
    try {
      if (asset.contract === NET.tron.usdt) {
        // Tether freezes addresses, and its contract says which. If the answer cannot be had, the transfer is not held up.
        const [toFrozen, meFrozen] = await Promise.all([recipient, wallet.tron].map((a) => fetchTrc20Frozen(NET.tron.nodes, NET.tron.usdt, a).catch(() => false)));
        if (meFrozen) throw new Problem('frozenMe');
        if (toFrozen) throw new Problem('frozenTo');
      }
      const ready =
        network === 'btc'
          ? await prepareBitcoin(wallet, asset, recipient, units)
          : network === 'tron'
            ? // A wallet with TRX pays the network itself; one without it sends USDT through me7's service.
              await prepareTron(wallet, asset, recipient, units).catch((err: unknown) => {
                if (!(err instanceof Problem) || err.code !== 'noGas' || asset.contract !== NET.tron.usdt) throw err;
                return prepareTronless(wallet, asset, recipient, units);
              })
            : viaRelay && !byGas
              ? await prepareGasless(recipient, units, hidden ? 'stealth' : 'plain', mixOk === mixKey)
              : // A wallet with ETH pays the network itself; one without it sends USDT or USDC through me7's service.
                await prepareEvm(wallet, asset, recipient, units).catch((err: unknown) => {
                  if (!(err instanceof Problem) || err.code !== 'noGas' || !canEthless(wallet, asset)) throw err;
                  return prepareEthless(wallet, asset, recipient, units);
                });
      // The note that lets the receiver find the payment travels with it, in the same operation.
      const note = hidden && ready.kind === 'gasless' && NET.base ? { stealthAddress: hidden.address, ephemeralPubKey: hidden.ephemeralPubKey, metadata: hexOf(tokenMetadata(hidden.viewTag, NET.base.usdc, ready.amount)) } : null;
      if (hidden && !note) throw new Problem('noRelay');
      setPrepared(note && ready.kind === 'gasless' ? { ...ready, note } : ready);
      setStep('review');
    } catch (err) {
      const code = err instanceof BitcoinSendError || err instanceof Problem ? err.code : '';
      // The first press only says what joining the pockets means; the same payment pressed again goes ahead.
      setMixOk(code === 'needsMix' ? mixKey : '');
      setError(
        code === 'needsMix'
          ? t.pockets.mixStop
          : code === 'pocketShort'
            ? t.pockets.short.replace('{sum}', pocket === 'auto' ? '' : amountText(asset, (totals ?? { plain: 0n, stealth: 0n })[pocket]))
            : code === 'insufficient-funds' || code === 'noFunds'
          ? t.noFunds
          : code === 'noGas'
            ? t.noGas
            : code === 'frozenTo'
              ? t.guard.frozenTo
              : code === 'frozenMe'
                ? t.guard.frozenMe
              : code === 'held'
                ? t.held.errSend
              : code === 'heldShort'
                ? t.held.errShort
            : code === 'noRelay'
              ? t.gasless.unavailable
              : code === 'noTron'
                ? t.tronless.unavailable
              : code === 'noEth'
                ? t.ethless.unavailable
              : code === 'ethSmall'
                ? t.ethless.small
              : code === 'ethPending'
                ? t.ethless.pending
              : code === 'tooMany'
                ? t.gasless.tooMany
            : code === 'dust'
              ? t.dust
              : code === 'bad-input'
                ? t.badAmount
                : t.nodesDown,
      );
      setStep('form');
    }
  };

  /** Put what the scanner read into the form. Nothing is sent: it is checked and confirmed like anything typed. */
  const applyScan = (r: PayRequest) => {
    setScanning(false);
    setError('');
    const onChain = (x: AssetDef) => networkOf(x) === 'evm' && (r.chainId === undefined || evmOf(x).chainId === r.chainId);
    let next: AssetDef | undefined;
    if (r.asset) next = ASSETS.find((x) => x.id === r.asset && networkOf(x) === r.network && (r.network !== 'evm' || onChain(x)));
    if (!next && r.token) {
      const token = r.token.toLowerCase();
      next = ASSETS.find((x) => x.kind === 'erc20' && onChain(x) && x.contract?.toLowerCase() === token);
      if (!next) return setError(t.pay.unknownToken);
    }
    // An amount in the chain's smallest units with no token named is the chain's own coin.
    if (!next && r.network === 'evm' && r.baseUnits) next = ASSETS.find((x) => x.kind === 'eth' && onChain(x));
    if (!next && r.network === 'evm') next = networkOf(asset) === 'evm' && onChain(asset) ? asset : ASSETS.find(onChain);
    if (!next && r.network === 'tron') next = networkOf(asset) === 'tron' ? asset : ASSETS.find((x) => x.kind === 'trc20');
    if (!next && r.network === 'btc') next = ASSETS.find((x) => x.kind === 'btc');
    if (!next) return setError(t.pay.unknownNetwork);
    setAsset(next);
    setTo(r.address);
    if (r.amount) {
      setAll(false);
      setAmount(r.baseUnits ? formatUnits(BigInt(r.amount), next.decimals, next.decimals) : r.amount);
    }
    // A bare address says nothing about the coin or, for Ethereum-style addresses, even the network:
    // the wallet must not claim the code chose them. It says what the code did hold, and what is still the sender's call.
    const named = !!(r.asset || r.token) || r.network === 'btc' || (r.network === 'evm' && !!r.baseUnits);
    const says = named ? t.pay.scanned : r.network === 'tron' ? t.pay.scannedTron : t.pay.scannedEvm;
    setScanned(says.replace('{coin}', `${next.ticker} ${next.net}`));
  };
  if (scanning) return <Scanner t={t} onResult={applyScan} onClose={() => setScanning(false)} />;
  // An address heard as sound is a changing address for USDC on Base: it fills the form as a scanned code would, and its code is shown to be compared.
  const applyHeard = (address: string) => {
    setHearing(false);
    applyScan({ network: 'evm', address, asset: 'usdc-base' });
    setScanned(heardNote(t, address));
  };
  if (hearing) return <Hearer t={t} onResult={applyHeard} onClose={() => setHearing(false)} />;

  const send = async () => {
    if (!prepared) return;
    if (!isSessionPassword(confirm)) {
      setError(t.wrongPassword);
      return;
    }
    setConfirm('');
    setError('');
    // Ten seconds in which the payment can still be called off; only then is anything signed or sent.
    setStep('holding');
  };
  const launch = async () => {
    if (!prepared) return;
    setStep('sending');
    try {
      const id = prepared.kind === 'gasless' ? await sendPlan(wallet, prepared.plan, prepared.note ? [prepared.note] : undefined) : await executeTransfer(wallet, prepared);
      // An address made for one stealth payment is not one the wallet will ever pay again: it is not remembered.
      if (!(prepared.kind === 'gasless' && prepared.note)) rememberPaid(wallet, [prepared.to]);
      setTxid(id);
      setSentAt(new Date());
      setStep('done');
    } catch (err) {
      setError(relayErrorText(t, err));
      setStep('review');
    }
  };

  if (step === 'holding' && prepared) {
    return (
      <Hold
        t={t}
        lines={[`${t.hold.to}: ${prepared.to}`, `${t.pay.code}: ${addressCode(prepared.to)}`]}
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
          <Spinner /> {step === 'preparing' ? t.preparing : t.sending}…
        </p>
      </section>
    );
  }

  if (step === 'done' && prepared) {
    const explorer = prepared.kind === 'btc' ? NET.btc.explorerTx : prepared.kind === 'tron' || prepared.kind === 'tronless' ? NET.tron.explorerTx : evmOf(prepared.asset).explorerTx;
    const a = prepared.asset;
    const feeAsset = prepared.kind === 'gasless' || prepared.kind === 'tronless' || prepared.kind === 'ethless' ? a : feeAssetOf(a);
    return (
      <section class="panel">
        <h2 class="title">{t.sentTitle}</h2>
        <p class="lead">{t.sentNote}</p>
        {/* The report: what went, to whom, for how much, and where to find it in the network. */}
        <dl class="review">
          <dt>{t.sendAmount}</dt>
          <dd class="review-total">
            {amountText(a, prepared.amount)} {a.ticker} <span class="dim">{a.net}</span>
            <span class="dim">{usd(a, prepared.amount)}</span>
          </dd>
          <dt>{t.sendTo}</dt>
          <dd class="review-addr">
            {named && typeof named === 'object' && named.address === prepared.to && <b class="review-name">{named.name}</b>}
            {prepared.to}
          </dd>
          <dt>{t.pay.code}</dt>
          <dd>{addressCode(prepared.to)}</dd>
          <dt>{prepared.kind === 'tron' ? t.feeUpTo : prepared.kind === 'gasless' || prepared.kind === 'tronless' || prepared.kind === 'ethless' ? t.gasless.feeLabel : t.fee}</dt>
          <dd>
            {amountText(feeAsset, prepared.fee)} {feeAsset.ticker}
            <span class="dim">{usd(feeAsset, prepared.fee)}</span>
          </dd>
          <dt>{t.report.when}</dt>
          <dd>{sentAt ? sentAt.toLocaleString() : '—'}</dd>
          <dt>{t.report.id}</dt>
          <dd class="review-addr">
            <Scramble text={txid} speed={8} />
          </dd>
        </dl>
        <div class="row">
          <CopyButton t={t} value={txid} />
          <a class="btn" href={explorer(txid)} target="_blank" rel="noopener noreferrer">
            {t.viewTx}
          </a>
        </div>
        <button class="btn btn--accent" onClick={() => onClose(true)}>
          {t.done}
        </button>
      </section>
    );
  }

  if (step === 'review' && prepared) {
    const a = prepared.asset;
    // Tokens are paid for in two currencies: the token itself and the network's coin for the fee.
    const feeAsset = prepared.kind === 'gasless' || prepared.kind === 'tronless' || prepared.kind === 'ethless' ? a : feeAssetOf(a);
    const sameCoin = feeAsset.id === a.id;
    return (
      <section class="panel">
        <h2 class="title">{t.reviewTitle}</h2>
        <dl class="review">
          <dt>{t.sendTo}</dt>
          <dd class="review-addr">
            {named && typeof named === 'object' && named.address === prepared.to && <b class="review-name">{named.name}</b>}
            {prepared.to}
          </dd>
          <dt>{t.pay.code}</dt>
          <dd>
            <AddressCode t={t} address={prepared.to} />
            <span class="dim facts-warn">{t.pay.codeCheck}</span>
          </dd>
          <dt>{t.sendAmount}</dt>
          <dd>
            {amountText(a, prepared.amount)} {a.ticker} <span class="dim">{a.net}</span>
            <span class="dim">{usd(a, prepared.amount)}</span>
          </dd>
          <dt>{prepared.kind === 'tron' ? t.feeUpTo : prepared.kind === 'gasless' || prepared.kind === 'tronless' || prepared.kind === 'ethless' ? t.gasless.feeLabel : t.fee}</dt>
          <dd>
            {amountText(feeAsset, prepared.fee)} {feeAsset.ticker}
            <span class="dim">{usd(feeAsset, prepared.fee)}</span>
          </dd>
          <dt>{t.total}</dt>
          <dd class="review-total">
            {sameCoin ? (
              <>
                {amountText(a, prepared.amount + prepared.fee)} {a.ticker}
                <span class="dim">{usd(a, prepared.amount + prepared.fee)}</span>
              </>
            ) : (
              <>
                {amountText(a, prepared.amount)} {a.ticker} + {amountText(feeAsset, prepared.fee)} {feeAsset.ticker}
                <span class="dim">
                  {prices ? ` ≈ ${usdFormat.format(usdValue(a, prepared.amount, prices) + usdValue(feeAsset, prepared.fee, prices))}` : ''}
                </span>
              </>
            )}
          </dd>
        </dl>
        {prepared.kind === 'tron' && prepared.activates && <p class="note">{t.tronNewAddress}</p>}
        {prepared.kind === 'tronless' && <p class="note">{t.tronless.note}</p>}
        {prepared.kind === 'ethless' && <p class="note">{t.ethless.note}</p>}
        {prepared.kind === 'gasless' && prepared.note && <p class="note">{t.stealth.reviewNote}</p>}
        {prepared.kind === 'gasless' && prepared.from === 'both' && <p class="alert">{t.pockets.reviewMix}</p>}
        {prepared.kind === 'gasless' && prepared.from !== 'both' && prepared.joined > 0 && <p class="note">{t.pockets.reviewJoined.replace('{n}', String(prepared.joined))}</p>}
        {prepared.kind === 'gasless' && (
          <p class="note">
            {prepared.plan.via && `${t.gasless.gathered.replace('{n}', String(prepared.plan.sources.length))} `}
            {t.gasless.reviewNote}
          </p>
        )}
        <p class="alert">{t.reviewNote}</p>
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input
            class="input"
            type="password"
            autocomplete="off"
            value={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
          />
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" onClick={() => setStep('form')}>
            {t.back}
          </button>
          <button class="btn btn--accent" onClick={() => void send()}>
            {t.sendNow}
          </button>
        </div>
      </section>
    );
  }

  const rail = railFor(wallet, asset);
  const crossable = rail !== null;
  if (cross && rail) {
    return <CrossPay t={t} wallet={wallet} rail={rail} initialTo={dest.trim()} initialAmount={all ? '' : amount} onPlain={(a, v) => (setTo(a), setAmount(v), setCross(false))} onClose={onClose} />;
  }
  const isToken = asset.kind === 'erc20' || asset.kind === 'trc20';
  // Contacts saved for this coin: one tap puts the address in.
  const saved = loadContacts(wallet.evm).filter((c) => c.asset === asset.id);
  // What the typed amount is worth right now, shown under the field as it is typed.
  const typed = all ? null : parseUnits(amount, asset.decimals);
  const typedUsd = typed !== null && typed > 0n && prices ? usdValue(asset, typed, prices) : null;
  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
      <h2 class="title">{t.sendTitle}</h2>
      <div class="seg seg--four" role="tablist">
        {ASSETS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={a.id === asset.id}
            class="seg-item"
            disabled={toNetwork !== null && networkOf(a) !== toNetwork}
            onClick={() => {
              setAsset(a);
              setError('');
            }}
          >
            {a.ticker}
            <span class="seg-net">{a.net}</span>
          </button>
        ))}
      </div>
      {crossable && (
        <div class="field">
          <span class="field-label">{t.cross.modeLabel}</span>
          <span class="chips" role="radiogroup" aria-label={t.cross.modeLabel}>
            <button type="button" role="radio" aria-checked={true} class="chip chip--on">
              {t.cross.modePlain}
            </button>
            <button type="button" role="radio" aria-checked={false} class="chip" onClick={() => (setError(''), setCross(true))}>
              {t.cross.modeCross}
            </button>
          </span>
        </div>
      )}
      <label class="field">
        <span class="field-label">
          {t.sendTo} <span class="dim">({asset.net})</span>
        </span>
        <span class={NET.base ? 'field-row field-row--two' : 'field-row'}>
          <input
            class="input"
            type="text"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            placeholder={t.pay.toHint}
            value={to}
            onInput={(e) => (setTo(e.currentTarget.value), setScanned(''))}
          />
          <button type="button" class="btn" onClick={() => setScanning(true)}>
            {t.pay.scan}
          </button>
          {NET.base && (
            <button type="button" class="btn" onClick={() => setHearing(true)}>
              {t.whisper.listen}
            </button>
          )}
        </span>
        {scanned && <span class="dim">{scanned}</span>}
        {named === 'looking' && (
          <span class="dim" role="status">
            {t.pay.nameLooking} <Spinner />
          </span>
        )}
        {named === 'missing' && <span class="dim">{t.pay.nameMissing}</span>}
        {named === 'down' && <span class="dim">{t.pay.nameDown}</span>}
        {named && typeof named === 'object' && (
          <span class="name-found">
            <span class="dim">{t.pay.nameFound.replace('{name}', named.name)}</span>
            <code class="addr-value">{named.address}</code>
            <AddressCode t={t} address={named.address} />
          </span>
        )}
        {/* The code of whatever address is in the field, however it got there: typed, pasted, scanned or picked. */}
        {destParsed && !(named && typeof named === 'object') && (
          <span class="name-found">
            <AddressCode t={t} address={destParsed.address} />
            <span class="dim">{t.pay.codeAsk}</span>
          </span>
        )}
        {destParsed && onAml && (
          <button type="button" class="linklike" onClick={() => onAml(destParsed.address)}>
            {t.aml.checkThis}
          </button>
        )}
        {twin && (
          <span class="alert" role="alert">
            {t.guard.lookalike.replace('{known}', twin)}
          </span>
        )}
        {stealthTo && (
          <span class="name-found">
            <AddressCode t={t} address={stealthTo.meta} />
            <span class="dim">{t.stealth.payNote}</span>
          </span>
        )}
        {saved.length > 0 && (
          <span class="chips">
            {saved.map((c) => (
              <button key={c.id} type="button" class={cls('chip', c.address === to && 'chip--on')} onClick={() => setTo(c.address)}>
                {c.name}
              </button>
            ))}
          </span>
        )}
      </label>
      <label class="field">
        <span class="field-label">
          {t.sendAmount}, {asset.ticker}
        </span>
        <span class="amount-row">
          <input
            class="input"
            type="text"
            inputMode="decimal"
            placeholder={all ? t.sendAllHint : '0.0'}
            disabled={all}
            value={all ? '' : amount}
            onInput={(e) => setAmount(e.currentTarget.value)}
          />
          <button type="button" class={cls('btn', all && 'btn--accent')} aria-pressed={all} onClick={() => setAll((v) => !v)}>
            {t.sendMax}
          </button>
        </span>
        <span class="dim amount-usd" aria-live="polite">
          {typedUsd !== null ? `≈ ${typedUsd < 0.01 ? '< $0.01' : usdFormat.format(typedUsd)}` : '\u00a0'}
        </span>
      </label>
      {viaRelay && byGas ? (
        <>
          <p class="note">{t.gasless.exitNote}</p>
          {!relayDown && (
            <button type="button" class="linklike" onClick={() => setByGas(false)}>
              {t.gasless.exitBack}
            </button>
          )}
        </>
      ) : relayDown ? (
        <>
          <p class="alert">{t.gasless.unavailable}</p>
          <button type="button" class="btn" onClick={() => (setByGas(true), setError(''))}>
            {t.gasless.exitButton}
          </button>
        </>
      ) : viaRelay ? (
        <>
          {totals && totals.stealth > 0n && (
            <div class="field">
              <span class="field-label">{t.pockets.label}</span>
              <span class="chips" role="radiogroup" aria-label={t.pockets.label}>
                {(['auto', 'plain', 'stealth'] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={pocket === p} class={cls('chip', pocket === p && 'chip--on')} onClick={() => (setPocket(p), setError(''))}>
                    {t.pockets[p]}
                    {p !== 'auto' && <span class="dim"> {amountText(asset, totals[p])}</span>}
                  </button>
                ))}
              </span>
            </div>
          )}
          <p class="note">
            {pricing ? t.gasless.note.replace('{fee}', amountText(asset, gaslessFee(pricing, 1, 1))) : relayAsked ? t.gasless.unavailable : '\u00a0'}{' '}
            <button type="button" class="linklike" onClick={() => setShowPolicy((v) => !v)}>
              {t.gasless.policyLink}
            </button>
          </p>
          {showPolicy && (
            <ul class="note policy">
              {t.gasless.policy.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        isToken && <p class="note">{asset.contract === NET.tron.usdt ? t.tronless.hint : t.tokenFeeNote}</p>
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

/** The address book: add a named address for a coin, remove one, or start a run of payments to several. */
function Contacts({ t, wallet, onClose, onMulti }: { t: Dict; wallet: Wallet; onClose: () => void; onMulti: () => void }) {
  const b = t.book;
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts(wallet.evm));
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState(ASSETS[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  // Whether the list matches the encrypted copy on me7's store, which is what brings it to other devices.
  const [synced, setSynced] = useState<'synced' | 'offline' | 'local' | null>(null);
  const sync = useCallback(() => {
    void syncContacts(wallet).then((result) => {
      setSynced(result);
      setContacts(loadContacts(wallet.evm));
    });
  }, [wallet]);
  useEffect(sync, [sync]);
  // A stealth code in the field settles the coin: it pays USDC on Base and nothing else.
  useEffect(() => {
    const usdc = ASSETS.find(isRotated);
    if (usdc && parseStealthCode(address.trim())) setAssetId(usdc.id);
  }, [address]);
  const store = (next: Contact[]) => {
    setContacts(next);
    saveContacts(wallet.evm, next);
    markContactsChanged(wallet.evm);
    sync();
  };
  const add = (e: Event) => {
    e.preventDefault();
    const a = ASSETS.find((x) => x.id === assetId);
    if (!a) return;
    if (!name.trim()) return setError(b.badName);
    // A stealth code is kept as it is: the address is made anew at every payment. It pays USDC on Base and nothing else.
    const code = parseStealthCode(address.trim());
    const coin = code ? ASSETS.find(isRotated) : a;
    if (!coin) return setError(t.stealth.onlyUsdc);
    if (!code && !isValidRecipient(coin, address.trim())) return setError(t.badAddress);
    store(withContact(contacts, { name, address, asset: coin.id }, hexOf(crypto.getRandomValues(new Uint8Array(8)))));
    setName('');
    setAddress('');
    setError('');
  };
  return (
    <section class="panel">
      <h2 class="title">{b.title}</h2>
      {contacts.length === 0 ? (
        <p class="lead">{b.empty}</p>
      ) : (
        <ul class="rows">
          {contacts.map((c) => {
            const a = ASSETS.find((x) => x.id === c.asset);
            return (
              <li key={c.id} class="asset-li">
                <div class="asset-row asset-row--plain">
                  <span class="asset-name">
                    <span>
                      {c.name}{' '}
                      <span class="dim">
                        {a ? `${a.ticker} ${a.net}` : c.asset} · {parseStealthCode(c.address) ? 'stealth ' : ''}
                        {shortAddress(c.address)}
                      </span>
                    </span>
                  </span>
                  <button class="btn btn--small" aria-label={`${b.remove} ${c.name}`} onClick={() => store(contacts.filter((x) => x.id !== c.id))}>
                    {b.remove}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form class="book-form" autocomplete="off" onSubmit={add}>
        <h3 class="label">{b.addTitle}</h3>
        <label class="field">
          <span class="field-label">{b.name}</span>
          <input class="input" type="text" maxLength={CONTACT_NAME_MAX} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <span class="field-label">{b.coin}</span>
        <div class="seg seg--four" role="tablist">
          {ASSETS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === assetId} class="seg-item" onClick={() => setAssetId(a.id)}>
              {a.ticker}
              <span class="seg-net">{a.net}</span>
            </button>
          ))}
        </div>
        <label class="field">
          <span class="field-label">{b.address}</span>
          <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} value={address} onInput={(e) => setAddress(e.currentTarget.value)} />
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn">
          {b.add}
        </button>
      </form>
      <p class={synced === 'offline' ? 'alert' : 'note'}>{synced === 'offline' ? b.syncOffline : synced === 'local' ? b.localNote : b.syncNote}</p>
      <div class="row">
        <button class="btn" onClick={onClose}>
          {t.back}
        </button>
        <button class="btn btn--accent" disabled={contacts.every((c) => ASSETS.find((a) => a.id === c.asset)?.kind === 'btc')} onClick={onMulti}>
          {b.multi}
        </button>
      </div>
    </section>
  );
}

type Batch = { asset: AssetDef; rows: { contact: Contact; value: bigint }[]; fee: bigint } & ({ kind: 'relay'; plan: PaymentPlan; notes: StealthNote[]; from: PocketedPlan['from']; joined: number } | { kind: 'each'; prepared: Exclude<Prepared, { kind: 'gasless' }>[] });

/**
 * Paying several contacts at once. USDC on Base goes to all of them in one
 * operation through the relay; any other coin goes as one transfer after
 * another, each with its own network fee, behind a single password.
 */
function MultiSend({ t, wallet, prices, onClose }: { t: Dict; wallet: Wallet; prices: UsdPrices | null; onClose: (sent: boolean) => void }) {
  const b = t.book;
  const contacts = useMemo(() => loadContacts(wallet.evm), [wallet]);
  // Bitcoin is left out: its transfers spend each other's change and cannot be queued this way.
  const assets = ASSETS.filter((a) => a.kind !== 'btc' && contacts.some((c) => c.asset === a.id));
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'form' | 'preparing' | 'review' | 'holding' | 'sending' | 'done'>('form');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [mixOk, setMixOk] = useState('');
  const asset = assets.find((a) => a.id === assetId) ?? assets[0];
  if (!asset) {
    return (
      <section class="panel">
        <h2 class="title">{b.multiTitle}</h2>
        <p class="lead">{b.multiNone}</p>
        <button class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
      </section>
    );
  }
  const mine = contacts.filter((c) => c.asset === asset.id);
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(usdValue(a, units, prices))}` : '');

  const prepare = async (e: Event) => {
    e.preventDefault();
    setError('');
    const rows: { contact: Contact; value: bigint }[] = [];
    for (const contact of mine) {
      const typed = (amounts[contact.id] ?? '').trim();
      if (!typed) continue;
      const value = parseUnits(typed, asset.decimals);
      if (value === null || value <= 0n) return setError(`${t.badAmount} (${contact.name})`);
      rows.push({ contact, value });
    }
    if (rows.length === 0) return setError(b.noRows);
    const mixKey = rows.map((r) => `${r.contact.id}:${r.value}`).join('|');
    setStep('preparing');
    try {
      if (isRotated(asset)) {
        const [rotation, pricing] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
        if (!pricing) throw new Problem('noRelay');
        // A contact kept as a stealth code is paid on an address made here and now, with a note for its owner in the same operation.
        const notes: StealthNote[] = [];
        const payouts = rows.map((r) => {
          const target = parseStealthCode(r.contact.address);
          if (!target) return { to: r.contact.address, value: r.value };
          if (!NET.base) throw new Problem('noRelay');
          const paid = stealthAddressFor(target, crypto.getRandomValues(new Uint8Array(32)));
          notes.push({ stealthAddress: paid.address, ephemeralPubKey: hexOf(paid.ephemeralPubKey), metadata: hexOf(tokenMetadata(paid.viewTag, NET.base.usdc, r.value)) });
          return { to: paid.address, value: r.value };
        });
        if (notes.length > GASLESS_MAX_NOTES) throw new Problem('tooMany');
        // A run made only of stealth codes is paid with stealth money first; any other with the rest. The pockets are joined only on a second press.
        const planned = planFromPockets(rotation.spendable, payouts, pricing, rotation.fresh, { prefer: notes.length === rows.length ? 'stealth' : 'plain', choice: 'auto', mix: mixOk === mixKey });
        if (planned === 'no-funds') throw new Problem('noFunds');
        if (planned === 'too-many') throw new Problem('tooMany');
        if (planned === 'needs-mix') throw new Problem('needsMix');
        if (planned === 'pocket-short') throw new Problem('noFunds');
        announcePlan(planned.plan);
        setBatch({ kind: 'relay', asset, rows, fee: planned.plan.fee, plan: planned.plan, notes, from: planned.from, joined: planned.joined });
      } else {
        const evm = networkOf(asset) === 'evm';
        const first = evm ? await fetchEvmNonce(evmOf(asset).rpc, wallet.evm) : 0n;
        const prepared: Exclude<Prepared, { kind: 'gasless' }>[] = [];
        for (const [i, row] of rows.entries()) {
          const one = evm ? await prepareEvm(wallet, asset, row.contact.address, row.value, first + BigInt(i)) : await prepareTron(wallet, asset, row.contact.address, row.value);
          if (one.kind === 'gasless') throw new Error('unexpected');
          prepared.push(one);
        }
        // Each transfer was checked on its own; together they must fit as well.
        const fee = prepared.reduce((sum, p) => sum + p.fee, 0n);
        const paid = rows.reduce((sum, r) => sum + r.value, 0n);
        const feeAsset = feeAssetOf(asset);
        const [held, coin] = await Promise.all([loadBalance(asset, wallet), loadBalance(feeAsset, wallet)]);
        if (feeAsset.id === asset.id ? paid + fee > held.units : paid > held.units) throw new Problem('noFunds');
        if (feeAsset.id !== asset.id && fee > coin.units) throw new Problem('noGas');
        setBatch({ kind: 'each', asset, rows, fee, prepared });
      }
      setStep('review');
    } catch (err) {
      const code = err instanceof Problem ? err.code : '';
      setMixOk(code === 'needsMix' ? mixKey : '');
      setError(code === 'needsMix' ? t.pockets.mixStop : code === 'noFunds' ? t.noFunds : code === 'noGas' ? t.noGas : code === 'noRelay' ? t.gasless.unavailable : code === 'tooMany' ? t.gasless.tooMany : t.nodesDown);
      setStep('form');
    }
  };

  const send = async () => {
    if (!batch) return;
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    setError('');
    setStep('holding');
  };
  const launch = async () => {
    if (!batch) return;
    setStep('sending');
    const ids: string[] = [];
    try {
      if (batch.kind === 'relay') ids.push(await sendPlan(wallet, batch.plan, batch.notes));
      else for (const one of batch.prepared) ids.push(await executeTransfer(wallet, one));
      setSent(ids);
      setStep('done');
    } catch (err) {
      setSent(ids);
      // Some may have gone before the failure: say exactly how many, so nothing is paid twice.
      setError(batch.kind === 'each' && ids.length > 0 ? `${b.partial.replace('{done}', String(ids.length)).replace('{n}', String(batch.rows.length))} ${relayErrorText(t, err)}` : relayErrorText(t, err));
      setStep(ids.length > 0 ? 'done' : 'review');
    }
  };

  if (step === 'holding' && batch) {
    return (
      <Hold
        t={t}
        lines={[`${t.hold.recipients}: ${batch.rows.length}`]}
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
          <Spinner /> {step === 'preparing' ? t.preparing : t.sending}…
        </p>
      </section>
    );
  }
  if (step === 'done' && batch) {
    const explorer = networkOf(batch.asset) === 'tron' ? NET.tron.explorerTx : evmOf(batch.asset).explorerTx;
    return (
      <section class="panel">
        <h2 class="title">{t.sentTitle}</h2>
        {error ? (
          <p class="alert" role="alert">
            {error}
          </p>
        ) : (
          <p class="lead">{t.sentNote}</p>
        )}
        {sent.map((id, i) => (
          <a key={id} class="btn" href={explorer(id)} target="_blank" rel="noopener noreferrer">
            {batch.kind === 'relay' ? t.viewTx : `${t.viewTx}: ${batch.rows[i]?.contact.name ?? ''}`}
          </a>
        ))}
        <button class="btn btn--accent" onClick={() => onClose(true)}>
          {t.done}
        </button>
      </section>
    );
  }
  if (step === 'review' && batch) {
    const a = batch.asset;
    const feeAsset = batch.kind === 'relay' ? a : feeAssetOf(a);
    const paid = batch.rows.reduce((sum, r) => sum + r.value, 0n);
    return (
      <section class="panel">
        <h2 class="title">{t.reviewTitle}</h2>
        <ul class="rows">
          {batch.rows.map((r) => (
            <li key={r.contact.id} class="asset-li">
              <div class="asset-row asset-row--plain">
                <span class="asset-name">
                  <span>
                    {r.contact.name} <span class="dim">{shortAddress(r.contact.address)}</span>
                  </span>
                </span>
                <span class="num">
                  {amountText(a, r.value)} {a.ticker}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <dl class="review">
          <dt>{b.recipients}</dt>
          <dd>
            {batch.rows.length} · {amountText(a, paid)} {a.ticker} <span class="dim">{a.net}</span>
            <span class="dim">{usd(a, paid)}</span>
          </dd>
          <dt>{batch.kind === 'relay' ? t.gasless.feeLabel : b.feeAll}</dt>
          <dd>
            {amountText(feeAsset, batch.fee)} {feeAsset.ticker}
            <span class="dim">{usd(feeAsset, batch.fee)}</span>
          </dd>
          {feeAsset.id === a.id && (
            <>
              <dt>{t.total}</dt>
              <dd class="review-total">
                {amountText(a, paid + batch.fee)} {a.ticker}
                <span class="dim">{usd(a, paid + batch.fee)}</span>
              </dd>
            </>
          )}
        </dl>
        <p class="note">
          {batch.kind === 'relay' ? `${batch.plan.via ? `${t.gasless.gathered.replace('{n}', String(batch.plan.sources.length))} ` : ''}${b.multiUsdc}` : b.multiEach}
        </p>
        {batch.kind === 'relay' && batch.from === 'both' && <p class="alert">{t.pockets.reviewMix}</p>}
        {batch.kind === 'relay' && batch.from !== 'both' && batch.joined > 0 && <p class="note">{t.pockets.reviewJoined.replace('{n}', String(batch.joined))}</p>}
        <p class="alert">{t.reviewNote}</p>
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} />
        </label>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" onClick={() => setStep('form')}>
            {t.back}
          </button>
          <button class="btn btn--accent" onClick={() => void send()}>
            {t.sendNow}
          </button>
        </div>
      </section>
    );
  }
  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
      <h2 class="title">{b.multiTitle}</h2>
      <p class="lead">{b.multiLead}</p>
      {assets.length > 1 && (
        <div class="seg seg--four" role="tablist">
          {assets.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === asset.id} class="seg-item" onClick={() => (setAssetId(a.id), setError(''))}>
              {a.ticker}
              <span class="seg-net">{a.net}</span>
            </button>
          ))}
        </div>
      )}
      {mine.map((c) => (
        <label key={c.id} class="field">
          <span class="field-label">
            {c.name} <span class="dim">{shortAddress(c.address)}</span>
          </span>
          <input
            class="input"
            type="text"
            inputMode="decimal"
            placeholder={`0.0 ${asset.ticker}`}
            value={amounts[c.id] ?? ''}
            onInput={(e) => setAmounts({ ...amounts, [c.id]: e.currentTarget.value })}
          />
        </label>
      ))}
      <p class="note">{isRotated(asset) ? b.multiUsdc : b.multiEach}</p>
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

/** Prices below a dollar need more digits than cents to mean anything. */
const priceText = (value: number) => (value < 1 ? `$${value.toFixed(4)}` : usdFormat.format(value));
const dateText = (time: number, period?: Period) =>
  period?.id === 'year'
    ? new Date(time * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : new Date(time * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One payment up close: what moved, when, with whom, and where to see it on the network. */
function OpView({
  t,
  a,
  op,
  wallet,
  prices,
  onBack,
}: {
  t: Dict;
  a: AssetDef;
  op: Change;
  wallet: Wallet;
  prices: UsdPrices | null;
  onBack: () => void;
}) {
  const incoming = op.delta > 0n;
  const amount = incoming ? op.delta : -op.delta;
  // History read from nodes knows only the block; the transaction is looked up when the payment is opened.
  const lookup = !op.tx && op.block !== undefined && (a.kind === 'eth' || a.kind === 'erc20');
  const [found, setFound] = useState<{ tx?: string; peer?: string } | null>(lookup ? null : {});
  useEffect(() => {
    const block = op.block;
    if (!lookup || block === undefined) return;
    let stale = false;
    // For USDC on Base the wallet's balance is spread over several addresses; any of them may be the one involved.
    (isRotated(a) ? rotationOwners(wallet) : Promise.resolve(undefined))
      .then((owners) =>
        findEvmTransaction(evmOf(a).rpc, {
          block,
          owner: wallet.evm,
          ...(owners ? { owners } : {}),
          incoming,
          ...(a.kind === 'erc20' && a.contract ? { token: a.contract } : {}),
        }),
      )
      .then(
      (r) => {
        if (!stale) setFound(r ?? {});
      },
      () => {
        if (!stale) setFound({});
      },
    );
    return () => {
      stale = true;
    };
  }, [lookup, op, a, wallet, incoming]);

  const network = networkOf(a);
  const explorerTx = network === 'btc' ? NET.btc.explorerTx : network === 'tron' ? NET.tron.explorerTx : evmOf(a).explorerTx;
  const tx = op.tx ?? found?.tx;
  const peer = op.peer ?? found?.peer;
  // Money from an address that imitates one the wallet knows: its address is shown, but not offered for copying.
  const poison = incoming && peer ? twinOf(peer, knownAddresses(wallet)) : null;
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    if (!incoming || !peer || a.contract !== NET.tron.usdt) return;
    let stale = false;
    void fetchTrc20Frozen(NET.tron.nodes, NET.tron.usdt, peer).then(
      (yes) => !stale && setFrozen(yes),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [peer]);
  const short = (value: string) => (value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value);
  return (
    <section class="panel">
      <div class="kv">
        <span class="asset-name">
          <CoinIcon ticker={a.ticker} />
          <span>
            {incoming ? t.opIn : t.opOut} <span class="dim">{a.net}</span>
          </span>
        </span>
        <span class="tag">{t.opTitle}</span>
      </div>
      <div class={cls('big big--small', incoming && 'up')}>
        {incoming ? '+' : '−'}
        {amountText(a, amount)} <span class="unit">{a.ticker}</span>
      </div>
      <dl class="facts">
        {prices && (
          <>
            <dt>{t.opNow}</dt>
            <dd>≈ {usdValue(a, amount, prices) < 0.01 ? '< $0.01' : usdFormat.format(usdValue(a, amount, prices))}</dd>
          </>
        )}
        <dt>{t.opDate}</dt>
        <dd>{new Date(op.time * 1000).toLocaleString()}</dd>
        <dt>{t.opNetwork}</dt>
        <dd>{a.net}</dd>
        {peer && (
          <>
            <dt>{incoming ? t.opFrom : t.opTo}</dt>
            <dd>
              <code class="addr-value">{peer}</code>
              {!poison && <CopyButton t={t} value={peer} />}
              {poison && <span class="alert">{t.guard.poison.replace('{known}', poison)}</span>}
              {frozen && <span class="dim facts-warn">{t.guard.frozenFrom}</span>}
            </dd>
          </>
        )}
        {op.block !== undefined && (
          <>
            <dt>{t.opBlock}</dt>
            <dd>{op.block}</dd>
          </>
        )}
        <dt>{t.opHash}</dt>
        <dd>
          {tx ? (
            <>
              <code class="addr-value" title={tx}>
                {short(tx)}
              </code>
              <CopyButton t={t} value={tx} />
            </>
          ) : found === null ? (
            <span class="dim">
              <Spinner /> {t.opSearching}
            </span>
          ) : (
            '—'
          )}
        </dd>
      </dl>
      {tx ? (
        <a class="btn btn--accent" href={explorerTx(tx)} target="_blank" rel="noopener noreferrer">
          {t.viewTx}
        </a>
      ) : (
        found !== null && (
          <>
            <p class="note">{t.opNoTx}</p>
            {a.chain === 'base' && NET.base && (
              <a class="btn" href={NET.base.explorerAddress(wallet.evm)} target="_blank" rel="noopener noreferrer">
                {t.opAddress}
              </a>
            )}
          </>
        )
      )}
      <button class="btn" onClick={onBack}>
        {t.back}
      </button>
    </section>
  );
}

/** One asset up close: its price and price curve, what the account holds, what it is, and recent operations. */
function AssetView({
  t,
  a,
  wallet,
  units,
  stealthPart,
  prices,
  history,
  historyDown,
  period,
  onPeriod,
  onBack,
  onSend,
  onReceive,
  onOp,
}: {
  t: Dict;
  a: AssetDef;
  wallet: Wallet;
  units: bigint | null;
  /** How much of the balance came by the stealth code; zero for every coin but USDC on Base. */
  stealthPart: bigint;
  prices: UsdPrices | null;
  history: History | null;
  historyDown: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  onBack: () => void;
  onSend: () => void;
  onReceive: () => void;
  /** Open one of the operations listed at the bottom. */
  onOp: (op: Change) => void;
}) {
  const [hover, setHover] = useState<HistoryPoint | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const priceNow = prices ? prices[a.price] : null;
  const points =
    history && priceNow !== null
      ? [
          ...history.times.map((time, i) => ({ time, value: history.prices[a.price][i] ?? 0 })).filter((p) => p.time < now),
          { time: now, value: priceNow },
        ]
      : null;
  const first = points?.[0]?.value ?? 0;
  const shown = hover?.value ?? priceNow ?? 0;
  const moved = shown - first;
  const network = networkOf(a);
  const address = network === 'btc' ? wallet.btc : network === 'tron' ? wallet.tron : wallet.evm;
  // Some sources hand back more history than the period asked for; show only what falls inside it.
  // Transfers planted from look-alike addresses are kept out of sight unless asked for: the history is where a fake gets copied from.
  const known = useMemo(() => knownAddresses(wallet), [wallet, history]);
  const [showFakes, setShowFakes] = useState(false);
  const isFake = (o: Change) => o.delta > 0n && !!o.peer && twinOf(o.peer, known) !== null;
  const inPeriod = (history?.changes[a.id] ?? []).filter((o) => o.time >= now - period.seconds);
  const fakes = inPeriod.filter(isFake).length;
  const operations = inPeriod
    .filter((o) => showFakes || !isFake(o))
    .sort((x, y) => y.time - x.time)
    .slice(0, 8);
  const isToken = a.kind === 'erc20' || a.kind === 'trc20';

  return (
    <>
      <section class="panel">
        <div class="kv">
          <span class="asset-name">
            <CoinIcon ticker={a.ticker} />
            <span>
              {a.ticker} <span class="dim">{a.net}</span>
            </span>
          </span>
          <span class="periods" role="tablist">
            {PERIODS.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === period.id}
                class="period"
                onClick={() => {
                  setHover(null);
                  onPeriod(p);
                }}
              >
                {t.periods[i]}
              </button>
            ))}
          </span>
        </div>
        <span class="dim asset-caption">{hover ? dateText(hover.time, period) : t.price}</span>
        <div class="big">{priceNow === null ? <Spinner /> : priceText(shown)}</div>
        <div class="delta">
          {points && first > 0 ? (
            <>
              {moved >= 0 ? '▲' : '▼'} {priceText(Math.abs(moved))} ({Math.abs((moved / first) * 100).toFixed(2)}%)
            </>
          ) : historyDown ? (
            t.historyDown
          ) : (
            <Spinner />
          )}
        </div>
        <BalanceChart key={period.id} points={points} onHover={setHover} minSpan={0.05} />
      </section>

      <section class="panel">
        <h2 class="label">{t.yourBalance}</h2>
        <div class="big big--small">
          {units === null ? (
            <Spinner />
          ) : (
            <>
              {amountText(a, units)} <span class="unit">{a.ticker}</span>
            </>
          )}
        </div>
        <div class="delta">{units !== null && prices ? `≈ ${usdFormat.format(usdValue(a, units, prices))}` : ''}</div>
        {units !== null && stealthPart > 0n && <div class="delta">{t.pockets.part.replace('{sum}', amountText(a, stealthPart))}</div>}
        <div class="actions actions--two">
          <button class="btn btn--accent" onClick={onSend}>
            {t.send}
          </button>
          <button class="btn" onClick={onReceive}>
            {t.receive}
          </button>
        </div>
      </section>

      {a.contract === NET.tron.usdt && quarantineOf(wallet, 'tron', wallet.tron) && (
        <section class="panel">
          <HeldNote t={t} wallet={wallet} mark={quarantineOf(wallet, 'tron', wallet.tron) as Quarantined} amount={`${amountText(a, BigInt((quarantineOf(wallet, 'tron', wallet.tron) as Quarantined).amount))} ${a.ticker}`} />
        </section>
      )}
      {railFor(wallet, a) && <CrossList t={t} wallet={wallet} rail={railFor(wallet, a) as Rail} />}

      <section class="panel">
        <h2 class="label">{t.about}</h2>
        <dl class="facts">
          <dt>{t.aboutNetwork}</dt>
          <dd>{a.net}</dd>
          <dt>{t.aboutType}</dt>
          <dd>{isToken ? t.typeToken : t.typeCoin}</dd>
          <dt>{t.aboutAddress}</dt>
          <dd>
            {isRotated(a) ? (
              // USDC on Base is received on an address that changes; the one to give out is on the receive screen.
              <span class="dim">{t.aboutRotates}</span>
            ) : (
              <>
                <code class="addr-value">{address}</code>
                <CopyButton t={t} value={address} />
              </>
            )}
          </dd>
          {a.contract && (
            <>
              <dt>{t.aboutContract}</dt>
              <dd>
                {/* The token's own address, for reference only. It is shown shortened, cannot be selected and has
                    no copy button: money sent to a token's contract is lost, and it must never be taken for the
                    wallet's address. */}
                <code class="addr-value addr-value--ref">{shortAddress(a.contract)}</code>
                <span class="dim facts-warn">{t.aboutContractNote}</span>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section class="panel">
        <h2 class="label">{t.operations}</h2>
        {operations.length > 0 ? (
          <ul class="rows">
            {operations.map((o, i) => (
              <li key={i} class="asset-li">
                <button class="asset-row" onClick={() => onOp(o)}>
                  <span class="dim">
                    {dateText(o.time, period)}
                    {isFake(o) && <span class="alert"> {t.guard.mark}</span>}
                  </span>
                  <span class={cls('num', o.delta > 0n && 'up')}>
                    {o.delta > 0n ? '+' : '−'}
                    {amountText(a, o.delta > 0n ? o.delta : -o.delta)} {a.ticker}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note">{history ? t.noOperations : historyDown ? t.historyDown : <Spinner />}</p>
        )}
        {fakes > 0 && (
          <p class="note">
            {t.guard.hidden.replace('{n}', String(fakes))}{' '}
            <button type="button" class="linklike" onClick={() => setShowFakes((v) => !v)}>
              {showFakes ? t.guard.hide : t.guard.show}
            </button>
          </p>
        )}
      </section>

      <button class="btn" onClick={onBack}>
        {t.back}
      </button>
    </>
  );
}

type Balances = Record<string, bigint | null>;

/** Balance of one asset, plus the node that answered and any unconfirmed amount. */
async function loadBalance(a: AssetDef, wallet: Wallet): Promise<{ units: bigint; node: string; pending: bigint }> {
  switch (a.kind) {
    case 'eth': {
      const r = await fetchEvmBalance(evmOf(a).rpc, wallet.evm);
      return { units: r.value, node: hostOf(r.endpoint), pending: 0n };
    }
    case 'btc': {
      const r = await fetchBitcoinBalance(NET.btc.esplora, wallet.btc);
      return { units: r.value.confirmed, node: hostOf(r.endpoint), pending: r.value.pending };
    }
    case 'erc20':
      // USDC on Base is one balance spread over the wallet's receiving addresses.
      if (isRotated(a)) return { units: (await loadRotation(wallet)).total, node: '', pending: 0n };
      return { units: await fetchErc20Balance(evmOf(a).rpc, a.contract ?? '', wallet.evm), node: '', pending: 0n };
    case 'trx':
      return { units: (await fetchTronAccount(NET.tron.nodes, wallet.tron)).balance, node: hostOf(NET.tron.nodes[0] ?? ''), pending: 0n };
    case 'trc20':
      return { units: await fetchTrc20Balance(NET.tron.nodes, a.contract ?? '', wallet.tron), node: '', pending: 0n };
  }
}

/** A set of addresses with its balances, curve, assets and transfers. The pocket and an opened vault are both one of these. */
function Pocket({
  t,
  wallet,
  onExit,
  vault = false,
  fresh = false,
  home = 0,
}: {
  t: Dict;
  wallet: Wallet;
  onExit: () => void;
  /** Grows each time the open tab is tapped again: go back to the first page. */
  home?: number;
  /** This is an opened vault rather than the pocket. */
  vault?: boolean;
  /** The vault was created just now, so being empty is expected. */
  fresh?: boolean;
}) {
  const [view, setView] = useState<'main' | 'send' | 'receive' | 'swap' | 'contacts' | 'multi' | 'cross' | 'aml'>('main');
  // The address check is paid for from USDC on Base through me7's service, so it needs both, and the main wallet.
  const canAml = !vault && NET.mode === 'mainnet' && !!NET.base && wallet.seed instanceof Uint8Array && wallet.seed.length === 64;
  // The address the check opens with, when it is opened from the send screen.
  const [amlAddress, setAmlAddress] = useState('');
  // The asset opened from the list; send and receive started from its page come back to it.
  const [selected, setSelected] = useState<AssetDef | null>(null);
  // The payment opened from the feed or from an asset's page; closing it returns to where it was opened.
  const [op, setOp] = useState<{ a: AssetDef; change: Change } | null>(null);
  useEffect(() => {
    if (home === 0) return;
    setView('main');
    setSelected(null);
    setOp(null);
  }, [home]);
  const [balances, setBalances] = useState<Balances>({});
  // A payment of USDT out of USDC that was cut short: it is offered again until it is finished.
  const [unfinished, setUnfinished] = useState<Crossing | null>(() => openCrossings(wallet)[0] ?? null);
  const [pending, setPending] = useState(0n);
  // How much of the USDC on Base came by the stealth code: shown under the one balance.
  const [stealthPart, setStealthPart] = useState(0n);
  const [failed, setFailed] = useState<string[]>([]);
  const [prices, setPrices] = useState<UsdPrices | null>(null);
  const [nodes, setNodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [period, setPeriod] = useState<Period>(PERIODS[1]);
  const [history, setHistory] = useState<History | null>(null);
  const [historyDown, setHistoryDown] = useState(false);
  const [hover, setHover] = useState<HistoryPoint | null>(null);
  const [dayChange, setDayChange] = useState<Partial<Record<PriceId, number>>>({});
  // Amounts can be hidden from someone looking over the shoulder; the choice is kept on the device.
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('me7.hide') === '1';
    } catch {
      return false;
    }
  });
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  // The past is fetched once per period; the curve is then redrawn from it whenever balances refresh.
  useEffect(() => {
    let stale = false;
    setHistory(null);
    setHistoryDown(false);
    loadHistory(wallet, period, Math.floor(Date.now() / 1000)).then(
      (h) => {
        if (!stale) setHistory(h);
      },
      () => {
        if (!stale) setHistoryDown(true);
      },
    );
    return () => {
      stale = true;
    };
  }, [wallet, period]);

  const refresh = useCallback(async () => {
    setBusy(true);
    const [price, results, changes] = await Promise.all([
      fetchUsdPrices().catch(() => null),
      Promise.allSettled(ASSETS.map((a) => loadBalance(a, wallet))),
      fetchDayChanges().catch(() => null),
    ]);
    if (changes) setDayChange(changes);
    setBalances((old) => {
      const next = { ...old };
      results.forEach((r, i) => {
        const a = ASSETS[i];
        if (a && r.status === 'fulfilled') next[a.id] = r.value.units;
      });
      return next;
    });
    setFailed(results.flatMap((r, i) => (r.status === 'rejected' && ASSETS[i] ? [ASSETS[i].id] : [])));
    if (NET.base) void loadRotation(wallet).then((r) => setStealthPart(pocketTotals(r.holdings).stealth), () => undefined);
    results.forEach((r, i) => {
      if (ASSETS[i]?.kind === 'btc' && r.status === 'fulfilled') setPending(r.value.pending);
    });
    if (price) setPrices(price);
    const hosts = results.flatMap((r) => (r.status === 'fulfilled' && r.value.node ? [r.value.node] : []));
    setNodes(hosts.filter((h, i) => hosts.indexOf(h) === i));
    setUpdated(new Date());
    setBusy(false);
  }, [wallet]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  if (op) {
    return <OpView t={t} a={op.a} op={op.change} wallet={wallet} prices={prices} onBack={() => setOp(null)} />;
  }
  if (view === 'receive') {
    return <Receive t={t} wallet={wallet} prices={prices} initial={selected && !isRotated(selected) ? networkOf(selected) : undefined} onClose={() => setView('main')} />;
  }
  if (view === 'contacts') return <Contacts t={t} wallet={wallet} onClose={() => setView('main')} onMulti={() => setView('multi')} />;
  if (view === 'multi') {
    return (
      <MultiSend
        t={t}
        wallet={wallet}
        prices={prices}
        onClose={(done) => {
          setView(done ? 'main' : 'contacts');
          if (done) void refresh();
        }}
      />
    );
  }
  if (view === 'aml') {
    return (
      <AmlCheck
        t={t}
        wallet={wallet}
        initial={amlAddress}
        onClose={() => {
          setAmlAddress('');
          setView('main');
          void refresh();
        }}
      />
    );
  }
  if (view === 'swap') {
    return (
      <Swap
        t={t}
        wallet={wallet}
        prices={prices}
        onClose={(done) => {
          setView('main');
          if (done) void refresh();
        }}
      />
    );
  }
  if (view === 'cross' && unfinished) {
    return (
      <CrossPay
        t={t}
        wallet={wallet}
        resume={unfinished}
        onClose={(sent) => {
          setUnfinished(openCrossings(wallet)[0] ?? null);
          setView('main');
          if (sent) void refresh();
        }}
      />
    );
  }
  if (view === 'send') {
    return (
      <Send
        t={t}
        wallet={wallet}
        prices={prices}
        initial={selected ?? undefined}
        onClose={(sent) => {
          setUnfinished(openCrossings(wallet)[0] ?? null);
          setView('main');
          if (sent) void refresh();
        }}
        {...(canAml ? { onAml: (address: string) => (setAmlAddress(address), setView('aml')) } : {})}
      />
    );
  }

  const units = (a: AssetDef) => balances[a.id] ?? null;
  if (selected) {
    return (
      <AssetView
        t={t}
        a={selected}
        wallet={wallet}
        units={units(selected)}
        stealthPart={isRotated(selected) ? stealthPart : 0n}
        prices={prices}
        history={history}
        historyDown={historyDown}
        period={period}
        onPeriod={setPeriod}
        onBack={() => setSelected(null)}
        onSend={() => setView('send')}
        onReceive={() => setView('receive')}
        onOp={(change) => setOp({ a: selected, change })}
      />
    );
  }
  const rotated = ASSETS.find(isRotated);
  const known = ASSETS.every((a) => units(a) !== null);
  const total = known && prices ? ASSETS.reduce((sum, a) => sum + usdValue(a, units(a) ?? 0n, prices), 0) : null;
  const stuck = !known && failed.length > 0;
  const points = history && total !== null ? portfolioSeries(history, balances, Math.floor(Date.now() / 1000), total) : null;
  const first = points?.[0]?.value ?? 0;
  const shown = hover?.value ?? total ?? 0;
  const moved = shown - first;
  const periodIndex = PERIODS.findIndex((p) => p.id === period.id);
  const mask = (text: string) => (hidden ? '••••' : text);

  // One row per coin: the same coin on several networks is one line that opens into its networks.
  const groups = [...new Set(ASSETS.map((a) => a.ticker))].map((ticker) => {
    const items = ASSETS.filter((a) => a.ticker === ticker);
    const allKnown = items.every((a) => units(a) !== null);
    return {
      ticker,
      items,
      allKnown,
      total: items.reduce((sum, a) => sum + (units(a) ?? 0n), 0n),
      usd: prices ? items.reduce((sum, a) => sum + usdValue(a, units(a) ?? 0n, prices), 0) : 0,
      empty: allKnown && items.every((a) => units(a) === 0n),
    };
  });
  // USDC leads, then the biggest holdings. Coins with nothing on them fold away, unless the whole wallet is empty.
  const lead = (g: { ticker: string }) => (g.ticker === ASSETS[0]?.ticker ? 1 : 0);
  const ordered = [...groups].sort((a, b) => lead(b) - lead(a) || b.usd - a.usd);
  const nothing = groups.every((g) => g.empty);
  const visible = showAll || nothing ? ordered : ordered.filter((g) => !g.empty);
  const folded = ordered.length - visible.length;

  // Latest movements across every coin, without the dust (network fees worth under a cent).
  const sinceTime = Math.floor(Date.now() / 1000) - period.seconds;
  const feedKnown = knownAddresses(wallet);
  const feed =
    history && prices
      ? ASSETS.flatMap((a) => (history.changes[a.id] ?? []).map((c) => ({ a, time: c.time, delta: c.delta, change: c })))
          .filter((o) => o.time >= sinceTime && usdValue(o.a, o.delta < 0n ? -o.delta : o.delta, prices) >= 0.01)
          // A transfer planted from a look-alike address is not news; it is found, marked, on the coin's own page.
          .filter((o) => !(o.delta > 0n && o.change.peer && twinOf(o.change.peer, feedKnown) !== null))
          .sort((x, y) => y.time - x.time)
          .slice(0, 5)
      : null;

  return (
    <>
      <section class="panel">
        <div class="kv">
          <span class="dim">
            {hover ? dateText(hover.time, period) : t.balance}
          </span>
          <span class="periods" role="tablist">
            {PERIODS.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === period.id}
                class="period"
                onClick={() => {
                  setHover(null);
                  setPeriod(p);
                }}
              >
                {t.periods[i]}
              </button>
            ))}
          </span>
        </div>
        <button
          type="button"
          class="big big-toggle"
          aria-pressed={hidden}
          title={hidden ? t.showBalance : t.hideBalance}
          onClick={() => {
            const next = !hidden;
            setHidden(next);
            try {
              localStorage.setItem('me7.hide', next ? '1' : '0');
            } catch {
              /* private mode: not remembered */
            }
          }}
        >
          {hidden && (hover || total !== null) ? (
            '••••••'
          ) : hover ? (
            usdFormat.format(hover.value)
          ) : total !== null ? (
            <Scramble text={usdFormat.format(total)} />
          ) : stuck ? (
            <span class="dim">{t.nodesDown}</span>
          ) : known ? (
            <span class="dim">{t.priceDown}</span>
          ) : (
            <Spinner />
          )}
        </button>
        {stealthPart > 0n && rotated && prices && !hover && (
          <div class="delta">{t.pockets.part.replace('{sum}', mask(usdFormat.format(usdValue(rotated, stealthPart, prices))))}</div>
        )}
        <div class="delta">
          {points && hidden ? (
            <span class="dim">{t.periodNames[periodIndex]}</span>
          ) : points && (first > 0 || shown > 0) ? (
            <>
              <span class={moved >= 0 ? 'up' : 'down'}>
                {moved >= 0 ? '▲ +' : '▼ −'}
                {usdFormat.format(Math.abs(moved))}
                {first > 0 && ` (${moved >= 0 ? '+' : '−'}${Math.abs((moved / first) * 100).toFixed(2)}%)`}
              </span>{' '}
              <span class="dim">{t.periodNames[periodIndex]}</span>
            </>
          ) : historyDown ? (
            t.historyDown
          ) : points ? (
            '—'
          ) : (
            <Spinner />
          )}
        </div>
        {points || historyDown ? (
          <BalanceChart key={period.id} points={points} onHover={setHover} />
        ) : (
          <div class="chart chart--wait" role="status">
            <span>{t.historyLoading}</span>
          </div>
        )}
        {history?.partial && <p class="note">{t.historyPartial}</p>}
        {unfinished && (
          <p class="alert cross-banner">
            {t.cross.banner.replace('USDT', railOfCrossing(unfinished).coin).replace('{sum}', formatUnits(BigInt(unfinished.amount), 6, 2)).replace('{to}', shortAddress(unfinished.to))}{' '}
            <button class="linklike" onClick={() => setView('cross')}>
              {t.cross.resume}
            </button>
          </p>
        )}
        <div class="actions actions--two">
          <button class="btn btn--accent" onClick={() => setView('send')}>
            {t.send}
          </button>
          <button class="btn" onClick={() => setView('receive')}>
            {t.receive}
          </button>
          {SWAPPABLE.length > 1 && (
            <button class="btn" onClick={() => setView('swap')}>
              {t.swap.action}
            </button>
          )}
          {!vault && (
            <button class="btn" onClick={() => setView('contacts')}>
              {t.book.open}
            </button>
          )}
        </div>
        {vault && known && ASSETS.every((a) => units(a) === 0n) && (
          <p class={fresh ? 'note' : 'alert'}>{fresh ? t.vaultFresh : t.vaultEmpty}</p>
        )}
        {NET.mode === 'testnet' && <p class="note">{t.testNote}</p>}
      </section>

      <section class="panel">
        <h2 class="label">{t.assets}</h2>
        <ul class="rows">
          {visible.map((g) => {
            const single = g.items.length === 1 ? (g.items[0] as AssetDef) : null;
            const open = expanded.includes(g.ticker);
            const head = g.items[0] as AssetDef;
            const price = prices ? prices[head.price] : null;
            const change = dayChange[head.price];
            const down = g.items.some((a) => failed.includes(a.id));
            return (
              <li key={g.ticker} class="asset-li">
                <button
                  class="asset-row"
                  aria-expanded={single ? undefined : open}
                  onClick={() =>
                    single ? setSelected(single) : setExpanded((list) => (open ? list.filter((x) => x !== g.ticker) : [...list, g.ticker]))
                  }
                >
                  <span class="asset-name">
                    <CoinIcon ticker={g.ticker} />
                    <span>
                      {g.ticker}{' '}
                      <span class="dim">{single ? single.net : `${g.items.length} ${t.networks} ${open ? '▴' : '▾'}`}</span>
                      <span class="dim asset-usd">
                        {price !== null ? priceText(price) : ''}
                        {price !== null && change !== undefined && (
                          <span class={change >= 0 ? 'up' : 'down'}>
                            {' '}
                            {change >= 0 ? '+' : '−'}
                            {Math.abs(change).toFixed(2)}%
                          </span>
                        )}
                      </span>
                    </span>
                  </span>
                  <span class="num">
                    {!g.allKnown ? (
                      down ? (
                        <span class="bad">{t.nodesDown}</span>
                      ) : (
                        <Spinner />
                      )
                    ) : (
                      <>
                        {hidden ? '••••' : <Scramble text={amountText(head, g.total)} />}
                        <span class="dim asset-usd">{prices ? `≈ ${mask(usdFormat.format(g.usd))}` : ''}</span>
                        {rotated && stealthPart > 0n && g.items.includes(rotated) && <span class="dim asset-usd">{t.pockets.part.replace('{sum}', mask(amountText(rotated, stealthPart)))}</span>}
                        {single?.kind === 'btc' && pending !== 0n && (
                          <span class="dim asset-usd">
                            {t.pending} {mask(amountText(single, pending))}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
                {!single && open && (
                  <ul class="asset-nets">
                    {g.items.map((a) => {
                      const held = units(a);
                      return (
                        <li key={a.id}>
                          <button class="asset-row asset-row--net" onClick={() => setSelected(a)}>
                            <span class="dim">{a.net}</span>
                            <span class="num">
                              {held === null ? (
                                failed.includes(a.id) ? (
                                  <span class="bad">{t.nodesDown}</span>
                                ) : (
                                  <Spinner />
                                )
                              ) : (
                                <>
                                  {mask(amountText(a, held))}
                                  <span class="dim asset-usd">{prices ? `≈ ${mask(usdFormat.format(usdValue(a, held, prices)))}` : ''}</span>
                                  {isRotated(a) && stealthPart > 0n && <span class="dim asset-usd">{t.pockets.part.replace('{sum}', mask(amountText(a, stealthPart)))}</span>}
                                </>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {(folded > 0 || (showAll && !nothing && ordered.some((g) => g.empty))) && (
          <button class="btn btn--small asset-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? t.hideEmpty : `${t.showAll} (+${folded})`}
          </button>
        )}
      </section>

      <section class="panel">
        <h2 class="label">
          {t.recentOps} <span class="dim">{t.periodNames[periodIndex]}</span>
        </h2>
        {feed === null ? (
          <p class="dim">{historyDown ? t.historyDown : <><Spinner /> {t.historyLoading}</>}</p>
        ) : feed.length === 0 ? (
          <p class="dim">{t.noOperations}</p>
        ) : (
          <ul class="rows">
            {feed.map((o) => (
              <li key={`${o.a.id}:${o.time}:${o.delta}`} class="asset-li">
                <button class="asset-row" onClick={() => setOp({ a: o.a, change: o.change })}>
                  <span class="asset-name">
                    <CoinIcon ticker={o.a.ticker} />
                    <span>
                      {o.delta > 0n ? t.opIn : t.opOut} <span class="dim">{o.a.net}</span>
                      <span class="dim asset-usd">{dateText(o.time, period)}</span>
                    </span>
                  </span>
                  <span class={cls('num', o.delta > 0n && 'up')}>
                    {mask(`${o.delta > 0n ? '+' : '−'}${amountText(o.a, o.delta > 0n ? o.delta : -o.delta)}`)} {o.a.ticker}
                    <span class="dim asset-usd">
                      {prices ? `≈ ${mask(usdFormat.format(usdValue(o.a, o.delta > 0n ? o.delta : -o.delta, prices)))}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer class="foot">
        <p class="dim">
          {t.node}: {nodes.length ? nodes.join(', ') : '—'}
          <br />
          {t.updated}: {updated ? updated.toLocaleTimeString() : '—'} {busy && <Spinner />}
        </p>
        <div class="row">
          <button class="btn" onClick={() => void refresh()} disabled={busy}>
            {t.refresh}
          </button>
          <button class="btn" onClick={onExit}>
            {vault ? t.vaultLock : t.exit}
          </button>
        </div>
        {/* The way into the address check: under the buttons, where it is found by those who look for it and is in nobody's way. */}
        {canAml && (
          <button type="button" class="linklike aml-link" onClick={() => setView('aml')}>
            {t.aml.open}
          </button>
        )}
        <p class="note">{vault ? t.vaultSessionNote : t.sessionNote}</p>
      </footer>
    </>
  );
}

const VAULT_IDLE_SECONDS = 120;

/**
 * The vault: a second set of addresses under the same account. Opening it takes
 * the key file, the account password and the vault password, every time. It
 * locks itself after two idle minutes and whenever this tab is left.
 */
function Vault({ t, wallet, home }: { t: Dict; wallet: Wallet; home: number }) {
  const [vault, setVault] = useState<Wallet | null>(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(VAULT_IDLE_SECONDS);
  const [progress, onProgress] = useProgress();
  const current = useRef<Wallet | null>(null);

  const lock = useCallback(() => {
    if (current.current) closeWallet(current.current);
    current.current = null;
    setVault(null);
    setCreating(false);
    setPicked(null);
    setPassword('');
    setSecret('');
    setAgain('');
  }, []);

  // Leaving the vault tab unmounts this component: wipe the keys then too.
  useEffect(
    () => () => {
      if (current.current) closeWallet(current.current);
      current.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!vault) return;
    let deadline = Date.now() + VAULT_IDLE_SECONDS * 1000;
    const bump = () => {
      deadline = Date.now() + VAULT_IDLE_SECONDS * 1000;
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll'] as const;
    for (const name of events) addEventListener(name, bump, { passive: true });
    setLeft(VAULT_IDLE_SECONDS);
    const timer = setInterval(() => {
      const seconds = Math.ceil((deadline - Date.now()) / 1000);
      if (seconds <= 0) lock();
      else setLeft(seconds);
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const name of events) removeEventListener(name, bump);
    };
  }, [vault, lock]);

  const open = async (e: Event) => {
    e.preventDefault();
    if (!picked) return setError(t.vaultNeedFile);
    if (secret.length < 8) return setError(t.vaultShort);
    if (creating && isGuessablePassword(secret)) return setError(t.pwWeak);
    if (creating && secret !== again) return setError(t.pwMismatch);
    setError('');
    setBusy(true);
    try {
      const entropy = await openSecret(findKeyBlob(picked.bytes), password, { onProgress: (f) => onProgress(f / 2) });
      try {
        const phrase = entropyToPhrase(entropy);
        // The file must be this account's: its pocket has to be the one we are signed in to.
        const pocket = openWallet(phrase);
        const mine = pocket.evm === wallet.evm;
        closeWallet(pocket);
        if (!mine) {
          setError(t.vaultOtherAccount);
          return;
        }
        const passphrase = await vaultPassphrase(entropy, secret, { onProgress: (f) => onProgress(0.5 + f / 2) });
        const opened = openWallet(phrase, passphrase);
        // Nothing about a vault's addresses is written to this browser: its notes live in memory until the page goes.
        hush([opened.evm, opened.tron, opened.btc]);
        current.current = opened;
        setFresh(creating);
        setVault(opened);
        setPassword('');
        setSecret('');
        setAgain('');
        setPicked(null);
      } finally {
        wipe(entropy);
      }
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Working label={t.vaultOpening} value={progress} />;

  if (vault) {
    const minutes = Math.floor(left / 60);
    return (
      <>
        <section class="panel vault-bar">
          <div class="kv">
            <h2 class="title">{t.vaultOpened}</h2>
            <span class="dim">
              {t.vaultLocksIn} {minutes}:{String(left % 60).padStart(2, '0')}
            </span>
          </div>
          <div class="kv">
            <span class="dim">{t.vaultCode}</span>
            <code class="vault-code">{vaultCode([vault.evm, vault.btc, vault.tron])}</code>
          </div>
          <p class="note">{t.vaultCodeNote}</p>
        </section>
        <Pocket t={t} wallet={vault} onExit={lock} vault fresh={fresh} home={home} />
      </>
    );
  }

  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void open(e)}>
      <h2 class="title">{t.vaultTitle}</h2>
      <p class="lead">{t.vaultLead}</p>
      <ul class="plain-list">
        {t.vaultItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div class="seg" role="tablist">
        <button type="button" role="tab" aria-selected={!creating} class="seg-item" onClick={() => setCreating(false)}>
          {t.vaultOpenMode}
        </button>
        <button type="button" role="tab" aria-selected={creating} class="seg-item" onClick={() => setCreating(true)}>
          {t.vaultCreateMode}
        </button>
      </div>
      <FileDrop t={t} label={t.vaultFile} picked={picked} onPick={setPicked} onError={setError} />
      <label class="field">
        <span class="field-label">{t.vaultAccountPassword}</span>
        <input class="input" type="password" autocomplete="off" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field-label">{t.vaultPassword}</span>
        <input class="input" type="password" autocomplete="off" value={secret} onInput={(e) => setSecret(e.currentTarget.value)} />
      </label>
      {creating && (
        <label class="field">
          <span class="field-label">{t.vaultPasswordAgain}</span>
          <input class="input" type="password" autocomplete="off" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
        </label>
      )}
      <p class={creating ? 'alert' : 'note'}>{creating ? t.vaultCreateWarn : t.vaultOpenNote}</p>
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" class="btn btn--accent btn--wide">
        {creating ? t.vaultCreate : t.vaultOpen}
      </button>
    </form>
  );
}

function Card({ t }: { t: Dict }) {
  return (
    <section class="panel">
      <div class="kv">
        <h2 class="title">{t.cardTitle}</h2>
        <span class="tag">{t.soon}</span>
      </div>
      <p class="lead">{t.cardLead}</p>
    </section>
  );
}

type Tab = 'pocket' | 'vault' | 'peer' | 'card';

export function Home({ t, wallet, onExit }: { t: Dict; wallet: Wallet; onExit: () => void }) {
  usePassSync(t, wallet);
  const [tab, setTab] = useState<Tab>('pocket');
  // The address book is fetched once the wallet is open, so the contacts are there by the time money is sent.
  useEffect(() => {
    void syncContacts(wallet);
    // Who paid to the wallet's addresses is looked at in the background; a listed sender puts that one address in quarantine.
    // Not at once: the balances and the history come first, and the same free nodes serve both.
    const later = setTimeout(() => void syncQuarantine(wallet).catch(() => undefined), 25_000);
    return () => clearTimeout(later);
  }, [wallet]);
  // Tapping the tab that is already open takes its screen back to the first page.
  const [home, setHome] = useState(0);
  const tabs: { id: Tab; label: string; soon?: boolean }[] = [
    { id: 'pocket', label: t.tabPocket },
    { id: 'vault', label: t.tabVault },
    { id: 'peer', label: t.peer.tab },
    { id: 'card', label: t.tabCard },
  ];
  return (
    <>
      <nav class="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} role="tab" aria-selected={tab === item.id}
            class="tab"
            onClick={() => {
              if (tab === item.id) setHome((n) => n + 1);
              else setTab(item.id);
              window.scrollTo({ top: 0 });
            }}
          >
            {item.label}
            {item.soon && <span class="tab-soon">{t.soon}</span>}
          </button>
        ))}
      </nav>
      {tab === 'pocket' && <Pocket t={t} wallet={wallet} onExit={onExit} home={home} />}
      {tab === 'vault' && <Vault t={t} wallet={wallet} home={home} />}
      {tab === 'peer' && <Peer t={t} wallet={wallet} home={home} />}
      {tab === 'card' && (
        <>
          <PassCard t={t} wallet={wallet} />
          <Card t={t} />
        </>
      )}
    </>
  );
}
