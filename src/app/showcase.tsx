import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Dict } from './i18n.ts';
import './showcase.css';

/**
 * The start page's showcase: a carousel in the place of the logo. Its first
 * slide is the logo and the quotes; every other slide is a small "film" made
 * of particles that shows a mechanism the way it happens on the chain. On a
 * swipe the particles let go of one picture and gather into the next.
 */
type C = CanvasRenderingContext2D;
export type Draw = (c: C) => void;

const W = 240;
const H = 150;
const dot = (c: C, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
};
const ring = (c: C, x: number, y: number, r: number, width = 5) => {
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
};
const box = (c: C, x: number, y: number, w: number, h: number, width = 5) => {
  c.lineWidth = width;
  c.strokeRect(x, y, w, h);
};
const line = (c: C, points: number[], width = 5) => {
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
  c.stroke();
};
const arrow = (c: C, x1: number, y: number, x2: number) => {
  const d = x2 > x1 ? -9 : 9;
  line(c, [x1, y, x2, y]);
  line(c, [x2 + d, y - 8, x2, y, x2 + d, y + 8]);
};
const text = (c: C, s: string, x: number, y: number, size: number) => {
  c.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
  c.textAlign = 'center';
  c.fillText(s, x, y);
};
const tick = (c: C, x: number, y: number, s = 1) => line(c, [x - 13 * s, y, x - 3 * s, y + 10 * s, x + 15 * s, y - 12 * s], 7);
const shield = (c: C, x: number, y: number) => {
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(x, y - 52);
  c.lineTo(x + 44, y - 36);
  c.lineTo(x + 44, y);
  c.quadraticCurveTo(x + 44, y + 36, x, y + 54);
  c.quadraticCurveTo(x - 44, y + 36, x - 44, y);
  c.lineTo(x - 44, y - 36);
  c.closePath();
  c.stroke();
};
const key = (c: C, x: number, y: number) => {
  ring(c, x - 22, y, 13, 6);
  line(c, [x - 9, y, x + 34, y, x + 34, y + 12], 6);
  line(c, [x + 18, y, x + 18, y + 14], 6);
};
const lock = (c: C, open: boolean) => {
  c.lineWidth = 6;
  c.strokeRect(88, 70, 64, 52);
  c.beginPath();
  c.arc(open ? 96 : 120, 70, 22, Math.PI, 0);
  c.stroke();
  dot(c, 120, 96, 6);
};
const person = (c: C, x: number, y: number) => {
  dot(c, x, y - 14, 11);
  c.beginPath();
  c.arc(x, y + 28, 22, Math.PI, 0);
  c.fill();
};
/** Dots scattered inside a rectangle, the same every time: what encrypted data looks like. */
const noise = (c: C, x: number, y: number, w: number, h: number) => {
  let seed = 7;
  for (let i = 0; i < 150; i++) {
    seed = (seed * 16807) % 2147483647;
    const px = x + (seed % 1000) / 1000 * w;
    seed = (seed * 16807) % 2147483647;
    c.fillRect(px, y + (seed % 1000) / 1000 * h, 3, 3);
  }
};

/**
 * The films: for each mechanism, a few pictures drawn in white on a 240x150
 * field. The particles move from one picture to the next, and that movement is the film.
 */
const FILMS: Record<string, readonly Draw[]> = {
  // The relay pays the gas: a coin with no ETH beside it goes through the relay and arrives.
  gasless: [
    (c) => (dot(c, 40, 66, 22), text(c, '0 ETH', 40, 122, 17), box(c, 98, 44, 44, 44), ring(c, 202, 66, 20)),
    (c) => (ring(c, 40, 66, 20), box(c, 98, 44, 44, 44), dot(c, 120, 66, 14), text(c, 'gas', 120, 122, 17), ring(c, 202, 66, 20)),
    (c) => (ring(c, 40, 66, 20), box(c, 98, 44, 44, 44), dot(c, 202, 66, 22), tick(c, 202, 118)),
  ],
  // A new address each time a payment arrives.
  rotate: [0, 1, 2].map((active) => (c: C) => {
    [0, 1, 2].forEach((i) => {
      const x = 32 + i * 68;
      box(c, x, 62, 40, 40);
      if (i < active) dot(c, x + 20, 82, 8);
      if (i === active) (c.fillRect(x, 62, 40, 40), dot(c, x + 20, 30, 10), line(c, [x + 20, 42, x + 20, 56]));
      text(c, `#${i + 1}`, x + 20, 128, 15);
    });
  }),
  // Address selection: of several addresses, only as many as the payment needs are taken.
  select: [
    (c) => (dot(c, 34, 26, 15), dot(c, 34, 62, 11), dot(c, 34, 94, 8), dot(c, 34, 124, 13), ring(c, 206, 75, 20)),
    (c) => (dot(c, 96, 44, 15), ring(c, 34, 62, 10), ring(c, 34, 94, 7), dot(c, 96, 106, 13), ring(c, 206, 75, 20)),
    (c) => (ring(c, 34, 62, 10), ring(c, 34, 94, 7), dot(c, 206, 75, 24), tick(c, 120, 75)),
  ],
  // A transit address: money from several addresses meets on a fresh one and leaves from there.
  transit: [
    (c) => (dot(c, 30, 30, 12), dot(c, 30, 75, 12), dot(c, 30, 120, 12), ring(c, 120, 75, 18), ring(c, 208, 75, 20)),
    (c) => (ring(c, 30, 30, 11), ring(c, 30, 75, 11), ring(c, 30, 120, 11), dot(c, 120, 75, 24), ring(c, 208, 75, 20)),
    (c) => (ring(c, 30, 30, 11), ring(c, 30, 75, 11), ring(c, 30, 120, 11), ring(c, 120, 75, 18), dot(c, 208, 75, 24)),
  ],
  // The key hidden inside an ordinary file.
  key: [
    (c) => (box(c, 50, 20, 140, 110), line(c, [62, 112, 96, 66, 118, 94, 140, 58, 178, 112]), dot(c, 160, 44, 9)),
    (c) => (box(c, 50, 20, 140, 110), key(c, 116, 74)),
  ],
  // The vault: one password turns into a wallet with money in it, another into a different, empty one.
  vault: [
    (c) => (text(c, '••••', 56, 86, 34), arrow(c, 106, 75, 150), dot(c, 198, 75, 28)),
    (c) => (text(c, '•••×', 56, 86, 34), arrow(c, 106, 75, 150), ring(c, 198, 75, 26)),
    (c) => lock(c, false),
  ],
  // Cold signing: the transfer is read on the device's own screen and signed there.
  ledger: [
    (c) => (box(c, 62, 22, 116, 106), box(c, 76, 36, 88, 50, 3), text(c, '0.5 ETH', 120, 68, 17)),
    (c) => (box(c, 62, 22, 116, 106), box(c, 76, 36, 88, 50, 3), text(c, '0x71c4…', 120, 68, 17), dot(c, 120, 108, 8)),
    (c) => (box(c, 62, 22, 116, 106), tick(c, 120, 74, 2)),
  ],
  // Cashing out to a person: coins one way, money the other.
  p2p: [
    (c) => (dot(c, 44, 62, 22), text(c, 'USDC', 44, 118, 16), person(c, 196, 70)),
    (c) => (ring(c, 44, 62, 20), arrow(c, 82, 56, 158), arrow(c, 158, 92, 82), person(c, 196, 70)),
    (c) => (text(c, '€', 44, 92, 72), dot(c, 196, 62, 22), text(c, 'USDC', 196, 118, 16)),
  ],
  // Contacts are encrypted before they leave: the server keeps noise.
  contacts: [
    (c) => (line(c, [22, 44, 92, 44]), line(c, [22, 75, 78, 75]), line(c, [22, 106, 92, 106]), box(c, 150, 30, 70, 90)),
    (c) => (noise(c, 22, 34, 78, 82), arrow(c, 110, 75, 140), box(c, 150, 30, 70, 90)),
    (c) => (noise(c, 156, 36, 58, 78), box(c, 150, 30, 70, 90), key(c, 62, 75)),
  ],
  // Every address is checked before anything is sent.
  screen: [
    (c) => (text(c, '0x71c4…9f3a', 120, 52, 21), ring(c, 112, 96, 18), line(c, [125, 110, 144, 130], 7)),
    (c) => (shield(c, 120, 76), tick(c, 120, 76, 1.5)),
  ],
  // One operation, several recipients.
  batch: [
    (c) => (dot(c, 40, 75, 26), [24, 58, 92, 126].forEach((y) => ring(c, 204, y, 11))),
    (c) => (dot(c, 40, 75, 12), [24, 58, 92, 126].forEach((y) => (line(c, [58, 75, 186, y], 4), ring(c, 204, y, 11)))),
    (c) => (ring(c, 40, 75, 22), [24, 58, 92, 126].forEach((y) => dot(c, 204, y, 13)), tick(c, 120, 75)),
  ],
};

const cache = new Map<Draw, [number, number][]>();
/** The lit points of a picture, in a random order, as fractions of the field. */
function pointsOf(draw: Draw): [number, number][] {
  const known = cache.get(draw);
  if (known) return known;
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const c = off.getContext('2d');
  const points: [number, number][] = [];
  if (c) {
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    draw(c);
    const data = c.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if ((data[(y * W + x) * 4 + 3] ?? 0) > 120) points.push([x / W, y / H]);
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j] as [number, number], points[i] as [number, number]];
    }
  }
  cache.set(draw, points);
  return points;
}

const COUNT = 1500;
const FRAME_MS = 1700;

/** The brushes the films are painted with, for other screens that play a film of their own. */
export const paint = { dot, ring, line, text, tick };

/**
 * A film: particles that gather into each picture in turn. Left to itself it plays its pictures
 * over and over; given `at` (a moment in milliseconds for each picture) it plays them once, on time.
 */
export function Film({ frames, at, className = 'sc-film' }: { frames: readonly Draw[]; at?: readonly number[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aim = useRef<((draw: Draw, burst: boolean) => void) | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const size = () => {
      const ratio = Math.min(2, devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    size();
    // x, y, vx, vy, tx, ty for each particle; they start scattered, like the backdrop they come from.
    const p = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      p[i * 6] = Math.random() * w;
      p[i * 6 + 1] = Math.random() * h;
    }
    aim.current = (draw, burst) => {
      const points = pointsOf(draw);
      const scale = Math.min(w / W, h / H) * 0.96;
      const left = (w - W * scale) / 2;
      const top = (h - H * scale) / 2;
      for (let i = 0; i < COUNT; i++) {
        const point = points[i % Math.max(1, points.length)];
        // Every particle has a place in the picture; a few are left to drift around it.
        const free = i % 11 === 0 || !point;
        p[i * 6 + 4] = free ? Math.random() * w : left + point[0] * W * scale;
        p[i * 6 + 5] = free ? Math.random() * h : top + point[1] * H * scale;
        if (burst) {
          // On a change of film the old picture falls apart before the new one gathers.
          p[i * 6 + 2] = (p[i * 6 + 2] ?? 0) + (Math.random() - 0.5) * 30;
          p[i * 6 + 3] = (p[i * 6 + 3] ?? 0) + (Math.random() - 0.5) * 30;
        }
      }
    };
    let frame = 0;
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4f4';
      for (let i = 0; i < COUNT; i++) {
        const o = i * 6;
        const x = p[o] ?? 0;
        const y = p[o + 1] ?? 0;
        const vx = ((p[o + 2] ?? 0) + ((p[o + 4] ?? 0) - x) * 0.05) * 0.83;
        const vy = ((p[o + 3] ?? 0) + ((p[o + 5] ?? 0) - y) * 0.05) * 0.83;
        p[o + 2] = vx;
        p[o + 3] = vy;
        p[o] = still ? (p[o + 4] ?? 0) : x + vx + (Math.random() - 0.5) * 0.3;
        p[o + 1] = still ? (p[o + 5] ?? 0) : y + vy + (Math.random() - 0.5) * 0.3;
        ctx.globalAlpha = 0.4 + (i % 7) * 0.085;
        ctx.fillRect(p[o] ?? 0, p[o + 1] ?? 0, 1.5, 1.5);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', size);
      aim.current = null;
    };
  }, []);

  // The film itself: its pictures in turn, over and over.
  useEffect(() => {
    const first = frames[0];
    if (first) aim.current?.(first, true);
    if (at) {
      const timers = frames.map((frame, i) => (i === 0 ? 0 : setTimeout(() => aim.current?.(frame, false), at[i] ?? 0)));
      return () => timers.forEach((id) => clearTimeout(id));
    }
    let now = 0;
    const id = setInterval(() => {
      now = (now + 1) % frames.length;
      const next = frames[now];
      if (next) aim.current?.(next, false);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [frames]);

  return <canvas ref={ref} class={className} aria-hidden="true" />;
}

export function Showcase({ t, hero }: { t: Dict; hero: ComponentChildren }) {
  const s = t.showcase;
  const items = s.items.filter((item) => FILMS[item.id]);
  const count = 1 + items.length;
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const go = (i: number) => {
    setHeld(true);
    setAt(((i % count) + count) % count);
  };
  // Plays by itself until the visitor takes over; the first slide stays a little longer.
  useEffect(() => {
    if (held) return;
    const id = setTimeout(() => setAt((n) => (n + 1) % count), at === 0 ? 9000 : FRAME_MS * 4);
    return () => clearTimeout(id);
  }, [held, at, count]);
  const drag = useRef<number | null>(null);
  // The marker is placed through the element itself: the page's rules allow no inline styles.
  const thumb = useRef<HTMLElement>(null);
  useEffect(() => {
    thumb.current?.style.setProperty('--at', String(at));
    thumb.current?.style.setProperty('--count', String(count));
  }, [at, count]);
  const [sliding, setSliding] = useState(false);
  /** Go to the slide under the pointer: the line is divided evenly between the slides. */
  const slideTo = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    const box = e.currentTarget.getBoundingClientRect();
    const share = Math.min(0.999, Math.max(0, (e.clientX - box.left) / box.width));
    go(Math.floor(share * count));
  };
  const item = at >= 1 ? items[at - 1] : undefined;
  const film = item ? FILMS[item.id] : undefined;

  return (
    <section
      class="sc"
      aria-roledescription="carousel"
      tabIndex={0}
      // Any touch means the visitor is reading: the slides stop moving on by themselves.
      onClick={() => setHeld(true)}
      onPointerDown={(e) => {
        drag.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const from = drag.current;
        drag.current = null;
        if (from === null) return;
        const moved = e.clientX - from;
        // A swipe to the left brings the next slide, to the right the previous one.
        if (Math.abs(moved) > 40) go(at + (moved < 0 ? 1 : -1));
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(at + 1);
        if (e.key === 'ArrowLeft') go(at - 1);
      }}
    >
      <div class="sc-stage">
        {item && film ? (
          <div class="sc-slide">
            <Film frames={film} />
            <div class="sc-caption" key={item.id}>
              <p class="sc-name">{item.name}</p>
              <p class="sc-text">{item.text}</p>
              {/* How the same thing usually works elsewhere: the comparison, without naming anyone. */}
              <p class="sc-usual">
                <span>{s.usual}</span> {item.usual}
              </p>
            </div>
          </div>
        ) : (
          <div class="sc-hero">{hero}</div>
        )}
      </div>
      {/* The slider: a thin line with a marker. It shows which slide is on, and can be dragged or tapped to go to another. */}
      <div
        class={sliding ? 'sc-slider sc-slider--held' : 'sc-slider'}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={at + 1}
        onPointerDown={(e) => {
          // The slider has the gesture to itself: it must not also count as a swipe over the slide.
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setSliding(true);
          slideTo(e);
        }}
        onPointerMove={(e) => {
          if (sliding) slideTo(e);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          setSliding(false);
        }}
        onPointerCancel={() => setSliding(false)}
      >
        <span class="sc-track">
          <i ref={thumb} />
        </span>
      </div>
    </section>
  );
}
