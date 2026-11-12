import { useEffect, useRef, useState } from 'preact/hooks';

/** Visual effects only. Math.random is fine here: nothing in this file is secret. */

const GLYPHS = '0123456789abcdef#$%&*+=<>/\\';
const glyph = () => GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Text that "decrypts" into place, left to right. */
export function Scramble({ text, delay = 0, speed = 22 }: { text: string; delay?: number; speed?: number }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (reducedMotion()) {
      setOut(text);
      return;
    }
    let raf = 0;
    let start: number | undefined;
    const noise = (from: number) => {
      let s = '';
      for (let i = from; i < text.length; i++) s += text.charAt(i) === ' ' ? ' ' : glyph();
      return s;
    };
    setOut(noise(0));
    const tick = (ts: number) => {
      start ??= ts;
      const elapsed = ts - start - delay;
      const shown = elapsed < 0 ? 0 : Math.min(text.length, Math.floor(elapsed / speed));
      setOut(text.slice(0, shown) + noise(shown));
      if (shown < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, speed]);
  return (
    <span class="scramble" aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % SPIN.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <span class="spinner" aria-hidden="true">
      {SPIN[i]}
    </span>
  );
}

/** Smooth scalar field in roughly [-1, 1] that drifts over time. */
function field(x: number, y: number, time: number): number {
  const X = x * 0.0042;
  const Y = y * 0.0042;
  return (
    (Math.sin(X * 1.3 + time * 0.6) +
      Math.sin(Y * 1.7 - time * 0.45) +
      Math.sin((X + Y) * 0.9 + time * 0.3) +
      Math.sin(Math.hypot(X - 2.2, Y - 1.4) * 1.6 - time * 0.7)) /
    4
  );
}

/**
 * Full-screen animated backdrop drawn in code (no video, no images, no network):
 * particles drift along a slowly changing field and leave fading trails.
 */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = reducedMotion();
    const css = getComputedStyle(document.documentElement);
    const base = css.getPropertyValue('--glyph').trim() || '#999';
    const accent = css.getPropertyValue('--accent').trim() || '#fff';
    let w = 0;
    let h = 0;
    let time = Math.random() * 100;
    let raf = 0;
    let last = 0;
    let dots = new Float32Array(0);

    const draw = () => {
      // Fade what is already there, then extend every trail by one short segment.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1.1;
      // Two passes so every seventh particle can be stroked in the accent colour.
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < dots.length / 2; i++) {
          if ((i % 7 === 0) !== (pass === 1)) continue;
          const x = dots[i * 2] ?? 0;
          const y = dots[i * 2 + 1] ?? 0;
          const angle = field(x, y, time) * Math.PI * 2.2;
          const nx = x + Math.cos(angle) * 1.8;
          const ny = y + Math.sin(angle) * 1.8;
          ctx.moveTo(x, y);
          ctx.lineTo(nx, ny);
          const lost = nx < 0 || ny < 0 || nx > w || ny > h || Math.random() < 0.004;
          dots[i * 2] = lost ? Math.random() * w : nx;
          dots[i * 2 + 1] = lost ? Math.random() * h : ny;
        }
        ctx.strokeStyle = pass === 1 ? accent : base;
        ctx.globalAlpha = pass === 1 ? 0.75 : 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth;
      h = innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(1400, Math.floor((w * h) / 900));
      dots = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        dots[i * 2] = Math.random() * w;
        dots[i * 2 + 1] = Math.random() * h;
      }
      // Pre-roll so the first visible frame already has trails.
      for (let i = 0; i < (still ? 90 : 30); i++) draw();
    };
    const step = (ts: number) => {
      raf = requestAnimationFrame(step);
      const dt = ts - last;
      if (dt < 32) return;
      last = ts;
      time += Math.min(dt, 100) * 0.00045;
      draw();
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!still && !document.hidden) raf = requestAnimationFrame(step);
    };

    resize();
    onVisibility();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return <canvas class="backdrop" aria-hidden="true" ref={ref} />;
}
