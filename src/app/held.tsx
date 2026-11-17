import { useEffect, useState } from 'preact/hooks';
import { isValidEvmAddress } from '../core/evm.ts';
import { formatUnits } from '../net/balances.ts';
import { NET } from '../net/endpoints.ts';
import { Spinner } from './fx.tsx';
import { CopyButton } from './home.tsx';
import type { Dict } from './i18n.ts';
import type { Quarantined } from './quarantine.ts';
import { isOwnAddress, planSelfOut, sendSelfOut, type SelfOut } from './selfout.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

/**
 * What is said under an address in quarantine: why, from whom, and the one way out, which is to
 * move the money out by the owner's own means (see src/app/selfout.ts).
 */
export function HeldNote({ t, wallet, mark, holding, amount, onChanged }: { t: Dict; wallet: Wallet; mark: Quarantined; holding?: { index: number; address: string }; amount: string; onChanged?: () => void }) {
  const q = t.held;
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState(false);
  const why = mark.why === 'service' ? q.whyService : mark.why === 'sanctioned' ? q.whySanctioned : mark.why === 'frozen' ? q.whyFrozen.replace('{issuer}', mark.chain === 'base' ? 'Circle' : 'Tether') : q.whyScam;
  return (
    <div class="held">
      <button type="button" class="held-tag" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg class="held-sign" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.6 15 14H1Z" />
          <path d="M8 6.2v4M8 11.6v.6" />
        </svg>
        {q.tag}
      </button>
      {open && (
        <>
          <p class="held-why">{why}</p>
          {mark.from && <p class="held-from">{q.from.replace('{from}', short(mark.from)).replace('{sum}', amount)}</p>}
          <p class="held-lead">{mark.chain === 'tron' ? q.leadTron : q.lead}</p>
          {/* On Tron the way out is the ordinary transfer paid in TRX, which the wallet already has. */}
          {!holding ? null : out ? (
            <SelfOutForm t={t} wallet={wallet} holding={holding} onChanged={onChanged ?? (() => undefined)} />
          ) : (
            <button type="button" class="btn held-out" onClick={() => setOut(true)}>
              {q.out}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SelfOutForm({ t, wallet, holding, onChanged }: { t: Dict; wallet: Wallet; holding: { index: number; address: string }; onChanged: () => void }) {
  const q = t.held;
  const [to, setTo] = useState('');
  const [plan, setPlan] = useState<SelfOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const recipient = to.trim();
  // A plan belongs to the address it was made for: another address needs another.
  useEffect(() => setPlan(null), [recipient]);

  const check = async () => {
    setError('');
    if (!isValidEvmAddress(recipient)) return setError(t.badAddress);
    setBusy(true);
    try {
      if (await isOwnAddress(wallet, recipient)) return setError(q.outOwn);
      const next = await planSelfOut(holding.address, recipient);
      if (next.held <= 0n) return setError(q.outEmpty);
      setPlan(next);
    } catch {
      setError(q.outErr);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!plan?.tx) return;
    if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
    setConfirm('');
    setError('');
    setBusy(true);
    try {
      setHash(await sendSelfOut(wallet, holding, plan.tx));
      onChanged();
    } catch {
      setError(q.outErr);
    } finally {
      setBusy(false);
    }
  };
  const eth = (wei: bigint) => `${formatUnits(wei, 18, 6)} ETH`;

  if (hash) {
    return (
      <p class="held-lead">
        {q.outDone}{' '}
        <a href={NET.base?.explorerTx(hash)} target="_blank" rel="noreferrer">
          {short(hash)}
        </a>
      </p>
    );
  }
  return (
    <div class="held-form">
      <label class="field">
        <span class="field-label">{q.outTo}</span>
        <input class="input" type="text" autocomplete="off" spellcheck={false} placeholder="0x…" value={to} onInput={(e) => setTo(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !plan && void check()} />
      </label>
      {plan && (
        <p class="held-lead">
          {q.outHave.replace('{usdc}', formatUnits(plan.held, 6, 2)).replace('{eth}', eth(plan.coin))}
        </p>
      )}
      {plan && !plan.tx && (
        <>
          <p class="held-why">{q.outNeed.replace('{need}', eth(plan.need))}</p>
          <div class="held-addr">
            <code>{holding.address}</code>
            <CopyButton t={t} value={holding.address} />
          </div>
          <p class="held-lead">{q.outLink}</p>
        </>
      )}
      {plan?.tx && (
        <>
          <p class="held-lead">{q.outFee.replace('{fee}', eth(plan.fee))}</p>
          <label class="field">
            <span class="field-label">{t.confirmPassword}</span>
            <input class="input" type="password" autocomplete="off" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} />
          </label>
        </>
      )}
      {plan?.tx ? (
        <button type="button" class="btn btn--accent" disabled={busy} onClick={() => void send()}>
          {busy ? <Spinner /> : q.outSend.replace('{usdc}', formatUnits(plan.held, 6, 2))}
        </button>
      ) : (
        <button type="button" class="btn" disabled={busy} onClick={() => void check()}>
          {busy ? <Spinner /> : plan ? q.outAgain : q.outCheck}
        </button>
      )}
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
