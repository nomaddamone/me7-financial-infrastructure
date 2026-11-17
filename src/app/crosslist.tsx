import { useEffect, useState } from 'preact/hooks';
import { formatUnits } from '../net/balances.ts';
import { CROSS } from '../net/endpoints.ts';
import { oneTimeAddresses, oneTimeEthAddresses, payOnward, planOnward, takeBack, type OneTime, type OnwardPayment } from './crossing.ts';
import { textsFor, type Rail } from './crosspay.tsx';
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
 * The wallet's one-time addresses, on the page of the coin they were used for (USDT on Tron, USDT
 * or USDC on Ethereum): only those that still hold enough to be worth taking back, and the way
 * to take it back to the main address. Cents left over after a payment are not shown at all.
 */
export function CrossList({ t, wallet, rail }: { t: Dict; wallet: Wallet; rail: Rail }) {
  const x = textsFor(t.cross, rail);
  const [list, setList] = useState<OneTime[] | null>(null);
  const [down, setDown] = useState(false);
  // Taking a remainder back: which address, what it would come to, and the password that lets money move.
  const [taking, setTaking] = useState<{ one: OneTime; pay: OnwardPayment | null } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = (fresh = false) =>
    (rail.net === 'eth' ? oneTimeEthAddresses(wallet, rail.token, fresh) : oneTimeAddresses(wallet, fresh)).then(
      // Only what is worth moving: the rest is nobody's business.
      (found) => (setList(found.filter((one) => one.held >= CROSS.showFrom)), setDown(false)),
      () => setDown(true),
    );
  useEffect(() => void load(), []);

  if (down && !list) return null;
  if (!list || list.length === 0) return null;
  // The address with the most on it is taken back first.
  const worth = list.reduce<OneTime | null>((best, one) => (!best || one.held > best.held ? one : best), null);

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

  const shown = list;
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
