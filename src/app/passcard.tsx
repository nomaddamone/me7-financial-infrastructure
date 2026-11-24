import encodeQR from 'qr';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { addressCode } from '../core/payqr.ts';
import { lookPass, makePass, passLink, PassError, removePass, updatePass, type PassAsk } from '../net/pass.ts';
import type { Dict, Lang } from './i18n.ts';
import { useOwnName } from './ownname.ts';
import { keepPass, loadPass, passAddresses, type KeptPass } from './passcard.ts';
import type { Wallet } from './wallet.ts';
import logo from './pass-art/logo.png';
import stripEn from './pass-art/strip-en.png';
import stripRu from './pass-art/strip-ru.png';
import './passcard.css';

/**
 * The card as it will look in Wallet, with sample figures: the same pictures the service puts on a real card,
 * and the wallet's own code, drawn here in the browser. Nothing is asked of the service to show it.
 */
function Sample({ t, receive, address }: { t: Dict; receive: string; address: string }) {
  const p = t.pass;
  const path = useMemo(() => {
    const rows = encodeQR(receive, 'raw', { ecc: 'medium', border: 2 });
    return { size: rows.length, d: rows.map((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : '')).join('')).join('') };
  }, [receive]);
  return (
    <figure class="pass-sample" aria-label={p.sample}>
      <div class="pass-notice">{p.sampleNotice}</div>
      <div class="pass-face">
        <div class="pass-top">
          <img class="pass-logo" src={logo} alt="me7" width="49" height="50" />
          <div class="pass-field pass-field--right">
            <span>BASE</span>
            <b>USDC</b>
          </div>
        </div>
        <img class="pass-strip" src={p.lang === 'ru' ? stripRu : stripEn} alt="1 240.50" width="375" height="123" />
        <div class="pass-fields">
          <div class="pass-field">
            <span>{p.sampleArrived}</span>
            <b>+25.00 USDC</b>
          </div>
          <div class="pass-field pass-field--right">
            <span>{p.sampleCode}</span>
            <b>{addressCode(address)}</b>
          </div>
        </div>
        <div class="pass-code">
          <svg viewBox={`0 0 ${path.size} ${path.size}`} shape-rendering="crispEdges" aria-hidden="true">
            <path d={path.d} />
          </svg>
          <span>{receive.length > 24 ? `${receive.slice(0, 10)}…${receive.slice(-8)}` : receive}</span>
        </div>
      </div>
      <figcaption class="tag">{p.sample}</figcaption>
    </figure>
  );
}

/**
 * The card in Apple Wallet: what it is, what me7's service learns when it is made, and the making itself.
 * Nothing is sent to the service until the user has chosen the addresses and said they understand.
 */
export function PassCard({ t, wallet }: { t: Dict; wallet: Wallet }) {
  const p = t.pass;
  const lang: Lang = p.lang;
  const name = useOwnName(wallet.evm);
  const [kept, setKept] = useState<KeptPass | null>(() => loadPass(wallet));
  const [phones, setPhones] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState('');
  const [asking, setAsking] = useState(false);

  const askFor = (addresses: readonly string[]): PassAsk => ({ addresses, main: wallet.evm, ...(name ? { name } : {}), lang, zone: -new Date().getTimezoneOffset() });
  const say = (e: unknown) => setFault(e instanceof PassError && e.fault === 'limit' ? p.limit : p.down);

  // How many addresses "all of them" means, for the choice itself.
  useEffect(() => {
    let live = true;
    void passAddresses(wallet).then((list) => live && setCount(list.length), () => undefined);
    return () => void (live = false);
  }, [wallet]);

  // A card that is kept: is it still at the service, and has the pocket gained addresses the card does not know yet?
  useEffect(() => {
    if (!kept) return;
    let live = true;
    void (async () => {
      try {
        const seen = await lookPass(kept.serial, kept.token);
        if (!live) return;
        setPhones(seen.phones);
        if (!kept.all) return;
        const now = await passAddresses(wallet);
        if (now.length === kept.addresses.length && now.every((a) => kept.addresses.includes(a))) return;
        await updatePass(kept.serial, kept.token, askFor(now));
        const next = { ...kept, addresses: now };
        keepPass(wallet, next);
        if (live) setKept(next);
      } catch (e) {
        // The service no longer keeps the card (it was removed from the phone): this device forgets it too.
        if (live && e instanceof PassError && e.fault === 'unknown') (keepPass(wallet, null), setKept(null), setPhones(null));
      }
    })();
    return () => void (live = false);
  }, [kept?.serial]);

  async function make() {
    setBusy(true);
    setFault('');
    try {
      const addresses = all ? await passAddresses(wallet) : [wallet.evm.toLowerCase()];
      const made = await makePass(askFor(addresses));
      const next: KeptPass = { serial: made.serial, token: made.token, all, addresses };
      keepPass(wallet, next);
      setKept(next);
      setPhones(0);
      location.assign(passLink(made.serial, made.ticket));
    } catch (e) {
      say(e);
    } finally {
      setBusy(false);
    }
  }
  async function again() {
    if (!kept) return;
    setBusy(true);
    setFault('');
    try {
      const seen = await lookPass(kept.serial, kept.token, true);
      location.assign(passLink(kept.serial, seen.ticket));
    } catch (e) {
      if (e instanceof PassError && e.fault === 'unknown') (keepPass(wallet, null), setKept(null));
      else say(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!kept) return;
    setBusy(true);
    setFault('');
    try {
      await removePass(kept.serial, kept.token).catch((e: unknown) => {
        if (!(e instanceof PassError && e.fault === 'unknown')) throw e;
      });
      keepPass(wallet, null);
      setKept(null);
      setPhones(null);
      setAsking(false);
      setAgreed(false);
    } catch (e) {
      say(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="panel pass">
      <div class="kv">
        <h2 class="title">{p.title}</h2>
        {kept && <span class="tag">{p.made}</span>}
      </div>
      <p class="lead">{p.lead}</p>
      <Sample t={t} receive={name ?? wallet.evm} address={wallet.evm} />
      <p class="pass-trust">{p.trust}</p>

      {!kept && (
        <>
          <div class="seg seg--two" role="tablist">
            <button class="seg-item" role="tab" aria-selected={!all} onClick={() => setAll(false)}>
              {p.onlyMain}
              <span class="seg-net">{p.onlyMainSub}</span>
            </button>
            <button class="seg-item" role="tab" aria-selected={all} onClick={() => setAll(true)}>
              {p.all}
              <span class="seg-net">{count === null ? p.allSub : p.allCount.replace('{n}', String(count))}</span>
            </button>
          </div>
          <p class="note">{all ? p.allNote : p.onlyMainNote}</p>
          <label class="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} />
            <span class="check-box" aria-hidden="true" />
            <span>{p.agree}</span>
          </label>
          <button class="btn btn--accent btn--wide" disabled={!agreed || busy} onClick={() => void make()}>
            {busy ? p.making : p.add}
          </button>
          {!/iPhone|iPad/.test(navigator.userAgent) && <p class="note">{p.where}</p>}
        </>
      )}

      {kept && (
        <>
          <p class="note">
            {(kept.all ? p.watchesAll : p.watchesMain).replace('{n}', String(kept.addresses.length))}
            {phones !== null && ` ${phones > 0 ? p.phones.replace('{n}', String(phones)) : p.notTaken}`}
          </p>
          {!asking && (
            <div class="row">
              <button class="btn" disabled={busy} onClick={() => setAsking(true)}>
                {p.remove}
              </button>
              <button class="btn btn--accent" disabled={busy} onClick={() => void again()}>
                {p.again}
              </button>
            </div>
          )}
          {asking && (
            <>
              <p class="note">{p.removeNote}</p>
              <div class="row">
                <button class="btn" disabled={busy} onClick={() => setAsking(false)}>
                  {p.keep}
                </button>
                <button class="btn btn--accent" disabled={busy} onClick={() => void remove()}>
                  {p.removeYes}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {fault && <p class="alert">{fault}</p>}
    </section>
  );
}
