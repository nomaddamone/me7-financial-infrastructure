import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  buildTrc20Transfer,
  buildTronTransfer,
  erc20TransferData,
  isValidEvmAddress,
  isValidTronAddress,
  parseUnits,
  tronRef,
  type EvmTransaction,
} from '../core/index.ts';
import { LedgerError, ledgerTokenDescription } from '../core/ledger.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { NET } from '../net/endpoints.ts';
import { Ledger, ledgerWays, type LedgerWay } from '../net/ledger.ts';
import { broadcastEvm, estimateEvmGas, fetchErc20Balance, fetchEvmFees, fetchEvmNonce, fetchUsdPrices, type UsdPrices } from '../net/send.ts';
import {
  broadcastTron,
  estimateTrc20Energy,
  fetchTrc20Balance,
  fetchTronAccount,
  fetchTronBlock,
  fetchTronFeeRates,
  fetchTronResources,
} from '../net/tron.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, feeAssetOf, type AssetDef } from './assets.ts';
import { Spinner } from './fx.tsx';
import { CopyButton, Qr } from './home.tsx';
import type { Dict } from './i18n.ts';
import { CoinIcon } from './icons.tsx';

/** The app that is open on the device: a Ledger runs one at a time, and it decides which network is shown. */
export type DeviceApp = 'Ethereum' | 'Tron';

/**
 * A session opened with a Ledger: the device does the signing, the app only
 * knows addresses. The wallet shows the network whose app is open on the
 * device. The address of the other network is known once its app has been
 * opened in this browser (it is public, and remembered).
 */
export interface ColdSession {
  ledger: Ledger;
  app: DeviceApp;
  evm: string | null;
  tron: string | null;
}

/** The address the session stands on right now. */
export const coldAddress = (session: ColdSession): string => (session.app === 'Tron' ? session.tron : session.evm) ?? '';

const isTron = (a: AssetDef) => a.kind === 'trx' || a.kind === 'trc20';
const appOf = (a: AssetDef): DeviceApp => (isTron(a) ? 'Tron' : 'Ethereum');

/** What a Ledger session can hold and send. Bitcoin and everything that needs a contract call stay out of this mode. */
const EVM_ASSETS = ASSETS.filter((a) => a.kind === 'eth' || a.kind === 'erc20');
const TRON_ASSETS = ASSETS.filter(isTron);

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const text = (a: AssetDef, units: bigint) => {
  const out = formatUnits(units, a.decimals, a.shown);
  return units > 0n && out === '0' ? `< 0.${'0'.repeat(a.shown - 1)}1` : out;
};
const usdOf = (a: AssetDef, units: bigint, prices: UsdPrices) => Number(formatUnits(units, a.decimals, a.decimals)) * prices[a.price];
/** Bytes a signed Tron transaction counts against the account's daily allowance. */
const tronBandwidth = (raw: Uint8Array) => BigInt(raw.length + 3 + 67 + 64);
/** A Tron transaction is valid for a limited time; ten minutes leave room to read the device's screen. */
const TRON_VALID_MS = 600_000;

// The two addresses of one Ledger are remembered as a pair, each pointing at the other.
const pairKey = (address: string) => `me7.ledger.pair.${address.startsWith('0x') ? address.toLowerCase() : address}`;
function loadPair(address: string): string | null {
  try {
    const stored = localStorage.getItem(pairKey(address));
    return stored && (isValidTronAddress(stored) || isValidEvmAddress(stored)) ? stored : null;
  } catch {
    return null;
  }
}
function savePair(evm: string, tron: string): void {
  try {
    localStorage.setItem(pairKey(evm), tron);
    localStorage.setItem(pairKey(tron), evm);
  } catch {
    /* private mode: learnt again next time */
  }
}

/** Raised when the device has a different app open than is needed; `null` means neither of the two this wallet knows. */
class WrongApp extends Error {
  readonly need: DeviceApp | null;
  constructor(need: DeviceApp | null) {
    super(`Ledger: open the ${need ?? 'Ethereum or Tron'} app`);
    this.need = need;
  }
}
async function requireApp(ledger: Ledger, need: DeviceApp): Promise<void> {
  if ((await ledger.appName()) !== need) throw new WrongApp(need);
}

/**
 * Read which app is open and that app's address. Coming back to a session,
 * the address must be the one already known: a different one means another
 * Ledger or another account, and is refused.
 */
async function readSession(ledger: Ledger, known: { evm: string | null; tron: string | null } | null): Promise<ColdSession> {
  const app = await ledger.appName();
  let evm = known?.evm ?? null;
  let tron = known?.tron ?? null;
  if (app === 'Ethereum') {
    const address = await ledger.address();
    if (evm && evm.toLowerCase() !== address.toLowerCase()) throw new LedgerError('other', 0);
    evm = address;
    tron ??= loadPair(address);
  } else if (app === 'Tron') {
    const address = await ledger.tronAddress();
    if (tron && tron !== address) throw new LedgerError('other', 0);
    tron = address;
    evm ??= loadPair(address);
  } else {
    throw new WrongApp(null);
  }
  if (evm && tron) savePair(evm, tron);
  return { ledger, app, evm, tron };
}

/** What went wrong with the device, in words the user can act on. */
function ledgerText(t: Dict, e: unknown): string {
  const l = t.ledger;
  if (e instanceof WrongApp) return e.need ? l.errOpenApp.replace('{app}', e.need) : l.errOpenAny;
  if (e instanceof LedgerError) {
    if (e.problem === 'rejected') return l.errRejected;
    if (e.problem === 'locked') return l.errLocked;
    if (e.problem === 'no-app') return l.errNoApp;
    if (e.problem === 'blind') return l.errBlind;
    return e.status === 0 ? l.errWrongAccount : `${l.errOther} (0x${e.status.toString(16)})`;
  }
  const message = e instanceof Error ? e.message : '';
  if (/no device chosen|No device selected|cancel|chooser/i.test(message)) return l.errNoDevice;
  if (/no answer over Bluetooth|GATT|Bluetooth/i.test(message)) return l.errBluetooth;
  if (/disconnected/i.test(message)) return l.errGone;
  return `${l.errOther}${message ? ` ${message.slice(0, 120)}` : ''}`;
}

/** The explanation shown before connecting, and on request afterwards: what this mode does not do, and why. */
function Notice({ t }: { t: Dict }) {
  const l = t.ledger;
  return (
    <>
      <p class="lead terms-intro">{l.noticeLead}</p>
      {l.notice.map((section) => (
        <section class="terms-sec" key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Connecting a Ledger: the notice, then the browser's device picker, then reading the address from the device. */
export function LedgerConnect({ t, onDone, onBack }: { t: Dict; onDone: (session: ColdSession) => void; onBack: () => void }) {
  const l = t.ledger;
  const [busy, setBusy] = useState<LedgerWay | null>(null);
  const [error, setError] = useState('');
  const ways = ledgerWays();
  const supported = ways.length > 0;

  const connect = async (way: LedgerWay) => {
    setError('');
    setBusy(way);
    let ledger: Ledger | null = null;
    try {
      ledger = await Ledger.connect(way);
      // Whichever app is open on the device decides which network the wallet shows.
      onDone(await readSession(ledger, null));
    } catch (e) {
      setError(ledgerText(t, e));
      await ledger?.close();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="panel terms">
      <h2 class="title">{l.title}</h2>
      <Notice t={t} />
      {supported ? (
        <>
          <ol class="plain-steps">
            {l.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {error && (
            <p class="alert" role="alert">
              {error}
            </p>
          )}
          {busy === 'bluetooth' && <p class="note">{l.pairing}</p>}
          <div class={ways.length > 1 ? 'actions actions--two' : 'actions actions--one'}>
            {ways.includes('usb') && (
              <button class="btn btn--accent" disabled={busy !== null} onClick={() => void connect('usb')}>
                {busy === 'usb' ? <Spinner /> : l.connectUsb}
              </button>
            )}
            {ways.includes('bluetooth') && (
              <button class={ways.includes('usb') ? 'btn' : 'btn btn--accent'} disabled={busy !== null} onClick={() => void connect('bluetooth')}>
                {busy === 'bluetooth' ? <Spinner /> : l.connectBluetooth}
              </button>
            )}
          </div>
          <button class="btn" disabled={busy !== null} onClick={onBack}>
            {t.back}
          </button>
        </>
      ) : (
        <>
          <p class="alert" role="alert">
            {l.unsupported}
          </p>
          <button class="btn" onClick={onBack}>
            {t.back}
          </button>
        </>
      )}
    </section>
  );
}

type Prepared = { asset: AssetDef; to: string; amount: bigint; fee: bigint } & (
  | { kind: 'evm'; tx: EvmTransaction; token: string | null }
  // A Tron transaction is tied to a recent block, so it is built at the moment of signing.
  | { kind: 'tron'; feeLimit: bigint; activates: boolean }
);

function ColdSend({
  t,
  session,
  assets,
  prices,
  onClose,
}: {
  t: Dict;
  session: ColdSession;
  assets: readonly AssetDef[];
  prices: UsdPrices | null;
  onClose: (sent: boolean) => void;
}) {
  const l = t.ledger;
  const evm = session.evm ?? '';
  const [asset, setAsset] = useState<AssetDef>(assets[0] as AssetDef);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [step, setStep] = useState<'form' | 'preparing' | 'review' | 'signing' | 'sending' | 'done'>('form');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [txid, setTxid] = useState('');
  const [error, setError] = useState('');
  const usd = (a: AssetDef, units: bigint) => (prices ? ` ≈ ${usdFormat.format(usdOf(a, units, prices))}` : '');

  const prepareEvm = async (recipient: string, units: bigint | null): Promise<Prepared> => {
    const chain = evmOf(asset);
    // On Base a little ETH is kept back for the fee that is charged outside the gas estimate.
    const reserve = asset.chain === 'base' ? BASE_L1_RESERVE : 0n;
    const [fees, nonce, coin] = await Promise.all([
      fetchEvmFees(chain.rpc),
      fetchEvmNonce(chain.rpc, evm),
      fetchEvmBalance(chain.rpc, evm).then((r) => r.value),
    ]);
    const base = { chainId: chain.chainId, nonce, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas };
    if (asset.kind === 'erc20' && asset.contract) {
      // Without Ledger's description of the token the device would ask for blind signing.
      const token = ledgerTokenDescription(chain.chainId, asset.contract);
      if (!token) throw new Error(l.errNoToken);
      const held = await fetchErc20Balance(chain.rpc, asset.contract, evm);
      const value = units ?? held;
      if (value <= 0n || value > held) throw new Error(t.noFunds);
      const data = erc20TransferData(recipient, value);
      const gasLimit = await estimateEvmGas(chain.rpc, { from: evm, to: asset.contract, value: 0n, data: hexOf(data) }, 200_000n);
      const fee = gasLimit * fees.maxFeePerGas;
      if (fee + reserve > coin) throw new Error(t.noGas);
      return { kind: 'evm', asset, to: recipient, amount: value, fee, token, tx: { ...base, gasLimit, to: asset.contract, value: 0n, data } };
    }
    const gasLimit = await estimateEvmGas(chain.rpc, { from: evm, to: recipient, value: units ?? 1n });
    const fee = gasLimit * fees.maxFeePerGas;
    const value = units ?? coin - fee - reserve;
    if (value <= 0n || value + fee + reserve > coin) throw new Error(t.noFunds);
    return { kind: 'evm', asset, to: recipient, amount: value, fee, token: null, tx: { ...base, gasLimit, to: recipient, value } };
  };

  const prepareTron = async (recipient: string, units: bigint | null): Promise<Prepared> => {
    const from = session.tron ?? '';
    const [me, them, rates, resources, block] = await Promise.all([
      fetchTronAccount(NET.tron.nodes, from),
      fetchTronAccount(NET.tron.nodes, recipient),
      fetchTronFeeRates(NET.tron.nodes),
      fetchTronResources(NET.tron.nodes, from),
      fetchTronBlock(NET.tron.nodes),
    ]);
    const ref = tronRef(block, Date.now());
    // Bytes are free while the day's allowance lasts; otherwise each one is paid for.
    const bandwidthFee = (raw: Uint8Array) => (resources.bandwidth >= tronBandwidth(raw) ? 0n : tronBandwidth(raw) * rates.perByte);
    if (asset.kind === 'trc20' && asset.contract) {
      const held = await fetchTrc20Balance(NET.tron.nodes, asset.contract, from);
      const value = units ?? held;
      if (value <= 0n || value > held) throw new Error(t.noFunds);
      const energy = await estimateTrc20Energy(NET.tron.nodes, asset.contract, from, recipient, value);
      // The cap gets a 30% margin: a transfer that runs out of it fails and still costs the fee.
      const feeLimit = (energy * rates.perEnergy * 13n) / 10n;
      const paidEnergy = energy > resources.energy ? ((energy - resources.energy) * rates.perEnergy * 13n) / 10n : 0n;
      const fee = paidEnergy + bandwidthFee(buildTrc20Transfer(from, asset.contract, recipient, value, ref, feeLimit));
      if (fee > me.balance) throw new Error(t.noGas);
      return { kind: 'tron', asset, to: recipient, amount: value, fee, feeLimit, activates: false };
    }
    // Sending to an address nobody has used yet activates it, for a flat fee instead of the per-byte one.
    const fee = them.exists ? bandwidthFee(buildTronTransfer(from, recipient, 1n, ref)) : rates.newAccount;
    const value = units ?? me.balance - fee;
    if (value <= 0n || value + fee > me.balance) throw new Error(t.noFunds);
    return { kind: 'tron', asset, to: recipient, amount: value, fee, feeLimit: 0n, activates: !them.exists };
  };

  const prepare = async (e: Event) => {
    e.preventDefault();
    setError('');
    const recipient = to.trim();
    if (!(isTron(asset) ? isValidTronAddress(recipient) : isValidEvmAddress(recipient))) return setError(t.badAddress);
    const units = all ? null : parseUnits(amount, asset.decimals);
    if (!all && (units === null || units <= 0n)) return setError(t.badAmount);
    setStep('preparing');
    try {
      setPrepared(isTron(asset) ? await prepareTron(recipient, units) : await prepareEvm(recipient, units));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.nodesDown);
      setStep('form');
    }
  };

  const sign = async () => {
    if (!prepared) return;
    setError('');
    setStep('signing');
    try {
      // Asked first, so a wrong app is named plainly instead of failing with the device's own code.
      await requireApp(session.ledger, appOf(prepared.asset));
      if (prepared.kind === 'evm') {
        const signed = await session.ledger.sign(prepared.tx, evm, prepared.token ?? undefined);
        setStep('sending');
        setTxid(await broadcastEvm(evmOf(prepared.asset).rpc, signed.raw, signed.hash));
      } else {
        const from = session.tron ?? '';
        const block = await fetchTronBlock(NET.tron.nodes);
        const ref = { ...tronRef(block, Date.now()), expiration: block.timestamp + TRON_VALID_MS };
        const contract = prepared.asset.contract;
        const raw =
          prepared.asset.kind === 'trc20' && contract
            ? buildTrc20Transfer(from, contract, prepared.to, prepared.amount, ref, prepared.feeLimit)
            : buildTronTransfer(from, prepared.to, prepared.amount, ref);
        const signed = await session.ledger.signTron(raw, from);
        setStep('sending');
        setTxid(await broadcastTron(NET.tron.nodes, signed.signedHex, signed.txid));
      }
      setStep('done');
    } catch (err) {
      const device = err instanceof LedgerError || err instanceof WrongApp || /Ledger|disconnected/i.test(String((err as Error | null)?.message));
      setError(device ? ledgerText(t, err) : `${t.sendFailed} ${String((err as Error | null)?.message ?? '').slice(0, 160)}`);
      setStep('review');
    }
  };

  if (step === 'done' && prepared) {
    const link = prepared.kind === 'tron' ? NET.tron.explorerTx(txid) : evmOf(prepared.asset).explorerTx(txid);
    return (
      <section class="panel">
        <h2 class="title">{t.sentTitle}</h2>
        <p class="lead">{t.sentNote}</p>
        <code class="addr-value">{txid}</code>
        <a class="btn" href={link} target="_blank" rel="noopener noreferrer">
          {t.viewTx}
        </a>
        <button class="btn btn--accent" onClick={() => onClose(true)}>
          {t.done}
        </button>
      </section>
    );
  }

  if ((step === 'review' || step === 'signing' || step === 'sending') && prepared) {
    const a = prepared.asset;
    const feeAsset = feeAssetOf(a);
    const waiting = step !== 'review';
    const fee = text(feeAsset, prepared.fee);
    return (
      <section class="panel">
        <h2 class="title">{t.reviewTitle}</h2>
        <dl class="review">
          <dt>{t.sendTo}</dt>
          <dd class="review-addr">{prepared.to}</dd>
          <dt>{t.sendAmount}</dt>
          <dd class="review-total">
            {text(a, prepared.amount)} {a.ticker} <span class="dim">{a.net}</span>
            <span class="dim">{usd(a, prepared.amount)}</span>
          </dd>
          <dt>{t.fee}</dt>
          <dd>
            {fee.startsWith('<') ? '' : '≤ '}
            {fee} {feeAsset.ticker}
            <span class="dim">{usd(feeAsset, prepared.fee)}</span>
          </dd>
        </dl>
        {prepared.kind === 'tron' && prepared.activates && <p class="note">{l.tronActivates}</p>}
        <p class={waiting ? 'alert' : 'note'}>
          {step === 'sending' ? l.sending : waiting ? l.lookAtDevice : l.beforeSign.replace('{app}', appOf(a))}
        </p>
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <div class="row">
          <button class="btn" disabled={waiting} onClick={() => setStep('form')}>
            {t.back}
          </button>
          <button class="btn btn--accent" disabled={waiting} onClick={() => void sign()}>
            {waiting ? <Spinner /> : l.signOnDevice}
          </button>
        </div>
      </section>
    );
  }

  const typed = all ? null : parseUnits(amount, asset.decimals);
  return (
    <form class="panel" autocomplete="off" onSubmit={(e) => void prepare(e)}>
      <h2 class="title">{t.sendTitle}</h2>
      <div class="seg seg--four" role="tablist">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={a.id === asset.id}
            class="seg-item"
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
      <label class="field">
        <span class="field-label">
          {t.sendTo} <span class="dim">({asset.net})</span>
        </span>
        <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} value={to} onInput={(e) => setTo(e.currentTarget.value)} />
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
          <button type="button" class={`btn${all ? ' btn--accent' : ''}`} aria-pressed={all} onClick={() => setAll((v) => !v)}>
            {t.sendMax}
          </button>
        </span>
        <span class="dim amount-usd" aria-live="polite">
          {typed !== null && typed > 0n && prices ? usd(asset, typed).trim() : ' '}
        </span>
      </label>
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={() => onClose(false)}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent" disabled={step === 'preparing'}>
          {step === 'preparing' ? <Spinner /> : t.next}
        </button>
      </div>
    </form>
  );
}

function ColdReceive({ t, session, onClose }: { t: Dict; session: ColdSession; onClose: () => void }) {
  const l = t.ledger;
  const net = session.app;
  const [state, setState] = useState<'idle' | 'showing' | 'confirmed'>('idle');
  const [error, setError] = useState('');
  const address = coldAddress(session);

  const verify = async () => {
    setError('');
    setState('showing');
    try {
      await requireApp(session.ledger, net);
      const shown = net === 'Tron' ? await session.ledger.tronAddress(true) : await session.ledger.address(true);
      const same = net === 'Tron' ? shown === address : shown.toLowerCase() === address.toLowerCase();
      if (!same) throw new LedgerError('other', 0);
      setState('confirmed');
    } catch (e) {
      setError(ledgerText(t, e));
      setState('idle');
    }
  };
  return (
    <section class="panel">
      <h2 class="title">{t.receiveTitle}</h2>
      <Qr text={address} />
      <code class="addr-value">{address}</code>
      <CopyButton t={t} value={address} />
      <p class="note">{net === 'Tron' ? l.receiveTron : t.receiveEvmNote}</p>
      <p class={state === 'showing' ? 'alert' : 'note'}>
        {state === 'confirmed' ? l.addressConfirmed : state === 'showing' ? l.addressOnDevice : l.addressWhy.replace('{app}', net)}
      </p>
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button class="btn" onClick={onClose}>
          {t.back}
        </button>
        <button class="btn btn--accent" disabled={state === 'showing'} onClick={() => void verify()}>
          {state === 'showing' ? <Spinner /> : l.showOnDevice}
        </button>
      </div>
    </section>
  );
}

/** The wallet as seen with a Ledger: balances, receiving, and sending that the device itself shows and signs. */
export function ColdHome({
  t,
  session,
  onSession,
  onExit,
}: {
  t: Dict;
  session: ColdSession;
  onSession: (session: ColdSession) => void;
  onExit: () => void;
}) {
  const l = t.ledger;
  const [view, setView] = useState<'main' | 'send' | 'receive' | 'why'>('main');
  const [balances, setBalances] = useState<Record<string, bigint | null>>({});
  const [prices, setPrices] = useState<UsdPrices | null>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  const { app, evm, tron } = session;
  // Shown and sendable: the coins of the network whose app is open. The other network is only summed up.
  const assets = app === 'Tron' ? TRON_ASSETS : EVM_ASSETS;
  const others = app === 'Tron' ? (evm ? EVM_ASSETS : []) : tron ? TRON_ASSETS : [];
  const otherApp: DeviceApp = app === 'Tron' ? 'Ethereum' : 'Tron';
  const netName = (a: DeviceApp) => (a === 'Tron' ? 'Tron' : l.netEvm);

  const refresh = useCallback(async () => {
    setBusy(true);
    const list = [...(evm ? EVM_ASSETS : []), ...(tron ? TRON_ASSETS : [])];
    const [price, results] = await Promise.all([
      fetchUsdPrices().catch(() => null),
      Promise.allSettled(
        list.map((a) => {
          if (a.kind === 'eth') return fetchEvmBalance(evmOf(a).rpc, evm ?? '').then((r) => r.value);
          if (a.kind === 'erc20') return fetchErc20Balance(evmOf(a).rpc, a.contract ?? '', evm ?? '');
          if (a.kind === 'trx') return fetchTronAccount(NET.tron.nodes, tron ?? '').then((r) => r.balance);
          return fetchTrc20Balance(NET.tron.nodes, a.contract ?? '', tron ?? '');
        }),
      ),
    ]);
    setBalances((old) => {
      const next = { ...old };
      results.forEach((r, i) => {
        const a = list[i];
        if (a && r.status === 'fulfilled') next[a.id] = r.value;
      });
      return next;
    });
    if (price) setPrices(price);
    setBusy(false);
  }, [evm, tron]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const ledger = session.ledger;
  useEffect(() => {
    ledger.onDisconnect = () => setGone(true);
    return () => {
      ledger.onDisconnect = null;
    };
  }, [ledger]);

  /** The link drops whenever another app is opened on the device. Pick it up again; the wallet follows the app that is open now. */
  const reconnect = async () => {
    setLinkError('');
    setLinking(true);
    let device: Ledger | null = null;
    try {
      device = await Ledger.connect(session.ledger.way, true);
      const next = await readSession(device, session);
      session.ledger.onDisconnect = null;
      void session.ledger.close();
      setGone(false);
      setView('main');
      onSession(next);
    } catch (e) {
      setLinkError(ledgerText(t, e));
      await device?.close();
    } finally {
      setLinking(false);
    }
  };

  /** For a link that survived the change of app (Bluetooth can): ask the device again what is open. */
  const switchApp = async () => {
    setLinkError('');
    setLinking(true);
    try {
      const next = await readSession(session.ledger, session);
      if (next.app === session.app) throw new WrongApp(otherApp);
      onSession(next);
    } catch (e) {
      setLinkError(ledgerText(t, e));
    } finally {
      setLinking(false);
    }
  };

  const banner = gone && (
    <section class="panel" role="alert">
      <h2 class="title">{l.goneTitle}</h2>
      <p class="lead">{l.goneLead}</p>
      {linkError && <p class="alert">{linkError}</p>}
      <div class="row">
        <button class="btn" onClick={onExit}>
          {l.disconnect}
        </button>
        <button class="btn btn--accent" disabled={linking} onClick={() => void reconnect()}>
          {linking ? <Spinner /> : l.reconnect}
        </button>
      </div>
    </section>
  );

  let body;
  if (view === 'send') {
    body = (
      <ColdSend
        key={app}
        t={t}
        session={session}
        assets={assets}
        prices={prices}
        onClose={(sent) => {
          setView('main');
          if (sent) void refresh();
        }}
      />
    );
  } else if (view === 'receive') {
    body = <ColdReceive key={app} t={t} session={session} onClose={() => setView('main')} />;
  } else if (view === 'why') {
    body = (
      <section class="panel terms">
        <h2 class="title">{l.title}</h2>
        <Notice t={t} />
        <button class="btn" onClick={() => setView('main')}>
          {t.back}
        </button>
      </section>
    );
  } else {
    const known = assets.every((a) => balances[a.id] !== undefined && balances[a.id] !== null);
    const total = known && prices ? assets.reduce((sum, a) => sum + usdOf(a, balances[a.id] ?? 0n, prices), 0) : null;
    const otherKnown = others.length > 0 && others.every((a) => balances[a.id] !== undefined && balances[a.id] !== null);
    const otherTotal = otherKnown && prices ? others.reduce((sum, a) => sum + usdOf(a, balances[a.id] ?? 0n, prices), 0) : 0;
    const rows = [...assets].sort((x, y) => (prices ? usdOf(y, balances[y.id] ?? 0n, prices) - usdOf(x, balances[x.id] ?? 0n, prices) : 0));
    body = (
      <>
        <section class="panel">
          <div class="kv">
            <span class="dim">{t.balance}</span>
            <button class="tag cold-tag" onClick={() => setView('why')}>
              {l.badge} · {session.ledger.name} · {app.toLowerCase()}
            </button>
          </div>
          <div class="big">{total !== null ? usdFormat.format(total) : <Spinner />}</div>
          <div class="actions actions--two">
            <button class="btn btn--accent" onClick={() => setView('send')}>
              {t.send}
            </button>
            <button class="btn" onClick={() => setView('receive')}>
              {t.receive}
            </button>
          </div>
          <p class="note">{l.modeNote}</p>
        </section>

        <section class="panel">
          <h2 class="label">{t.assets}</h2>
          <ul class="rows">
            {rows.map((a) => {
              const held = balances[a.id];
              return (
                <li key={a.id} class="asset-li">
                  <div class="asset-row asset-row--plain">
                    <span class="asset-name">
                      <CoinIcon ticker={a.ticker} />
                      <span>
                        {a.ticker} <span class="dim">{a.net}</span>
                      </span>
                    </span>
                    <span class="num">
                      {held === undefined || held === null ? (
                        <Spinner />
                      ) : (
                        <>
                          {text(a, held)}
                          <span class="dim asset-usd">{prices ? `≈ ${usdFormat.format(usdOf(a, held, prices))}` : ''}</span>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {!gone && (
          <section class="panel">
            <p class="note">
              {otherTotal >= 0.01 && `${l.otherHeld.replace('{net}', netName(otherApp)).replace('{usd}', usdFormat.format(otherTotal))} `}
              {l.otherHint.replace('{net}', netName(app)).replace('{other}', netName(otherApp)).replace('{app}', otherApp)}
            </p>
            {linkError && (
              <p class="alert" role="alert">
                {linkError}
              </p>
            )}
            <button class="btn" disabled={linking} onClick={() => void switchApp()}>
              {linking ? <Spinner /> : l.switchApp.replace('{app}', otherApp)}
            </button>
          </section>
        )}

        <footer class="foot">
          <div class="row">
            <button class="btn" onClick={() => void refresh()} disabled={busy}>
              {busy ? <Spinner /> : t.refresh}
            </button>
            <button class="btn" onClick={onExit}>
              {l.disconnect}
            </button>
          </div>
        </footer>
      </>
    );
  }

  return (
    <>
      {banner}
      {body}
    </>
  );
}
