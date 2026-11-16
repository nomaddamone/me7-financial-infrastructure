import { useEffect, useState } from 'preact/hooks';
import { formatUnits } from '../net/balances.ts';
import { CROSS } from '../net/endpoints.ts';
import { oneTimeAddresses, payOnward, planOnward, takeBack, type OneTime, type OnwardPayment } from './crossing.ts';
import { Spinner } from './fx.tsx';
import { CopyButton, relayErrorText } from './home.tsx';
import type { Dict } from './i18n.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

const money = (units: bigint) => {
  const text = formatUnits(units, 6, 2);
  return units > 0n && text === '0' ? '< 0.01' : text;
};
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/**
 * The wallet's one-time Tron addresses, on the page of USDT on Tron: the addresses payments made
 * out of USDC left from, what is still on each, and a way to take a remainder worth taking back
 * to the main address. Nothing is shown to a wallet that has never paid this way.
 */
export function CrossList({ t, wallet }: { t: Dict; wallet: Wallet }) {
  const x = t.cross;
  const [list, setList] = useState<OneTime[] | null>(null);
  const [down, setDown] = useState(false);
  // Taking a remainder back: which address, what it would come to, and the password that lets money move.
  const [taking, setTaking] = useState<{ one: OneTime; pay: OnwardPayment | null } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

  const load = (fresh = false) =>
    oneTimeAddresses(wallet, fresh).then(
      (found) => (setList(found), setDown(false)),
      () => setDown(true),
    );
  useEffect(() => void load(), []);

  if (down && !list) return null;
  // Cents left over after a payment cost more to move than they are worth, so they are nobody's business: the list
  // is shown only when some address holds enough to be worth taking back (a payment cut short, or money sent there later).
  if (!list || !list.some((one) => one.held >= CROSS.min)) return null;
  // The address with the most on it, if that is worth the fee of taking it back.
  const worth = list.reduce<OneTime | null>((best, one) => (one.held >= CROSS.min && (!best || one.held > best.held) ? one : best), null);

  const open = async (one: OneTime) => {
    setSaid('');
    setConfirm('');
    setTaking({ one, pay: null });
    try {
      const pay = await planOnward(takeBack(wallet, one));
      setTaking({ one, pay });
    } catch (err) {
      setTaking(null);
      setSaid(relayErrorText(t, err));
    }
  };
  const take = async () => {
    if (!taking?.pay || busy) return;
    if (!isSessionPassword(confirm)) return setSaid(t.wrongPassword);
    setBusy(true);
    setSaid('');
    try {
      await payOnward(wallet, takeBack(wallet, taking.one), taking.pay);
      setTaking(null);
      setSaid(x.sweepDone);
      void load(true);
    } catch (err) {
      setSaid(relayErrorText(t, err));
    } finally {
      setBusy(false);
      setConfirm('');
    }
  };

  // As with the addresses of USDC on Base: the list is opened on request, and addresses with nothing left stay out of it unless asked for.
  const empty = list.filter((one) => one.held === 0n);
  const shown = list.filter((one) => one.held > 0n || showEmpty);
  return (
    <section class="panel">
      <button type="button" class="linklike" onClick={() => setShowAll((v) => !v)}>
        {x.listTitle} ({list.length})
      </button>
      {showAll && (
        <>
          <ul class="rows addr-rows">
            {shown.map((one) => (
              <li key={one.index} class="addr-row">
                <span class="addr-row-name">
                  <code>{short(one.address)}</code>
                  <span class="dim">
                    #{one.index}
                    {one.crossing && ` · ${new Date(one.crossing.started).toLocaleDateString()} · ${x.listTo.replace('{to}', short(one.crossing.to))}`}
                  </span>
                </span>
                <span class="addr-row-sum">{money(one.held)}</span>
                <CopyButton t={t} value={one.address} />
              </li>
            ))}
          </ul>
          {empty.length > 0 && (
            <button type="button" class="linklike" onClick={() => setShowEmpty((v) => !v)}>
              {(showEmpty ? t.gasless.hideEmpty : t.gasless.showEmpty).replace('{n}', String(empty.length))}
            </button>
          )}
          <p class="note">{x.listLead}</p>
          {worth && !taking && (
            <button class="btn" onClick={() => void open(worth)}>
              {x.sweep}
            </button>
          )}
          {taking &&
            (taking.pay === null ? (
              <p class="dim" role="status">
                <Spinner />
              </p>
            ) : taking.pay.amount <= 0n ? (
              <p class="note">{x.sweepNothing.replace('{fee}', money(taking.pay.fee))}</p>
            ) : (
              <>
                <p class="note">{x.sweepQuote.replace('{from}', short(taking.one.address)).replace('{get}', money(taking.pay.amount)).replace('{fee}', money(taking.pay.fee))}</p>
                <label class="field">
                  <span class="field-label">{t.confirmPassword}</span>
                  <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void take()} />
                </label>
                <div class="row">
                  <button class="btn" onClick={() => setTaking(null)}>
                    {t.back}
                  </button>
                  <button class="btn btn--accent" disabled={busy} onClick={() => void take()}>
                    {busy ? <Spinner /> : x.sweep}
                  </button>
                </div>
              </>
            ))}
          {down && <p class="dim">{x.listDown}</p>}
          {said && (
            <p class={said === x.sweepDone ? 'note' : 'alert'} role="status">
              {said}
            </p>
          )}
        </>
      )}
    </section>
  );
}
