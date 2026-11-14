import { useEffect, useState } from 'preact/hooks';
import type { Unsigned } from '../core/rotation.ts';
import { firstSpendNonce } from '../core/rotation.ts';
import { isIssuableLabel } from '../core/names.ts';
import { addressCode } from '../core/payqr.ts';
import { formatUnits } from '../net/balances.ts';
import { GASLESS, NET } from '../net/endpoints.ts';
import { resolveName } from '../net/names.ts';
import { fetchNameQuote, relayIssueName, RelayError } from '../net/relay.ts';
import { loadRotation, signWithAddresses } from './addresses.ts';
import { Spinner } from './fx.tsx';
import { Hold } from './hold.tsx';
import { CopyButton, relayErrorText } from './home.tsx';
import type { Dict } from './i18n.ts';
import { rememberOwnName } from './ownname.ts';
import { isSessionPassword, type Wallet } from './wallet.ts';

/**
 * A name for the wallet's main address: "anna.base.eth". me7's service registers it in Base's
 * registry for a year and is paid in USDC, so the owner needs no ETH. The name points at the main
 * address only: it is public and permanent, unlike the addresses handed out for receiving.
 */
const SUFFIX = '.base.eth';
const hexOf = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const usdc = (units: bigint) => formatUnits(units, 6, 2);

export function Naming({ t, wallet, onClose }: { t: Dict; wallet: Wallet; onClose: () => void }) {
  const n = t.naming;
  const [label, setLabel] = useState('');
  const [quote, setQuote] = useState<{ available: boolean; affordable: boolean; fee: bigint } | 'looking' | 'down' | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'holding' | 'sending' | 'checking' | 'done'>('form');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const [own, setOwn] = useState('');
  const [ownNote, setOwnNote] = useState('');
  const clean = label.trim().toLowerCase();
  const full = `${clean}${SUFFIX}`;

  // The price and whether the name is free, asked once the typing pauses.
  useEffect(() => {
    if (!isIssuableLabel(clean)) return setQuote(null);
    setQuote('looking');
    let live = true;
    const id = setTimeout(() => {
      fetchNameQuote(clean).then(
        (q) => live && setQuote(q),
        () => live && setQuote('down'),
      );
    }, 500);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [clean]);

  const ready = quote && typeof quote === 'object' && quote.available && quote.affordable ? quote : null;

  const issue = async () => {
    if (!ready) return;
    setStep('sending');
    try {
      const base = NET.base;
      if (!base) throw new Error('no Base network');
      // The fee comes from one address that holds enough: the smallest such, so the least is shown.
      const { holdings } = await loadRotation(wallet, true);
      const payer = holdings.filter((h) => h.balance >= ready.fee).sort((a, b) => (a.balance < b.balance ? -1 : 1))[0];
      if (!payer) {
        setError(n.noFunds.replace('{fee}', usdc(ready.fee)));
        return setStep('review');
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const unsigned: Unsigned = {
        index: payer.index,
        from: payer.address,
        to: GASLESS.receiver,
        value: ready.fee,
        validAfter: 0n,
        validBefore: now + 600n,
        // An address's first transfer through the service carries its mark, as every other one does.
        nonce: payer.spent || payer.index === 0 ? hexOf(crypto.getRandomValues(new Uint8Array(32))) : firstSpendNonce(payer.address),
      };
      const [fee] = signWithAddresses(wallet, { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc }, [unsigned]);
      if (!fee) throw new Error('nothing to sign');
      setHash(await relayIssueName(clean, wallet.evm, fee));
      setStep('checking');
      // The name is believed only once the blockchain itself says it points here.
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const found = await resolveName(full).catch(() => null);
        if (found && found.address.toLowerCase() === wallet.evm.toLowerCase()) {
          rememberOwnName(wallet.evm, full);
          return setStep('done');
        }
      }
      setError(n.slow);
      setStep('done');
    } catch (err) {
      setError(err instanceof RelayError && err.code === 'taken' ? n.taken : err instanceof RelayError && err.code === 'empty' ? n.empty : err instanceof RelayError && err.code === 'would-fail' ? n.failed : relayErrorText(t, err));
      setStep('review');
    }
  };

  const attach = async () => {
    setOwnNote('');
    const typed = own.trim().toLowerCase();
    const name = typed.endsWith('.eth') ? typed : `${typed}${SUFFIX}`;
    try {
      const found = await resolveName(name);
      if (found && found.address.toLowerCase() === wallet.evm.toLowerCase()) {
        rememberOwnName(wallet.evm, found.name);
        setOwnNote(n.attached.replace('{name}', found.name));
      } else setOwnNote(n.notYours);
    } catch {
      setOwnNote(t.pay.nameDown);
    }
  };

  if (!(wallet.seed instanceof Uint8Array)) {
    return (
      <section class="panel">
        <h2 class="title">{n.title}</h2>
        <p class="lead">{n.noSeed}</p>
        <button class="btn" onClick={onClose}>
          {t.back}
        </button>
      </section>
    );
  }
  if (step === 'holding' && ready) {
    return (
      <Hold
        t={t}
        lines={[full, `${n.fee}: ${usdc(ready.fee)} usdc`]}
        onDone={() => void issue()}
        onCancel={() => {
          setError(n.cancelled);
          setStep('review');
        }}
      />
    );
  }
  if (step === 'sending' || step === 'checking') {
    return (
      <section class="panel" role="status">
        <p class="dim">
          <Spinner /> {step === 'sending' ? n.sending : n.checking}…
        </p>
      </section>
    );
  }
  if (step === 'done') {
    return (
      <section class="panel">
        <h2 class="title">{error ? n.sentTitle : n.doneTitle}</h2>
        {error ? (
          <p class="alert" role="alert">
            {error}
          </p>
        ) : (
          <p class="lead">{n.doneNote}</p>
        )}
        <dl class="review">
          <dt>{n.name}</dt>
          <dd class="review-total">{full}</dd>
          <dt>{n.pointsTo}</dt>
          <dd class="review-addr">{wallet.evm}</dd>
          <dt>{t.report.id}</dt>
          <dd class="review-addr">{hash}</dd>
        </dl>
        <div class="row">
          <CopyButton t={t} value={full} />
          {NET.base && hash && (
            <a class="btn" href={NET.base.explorerTx(hash)} target="_blank" rel="noopener noreferrer">
              {t.viewTx}
            </a>
          )}
        </div>
        <button class="btn btn--accent" onClick={onClose}>
          {t.done}
        </button>
      </section>
    );
  }
  if (step === 'review' && ready) {
    return (
      <section class="panel">
        <h2 class="title">{n.reviewTitle}</h2>
        <dl class="review">
          <dt>{n.name}</dt>
          <dd class="review-total">{full}</dd>
          <dt>{n.pointsTo}</dt>
          <dd class="review-addr">{wallet.evm}</dd>
          <dt>{t.pay.code}</dt>
          <dd>{addressCode(wallet.evm)}</dd>
          <dt>{n.term}</dt>
          <dd>{n.year}</dd>
          <dt>{n.fee}</dt>
          <dd class="review-total">{usdc(ready.fee)} usdc</dd>
        </dl>
        <ul class="policy">
          {n.warnings.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <label class="field">
          <span class="field-label">{t.confirmPassword}</span>
          <input class="input" type="password" autocomplete="current-password" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} />
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
          <button
            class="btn btn--accent"
            onClick={() => {
              if (!isSessionPassword(confirm)) return setError(t.wrongPassword);
              setConfirm('');
              setError('');
              setStep('holding');
            }}
          >
            {n.buy}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section class="panel">
      <h2 class="title">{n.title}</h2>
      <p class="lead">{n.lead}</p>
      <label class="field">
        <span class="field-label">{n.pick}</span>
        <span class="name-row">
          <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} maxLength={63} placeholder="anna" value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
          <span class="dim">{SUFFIX}</span>
        </span>
        {clean !== '' && !isIssuableLabel(clean) && <span class="dim">{n.rules}</span>}
        {quote === 'looking' && (
          <span class="dim" role="status">
            {n.asking} <Spinner />
          </span>
        )}
        {quote === 'down' && <span class="dim">{n.down}</span>}
        {quote && typeof quote === 'object' && !quote.available && <span class="dim">{n.taken}</span>}
        {quote && typeof quote === 'object' && quote.available && !quote.affordable && <span class="dim">{n.empty}</span>}
        {ready && (
          <span class="name-found">
            <b>{full}</b>
            <span>
              {n.free} {n.fee}: {usdc(ready.fee)} usdc {n.perYear}
            </span>
          </span>
        )}
      </label>
      <p class="note">{n.prices}</p>
      <div class="row">
        <button class="btn" onClick={onClose}>
          {t.back}
        </button>
        <button
          class="btn btn--accent"
          disabled={!ready}
          onClick={() => {
            setError('');
            setStep('review');
          }}
        >
          {t.next}
        </button>
      </div>
      <label class="field">
        <span class="field-label">{n.haveOne}</span>
        <span class="field-row">
          <input class="input" type="text" autocapitalize="none" autocorrect="off" spellcheck={false} placeholder={`anna${SUFFIX}`} value={own} onInput={(e) => setOwn(e.currentTarget.value)} />
          <button type="button" class="btn" disabled={own.trim() === ''} onClick={() => void attach()}>
            {n.attach}
          </button>
        </span>
        {ownNote && <span class="dim">{ownNote}</span>}
      </label>
    </section>
  );
}
