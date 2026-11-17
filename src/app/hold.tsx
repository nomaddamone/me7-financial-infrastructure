import { useEffect, useRef, useState } from 'preact/hooks';
import type { Dict } from './i18n.ts';
import { Film, paint, type Draw } from './showcase.tsx';
import './hold.css';

/**
 * The pause before a payment leaves: ten seconds in which it can still be called off.
 * Nothing is signed and nothing leaves the browser until the count runs out, so calling
 * it off costs nothing and leaves no trace. Once it is sent it cannot be taken back.
 *
 * While it lasts a film plays, made as the films on the start page are: particles drift,
 * gather into the name me7, and at the end fold into a tick. The count sits in the cancel button.
 */
export const HOLD_SECONDS = 10;

const FRAMES: readonly Draw[] = [() => undefined, (c) => paint.text(c, 'me7', 120, 100, 78), (c) => paint.tick(c, 120, 76, 3.2)];
/** When each picture is called for, in milliseconds from the start. */
const FRAME_AT: readonly number[] = [0, 900, 7300];

export function Hold({ t, lines, onDone, onCancel }: { t: Dict; lines: readonly string[]; onDone: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(HOLD_SECONDS);
  // Whichever comes first, the end of the count or a press of a button, happens once.
  const settled = useRef(false);
  const finish = (how: () => void) => {
    if (settled.current) return;
    settled.current = true;
    how();
  };
  useEffect(() => {
    // The count is kept by the clock, not by drawn frames: a hidden tab stops drawing but not counting.
    const started = performance.now();
    const total = HOLD_SECONDS * 1000;
    const done = setTimeout(() => finish(onDone), total);
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((total - (performance.now() - started)) / 1000))), 100);
    return () => {
      clearTimeout(done);
      clearInterval(tick);
    };
  }, []);

  return (
    <section class="panel hold" role="timer" aria-live="off">
      <Film frames={FRAMES} at={FRAME_AT} className="hold-film" />
      {lines.map((line) => (
        <p class="hold-line" key={line}>
          {line}
        </p>
      ))}
      <button type="button" class="btn btn--accent hold-cancel" onClick={() => finish(onCancel)}>
        <span class="hold-drain" aria-hidden="true" />
        <span class="hold-label">{t.hold.cancel}</span>
        <span class="hold-count">{left}</span>
      </button>
      <button type="button" class="linklike" onClick={() => finish(onDone)}>
        {t.hold.now}
      </button>
      <p class="dim">{t.hold.note}</p>
    </section>
  );
}

/** The same film without the count: for a screen that says something has left, where the tick is the news. */
const SENT_AT: readonly number[] = [0, 500, 2600];
export function SentFilm() {
  return <Film frames={FRAMES} at={SENT_AT} className="hold-film" />;
}

/** And without the tick: for a screen that says something is still on its way. The name gathers and stays. */
export function WorkingFilm() {
  return <Film frames={FRAMES.slice(0, 2)} at={SENT_AT.slice(0, 2)} className="hold-film" />;
}
