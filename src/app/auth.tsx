import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  entropyToPhrase,
  findKeyBlob,
  generateEntropy,
  hasKeyBlob,
  isValidMnemonic,
  isGuessablePassword,
  KeyfileError,
  MAX_CARRIER_BYTES,
  normalizeMnemonic,
  openSecret,
  packKeyfile,
  phraseToEntropy,
  sealSecret,
  secureRandomBytes,
  wipe,
} from '../core/index.ts';
import { Scramble, Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { pickPositions, rememberPassword } from './wallet.ts';
import './auth.css';

export interface Picked {
  name: string;
  type: string;
  bytes: Uint8Array;
}

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

export function errorText(t: Dict, e: unknown): string {
  if (e instanceof KeyfileError) {
    if (e.code === 'not-a-keyfile') return t.noKey;
    if (e.code === 'wrong-password') return t.badPassword;
    if (e.code === 'too-large') return t.tooLarge;
    if (e.code === 'unsupported') return t.unsupported;
  }
  return t.failed;
}

/** Progress of the password stretching, throttled so it doesn't re-render thousands of times. */
export function useProgress() {
  const [value, setValue] = useState(0);
  const last = useRef(0);
  const report = (fraction: number) => {
    const now = performance.now();
    if (fraction >= 1 || now - last.current > 50) {
      last.current = now;
      setValue(fraction);
    }
  };
  return [value, report] as const;
}

export function Working({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <section class="panel" role="status">
      <div class="kdf-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p class="dim kdf-text">
        <Spinner /> {label}… {percent}%
      </p>
    </section>
  );
}

/** File chooser that also accepts a dropped file. */
export function FileDrop({
  t,
  label,
  picked,
  onPick,
  onError,
}: {
  t: Dict;
  label: string;
  picked?: Picked | null;
  onPick: (file: Picked) => void;
  onError: (message: string) => void;
}) {
  const [over, setOver] = useState(false);
  const take = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_CARRIER_BYTES) {
      onError(t.tooLarge);
      return;
    }
    onPick({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  };
  return (
    <label
      class={cls('drop', over && 'drop--over', picked && 'drop--has')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer?.files[0]);
      }}
    >
      <input
        class="drop-input"
        type="file"
        onChange={(e) => {
          void take(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <span class="drop-icon" aria-hidden="true">
        {picked ? '✓' : '⇣'}
      </span>
      <span class="drop-text">{picked ? <Scramble text={picked.name} speed={10} /> : over ? t.dropOver : label}</span>
    </label>
  );
}

/** Rough strength estimate, 0..3, from length and the kinds of characters used. */
function strength(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9\u0080-￿]/.test(password)) pool += 33;
  if (/[\u0080-￿]/.test(password)) pool += 33;
  const bits = password.length * Math.log2(pool || 1);
  return bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : 3;
}

function PasswordStep({
  t,
  title,
  onDone,
  onBack,
}: {
  t: Dict;
  title: string;
  onDone: (password: string) => void;
  onBack: () => void;
}) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const level = strength(pw);
  const short = pw.length > 0 && pw.length < 8;
  const mismatch = again.length > 0 && pw !== again;
  const weak = pw.length >= 8 && isGuessablePassword(pw);
  const ok = pw.length >= 8 && !weak && pw === again;
  return (
    <form
      class="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDone(pw);
      }}
    >
      <h2 class="title">{title}</h2>
      <p class="lead">{t.pwLead}</p>
      <label class="field">
        <span class="field-label">{t.password}</span>
        <input
          class="input"
          type="password"
          autocomplete="new-password"
          value={pw}
          onInput={(e) => setPw(e.currentTarget.value)}
        />
      </label>
      <div class="meter" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} class={pw.length > 0 && i <= level ? 'on' : ''} />
        ))}
      </div>
      <label class="field">
        <span class="field-label">{t.passwordAgain}</span>
        <input
          class="input"
          type="password"
          autocomplete="new-password"
          value={again}
          onInput={(e) => setAgain(e.currentTarget.value)}
        />
      </label>
      <p class="status" aria-live="polite">
        <span>{pw.length > 0 ? t.pwLevels[level] : ''}</span>
        {short ? <span class="bad">{t.pwShort}</span> : weak ? <span class="bad">{t.pwWeak}</span> : mismatch ? <span class="bad">{t.pwMismatch}</span> : null}
      </p>
      <div class="row">
        <button type="button" class="btn" onClick={onBack}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent" disabled={!ok}>
          {t.next}
        </button>
      </div>
    </form>
  );
}

function saveFile(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: type || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** The warning and agreement shown before an account is created. All three boxes must be ticked. */
function Terms({ t, onAccept, onBack }: { t: Dict; onAccept: () => void; onBack: () => void }) {
  const [checked, setChecked] = useState<boolean[]>(() => t.terms.checks.map(() => false));
  const all = checked.every(Boolean);
  return (
    <form
      class="panel terms"
      onSubmit={(e) => {
        e.preventDefault();
        if (all) onAccept();
      }}
    >
      <h2 class="title">{t.terms.title}</h2>
      <p class="lead terms-intro">{t.terms.intro}</p>
      {t.terms.sections.map((section) => (
        <section class="terms-sec" key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <div class="terms-checks">
        {t.terms.checks.map((label, i) => (
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
      <div class="row">
        <button type="button" class="btn" onClick={onBack}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent" disabled={!all}>
          {t.terms.accept}
        </button>
      </div>
    </form>
  );
}

type RegisterStep = 'terms' | 'password' | 'carrier' | 'working' | 'download' | 'phrase' | 'verify' | 'confirm' | 'checking';

/**
 * Create an account: password -> key file -> paper backup -> prove the saved file works.
 * With `entropy` given it re-issues a key file for an existing account (recovery),
 * skipping the paper backup the owner already has.
 */
export function Register({
  t,
  entropy,
  onDone,
  onBack,
}: {
  t: Dict;
  entropy?: Uint8Array;
  onDone: (phrase: string) => void;
  onBack: () => void;
}) {
  const reissue = entropy !== undefined;
  const [secret] = useState(() => (entropy ? new Uint8Array(entropy) : generateEntropy(256)));
  const phrase = useMemo(() => entropyToPhrase(secret), [secret]);
  const words = useMemo(() => phrase.split(' '), [phrase]);
  const positions = useMemo(() => pickPositions(words.length, 3), [words]);
  // A new account starts with the agreement; re-issuing a key for an existing account skips it.
  const [step, setStep] = useState<RegisterStep>(reissue ? 'password' : 'terms');
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<(Picked & { hidden: boolean }) | null>(null);
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [wrong, setWrong] = useState(0);
  const [error, setError] = useState('');
  const [progress, onProgress] = useProgress();

  useEffect(() => () => wipe(secret), [secret]);

  const build = async (carrier?: Picked) => {
    setError('');
    setStep('working');
    try {
      const blob = await sealSecret(secret, password, { onProgress });
      const bytes = packKeyfile(blob, carrier?.bytes);
      const id = [...secureRandomBytes(2)].map((b) => b.toString(16).padStart(2, '0')).join('');
      setFile({
        name: carrier ? carrier.name : `me7-${id}.me7key`,
        type: carrier?.type ?? '',
        bytes,
        hidden: carrier !== undefined,
      });
      setSaved(false);
      setStep('download');
    } catch (e) {
      setError(errorText(t, e));
      setStep('carrier');
    }
  };

  const check = async (picked: Picked) => {
    setError('');
    setStep('checking');
    try {
      const got = await openSecret(findKeyBlob(picked.bytes), password, { onProgress });
      const same = got.length === secret.length && got.every((v, i) => v === secret[i]);
      wipe(got);
      if (!same) throw new KeyfileError('not-a-keyfile', 'Different account');
      rememberPassword(password);
      onDone(phrase);
    } catch {
      setError(t.confirmWrongFile);
      setStep('confirm');
    }
  };

  if (step === 'terms') return <Terms t={t} onBack={onBack} onAccept={() => setStep('password')} />;
  if (step === 'password') {
    return (
      <PasswordStep
        t={t}
        title={reissue ? t.reissueTitle : t.regTitle}
        onBack={reissue ? onBack : () => setStep('terms')}
        onDone={(pw) => {
          setPassword(pw);
          setStep('carrier');
        }}
      />
    );
  }
  if (step === 'working') return <Working label={t.working} value={progress} />;
  if (step === 'checking') return <Working label={t.checking} value={progress} />;

  if (step === 'carrier') {
    return (
      <section class="panel">
        <h2 class="title">{t.carrierTitle}</h2>
        <p class="lead">{t.carrierLead}</p>
        <button class="btn btn--accent btn--wide" onClick={() => void build()}>
          {t.carrierPlain}
        </button>
        <FileDrop t={t} label={t.carrierHide} onPick={(p) => void build(p)} onError={setError} />
        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}
        <button class="btn" onClick={() => setStep('password')}>
          {t.back}
        </button>
      </section>
    );
  }

  if (step === 'download' && file) {
    return (
      <section class="panel">
        <h2 class="title">{t.dlTitle}</h2>
        <p class="lead">{t.dlLead}</p>
        <p class="file-name">
          <Scramble text={file.name} speed={10} />
        </p>
        {file.hidden && <p class="note">{t.dlHiddenNote}</p>}
        <button
          class={cls('btn btn--wide', !saved && 'btn--accent')}
          onClick={() => {
            saveFile(file.bytes, file.name, file.type);
            setSaved(true);
          }}
        >
          {saved ? t.downloadAgain : t.download}
        </button>
        <div class="row">
          <button class="btn" onClick={() => setStep('carrier')}>
            {t.back}
          </button>
          <button class="btn btn--accent" disabled={!saved} onClick={() => setStep(reissue ? 'confirm' : 'phrase')}>
            {t.next}
          </button>
        </div>
      </section>
    );
  }

  if (step === 'phrase') {
    return (
      <section class="panel">
        <h2 class="title">{t.createTitle}</h2>
        <p class="lead">{t.createLead}</p>
        <ol class={cls('seed', revealed && 'seed--open')}>
          {words.map((w, i) => (
            <li key={i}>
              <span class="seed-n">{String(i + 1).padStart(2, '0')}</span>
              {revealed ? <Scramble text={w} delay={i * 45} /> : <span class="seed-mask">••••••</span>}
            </li>
          ))}
        </ol>
        <p class="note">{t.createRules}</p>
        <div class="row">
          <button class="btn" onClick={() => setStep('download')}>
            {t.back}
          </button>
          <button class="btn" onClick={() => setRevealed((r) => !r)}>
            {revealed ? t.hide : t.reveal}
          </button>
        </div>
        <button class="btn btn--accent btn--wide" disabled={!revealed} onClick={() => setStep('verify')}>
          {t.written}
        </button>
      </section>
    );
  }

  if (step === 'verify') {
    return (
      <form
        class="panel"
        autocomplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (positions.every((p, i) => normalizeMnemonic(answers[i] ?? '') === words[p])) setStep('confirm');
          else setWrong((n) => n + 1);
        }}
      >
        <h2 class="title">{t.verifyTitle}</h2>
        <p class="lead">{t.verifyLead}</p>
        <div class={cls('stack', wrong > 0 && 'shake')} key={wrong}>
          {positions.map((p, i) => (
            <label class="field" key={p}>
              <span class="field-label">
                {t.word} {String(p + 1).padStart(2, '0')}
              </span>
              <input
                class="input"
                type="text"
                autocapitalize="none"
                autocorrect="off"
                spellcheck={false}
                value={answers[i]}
                onInput={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.currentTarget.value : v)))}
              />
            </label>
          ))}
        </div>
        {wrong > 0 && (
          <p class="alert" role="alert">
            {t.verifyWrong}
          </p>
        )}
        <div class="row">
          <button type="button" class="btn" onClick={() => setStep('phrase')}>
            {t.back}
          </button>
          <button type="submit" class="btn btn--accent">
            {t.confirm}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section class="panel">
      <h2 class="title">{t.confirmTitle}</h2>
      <p class="lead">{t.confirmLead}</p>
      <FileDrop t={t} label={t.drop} onPick={(p) => void check(p)} onError={setError} />
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      <button class="btn" onClick={() => setStep('download')}>
        {t.back}
      </button>
    </section>
  );
}

/** Sign in with the key file and password, or fall back to the 24-word spare key. */
export function SignIn({
  t,
  initial,
  onDone,
  onRecover,
  onBack,
}: {
  t: Dict;
  /** A file dropped on the start page. */
  initial?: Picked | null;
  onDone: (phrase: string) => void;
  onRecover: (entropy: Uint8Array) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'file' | 'phrase'>('file');
  const usable = initial != null && hasKeyBlob(initial.bytes);
  const [picked, setPicked] = useState<Picked | null>(usable ? initial : null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial != null && !usable ? t.noKey : '');
  const [text, setText] = useState('');
  const [progress, onProgress] = useProgress();

  if (mode === 'phrase') {
    const normalized = normalizeMnemonic(text);
    const count = normalized ? normalized.split(' ').length : 0;
    const valid = count === 24 && isValidMnemonic(normalized);
    return (
      <form
        class="panel"
        autocomplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onRecover(phraseToEntropy(normalized));
        }}
      >
        <h2 class="title">{t.importTitle}</h2>
        <p class="lead">{t.importLead}</p>
        <textarea
          class="input input--area"
          rows={5}
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          placeholder={t.importPlaceholder}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <p class="status" aria-live="polite">
          <span>
            {t.words}: {count} / 24
          </span>
          {count === 24 && <span class={valid ? 'good' : 'bad'}>{valid ? t.phraseValid : t.phraseInvalid}</span>}
        </p>
        <div class="row">
          <button type="button" class="btn" onClick={() => setMode('file')}>
            {t.back}
          </button>
          <button type="submit" class="btn btn--accent" disabled={!valid}>
            {t.next}
          </button>
        </div>
      </form>
    );
  }

  if (busy) return <Working label={t.checking} value={progress} />;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!picked || !password) return;
    setError('');
    setBusy(true);
    try {
      const secret = await openSecret(findKeyBlob(picked.bytes), password, { onProgress });
      const phrase = entropyToPhrase(secret);
      wipe(secret);
      rememberPassword(password);
      onDone(phrase);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  };

  return (
    <form class="panel" onSubmit={(e) => void submit(e)}>
      <h2 class="title">{t.signTitle}</h2>
      <p class="lead">{t.signLead}</p>
      <FileDrop
        t={t}
        label={t.drop}
        picked={picked}
        onError={setError}
        onPick={(p) => {
          try {
            findKeyBlob(p.bytes);
            setPicked(p);
            setError('');
          } catch (err) {
            setPicked(null);
            setError(errorText(t, err));
          }
        }}
      />
      <label class="field">
        <span class="field-label">{t.password}</span>
        <input
          class="input"
          type="password"
          autocomplete="current-password"
          autofocus={usable}
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
      </label>
      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}
      {/* A key cut off by a messenger cannot be told from a wrong password, so the likeliest cause is said beside it. */}
      {error === t.badPassword && <p class="note">{t.keyCutHint}</p>}
      <div class="row">
        <button type="button" class="btn" onClick={onBack}>
          {t.back}
        </button>
        <button type="submit" class="btn btn--accent" disabled={!picked || !password}>
          {t.signIn}
        </button>
      </div>
      <button type="button" class="link auth-alt" onClick={() => setMode('phrase')}>
        {t.phraseOnly}
      </button>
    </form>
  );
}
