import { useEffect, useMemo, useState } from 'preact/hooks';
import { MAX_CARRIER_BYTES } from '../core/index.ts';
import { SOURCE_URL } from '../net/endpoints.ts';
import type { Picked } from './auth.tsx';
import { Cta } from './cta.tsx';
import { Showcase } from './showcase.tsx';
import { Scramble } from './fx.tsx';
import type { Dict } from './i18n.ts';
import { Logo } from './logo.tsx';
import { selfTest } from './wallet.ts';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const pick = (set: string) => set[Math.floor(Math.random() * set.length)] ?? 'x';

/**
 * A first name and a surname that never come into focus. Stands where the
 * author of the project's own quote would be named: a name is there, blurred,
 * and the focus keeps hunting without ever finding it. The letters are made up
 * afresh on every visit and spell nothing.
 */
function Unloaded() {
  const name = useMemo(() => [6, 9].map((n) => pick(LETTERS).toUpperCase() + Array.from({ length: n - 1 }, () => pick(LETTERS)).join('')).join(' '), []);
  return (
    <span class="unloaded" aria-hidden="true">
      {name}
    </span>
  );
}

/**
 * Temporary: while the logo is being designed the start page shows nothing but the
 * logo and the backdrop. Set to false to bring back the subtitle, slogan and commands.
 */
export const LOGO_ONLY = false;

export function Welcome({
  t,
  onCreate,
  onImport,
  onLedger,
  onKeyFile,
}: {
  t: Dict;
  onCreate: () => void;
  onImport: () => void;
  onLedger: () => void;
  onKeyFile: (file: Picked) => void;
}) {
  // Silent self-check on every start; the actions only appear if it passes.
  const test = useMemo(selfTest, []);
  const healthy = test.rng && test.core;
  const [slogan, setSlogan] = useState(0);
  const quote = t.slogans[slogan % t.slogans.length];
  useEffect(() => {
    const id = setInterval(() => setSlogan((n) => (n + 1) % t.slogans.length), 7000);
    return () => clearInterval(id);
  }, [t]);
  // The whole page is a drop target: dropping a key file anywhere starts the sign-in.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (!file || file.size > MAX_CARRIER_BYTES) return;
      void file.arrayBuffer().then((buf) => onKeyFile({ name: file.name, type: file.type, bytes: new Uint8Array(buf) }));
    };
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
    };
  }, [onKeyFile]);
  return (
    <>
      {dragging && <div class="dropveil">{t.dropKey}</div>}
      {LOGO_ONLY ? (
        <div class="hero">
          <Logo />
        </div>
      ) : (
        // The logo and the quotes are the first slide; swiping on shows what the wallet does.
        <Showcase
          t={t}
          hero={
            <div class="hero">
              <Logo />
              <p class="logo-sub">financial infrastructure</p>
              <blockquote class="quote">
                <p class="tagline">
                  <Scramble text={quote?.text ?? ''} speed={9} />
                </p>
                <footer class="quote-by">
                  {quote?.by.startsWith('{name}') ? (
                    <>
                      <Unloaded />
                      {quote.by.slice('{name}'.length)}
                    </>
                  ) : (
                    quote?.by
                  )}
                </footer>
              </blockquote>
            </div>
          }
        />
      )}
      {LOGO_ONLY ? null : healthy ? (
        <div class="rise">
          <Cta t={t} onCreate={onCreate} onImport={onImport} onLedger={onLedger} />
          <a class="source-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {t.sourceCode} ↗
          </a>
        </div>
      ) : (
        <p class="alert rise" role="alert">
          {t.selfTestFailed}
        </p>
      )}
    </>
  );
}
