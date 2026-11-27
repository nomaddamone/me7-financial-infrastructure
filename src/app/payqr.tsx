import encodeQR from 'qr';
import decodeQR from 'qr/decode.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { bytesToHex } from '@noble/hashes/utils.js';
import { toChecksumAddress } from '../core/evm.ts';
import { addressCode, addressPattern, parsePayText, type PayRequest } from '../core/payqr.ts';
import { greyOf, readSign } from '../core/sign.ts';
import { parseStealthCode } from '../core/stealth.ts';
import { NET } from '../net/endpoints.ts';

/** What a scanned or pasted text asks for: an address or payment link, or a stealth code (which pays USDC on Base). */
function readPayText(text: string): PayRequest | null {
  const request = parsePayText(text, NET.btc.network);
  if (request) return request;
  const stealth = parseStealthCode(text);
  return stealth && NET.base ? { network: 'evm', address: `st:${stealth.chain ?? 'base'}:${stealth.meta}`, asset: 'usdc-base' } : null;
}
import { Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';
import './payqr.css';

const QUIET = 3;

/** "me7" in the code's own squares: each letter five modules tall. */
const MARK = ['#####.###.###', '#.#.#.#.#...#', '#.#.#.###..#.', '#.#.#.#....#.', '#.#.#.###..#.'];

/** Can a reader still make the text out of these modules? Checked with the same decoder the scanner uses. */
function reads(modules: readonly (readonly boolean[])[], text: string): boolean {
  const n = modules.length;
  const scale = 3;
  const side = (n + 8) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules[y]?.[x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const row = ((y + 4) * scale + dy) * side + (x + 4) * scale;
        for (let dx = 0; dx < scale; dx++) data.fill(0, (row + dx) * 4, (row + dx) * 4 + 3);
      }
    }
  }
  try {
    return decodeQR({ width: side, height: side, data }) === text;
  } catch {
    return false;
  }
}

/**
 * me7's own QR code: an ordinary code of black squares on white, with the
 * wallet's name spelt in the middle out of the very same squares.
 *
 * Writing over the middle spoils part of the code, and the code's error
 * correction makes up for it. That is not taken on trust: before the name is
 * put in, the result is read back, and if it does not give the text exactly,
 * the code is shown without the name.
 */
export function BrandQr({ text, reveal }: { text: string; reveal?: string }) {
  const modules = useMemo(() => {
    // The library insists on a margin of at least one module; it is taken off again, and the code draws its own.
    const make = (ecc: 'high' | 'quartile' | 'medium') =>
      encodeQR(text, 'raw', { ecc, border: 1 })
        .slice(1, -1)
        .map((row) => row.slice(1, -1));
    // Each square of a letter is one module of the code. (Twice that size was tried: no code survives it.)
    const unit = 1;
    const wide = (MARK[0] as string).length * unit + 2;
    const tall = MARK.length * unit + 2;
    // The strongest error correction first; a weaker one only if the code would otherwise grow past 41 modules
    // a side, where a guide mark for scanners sits exactly in the middle and must not be written over.
    for (const ecc of ['high', 'quartile', 'medium'] as const) {
      const plain = make(ecc);
      const n = plain.length;
      if (n > 41) continue;
      const left = Math.floor((n - wide) / 2);
      const top = Math.floor((n - tall) / 2);
      const named = plain.map((row, y) =>
        row.map((on, x) => {
          const inside = x >= left && x < left + wide && y >= top && y < top + tall;
          if (!inside) return on;
          const mx = Math.floor((x - left - 1) / unit);
          const my = Math.floor((y - top - 1) / unit);
          const letter = x > left && y > top && x < left + wide - 1 && y < top + tall - 1 && MARK[my]?.[mx] === '#';
          // Dark letters on a clearing.
          return letter;
        }),
      );
      if (reads(named, text)) return named;
    }
    return make('medium');
  }, [text]);
  const n = modules.length;
  let d = '';
  modules.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x} ${y}h1v1h-1z` : '')));
  const side = n + QUIET * 2;

  // The code is drawn in by a short animation whenever `reveal` changes (a new address), not on every keystroke.
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(modules);
  latest.current = modules;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (reveal === undefined || !el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const grid = latest.current;
    const size = Math.round(el.clientWidth * Math.min(2, devicePixelRatio || 1));
    el.width = size;
    el.height = size;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const seeds = Float32Array.from({ length: grid.length * grid.length * 3 }, () => Math.random());
    setPlaying(true);
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / REVEAL_MS);
      drawReveal(ctx, size, grid, p, seeds);
      if (p < 1) frame = requestAnimationFrame(step);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setPlaying(false);
    };
  }, [reveal]);

  return (
    <div class="brand-qr-box">
      <svg class={playing ? 'qr brand-qr brand-qr--wait' : 'qr brand-qr'} viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`} role="img" aria-label="QR">
        <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
      <canvas ref={canvas} class={playing ? 'brand-qr-film' : 'brand-qr-film brand-qr-film--off'} aria-hidden="true" />
    </div>
  );
}

const REVEAL_MS = 1100;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;

/** One frame of the code appearing: particles from all over the square gather into it. `p` runs from 0 to 1; at 1 the picture is exactly the code. */
function drawReveal(ctx: CanvasRenderingContext2D, size: number, grid: boolean[][], p: number, seeds: Float32Array) {
  const n = grid.length;
  const cell = size / (n + QUIET * 2);
  const seed = (x: number, y: number, k: number) => seeds[(y * n + x) * 3 + k] ?? 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y]?.[x] !== true) continue;
      // Each particle sets off at its own moment and slows as it arrives.
      const q = clamp((p - seed(x, y, 0) * 0.38) / 0.6);
      if (q <= 0) continue;
      const e = easeOut(q);
      const fromX = seed(x, y, 1) * size;
      const fromY = seed(x, y, 2) * size;
      const s = cell * (0.35 + 0.65 * e) + 0.5;
      ctx.globalAlpha = Math.min(1, q * 3);
      ctx.fillRect(fromX + ((QUIET + x + 0.5) * cell - fromX) * e - s / 2, fromY + ((QUIET + y + 0.5) * cell - fromY) * e - s / 2, s, s);
    }
  }
  ctx.globalAlpha = 1;
}

/** The address to receive on, with the way to copy it. */
export function AddressLine({ t, address }: { t: Dict; address: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(id);
  }, [done]);
  const copy = () => {
    navigator.clipboard?.writeText(address).then(
      () => setDone(true),
      () => undefined,
    );
  };
  // The beginning and the end are what people compare, so they are the bright part.
  const head = address.slice(0, 6);
  const tail = address.slice(-4);
  const middle = address.slice(6, -4);
  const icon = (
    <svg class="aline-icon" viewBox="0 0 16 16" aria-hidden="true">
      {done ? <path d="M3 8.5l3.2 3.2L13 5" /> : <path d="M5.5 5.5v-3h8v8h-3M2.5 5.5h8v8h-8z" />}
    </svg>
  );
  // The compared ends whole, the middle in fours: ten groups for an EVM address, two even rows.
  const chunks = [head, ...(middle.match(/.{1,4}/g) ?? []), tail];
  return (
    <button type="button" class={done ? 'aline aline--tile is-done' : 'aline aline--tile'} onClick={copy}>
      <code class="aline-chunks">
        {chunks.map((c, i) => (
          <span key={i} class={i === 0 || i === chunks.length - 1 ? 'on' : ''}>
            {c}
          </span>
        ))}
      </code>
      <span class="aline-foot">
        {icon}
        {done ? t.copied : t.copy}
      </span>
    </button>
  );
}

/**
 * The address as eight digits and a small picture. The same pair is shown to
 * whoever receives and to whoever is about to send: if they match when read
 * aloud, the address was not swapped on the way.
 */
export function AddressCode({ t, address, note }: { t: Dict; address: string; note?: boolean }) {
  const pattern = useMemo(() => addressPattern(address), [address]);
  return (
    <div class="acode">
      <svg class="acode-pic" viewBox="0 0 5 5" aria-hidden="true">
        {pattern.map((row, y) => row.map((on, x) => on && <rect key={`${x}.${y}`} x={x} y={y} width="1.02" height="1.02" />))}
      </svg>
      <span class="acode-text">
        <span class="acode-label">{t.pay.code}</span>
        <span class="acode-digits">{addressCode(address)}</span>
      </span>
      {note && <span class="acode-note">{t.pay.codeNote}</span>}
    </div>
  );
}

type Found = { request: PayRequest } | { other: true };

/** Read whatever is in a picture: a payment, something else, or nothing. */
function readFrame(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement, told?: string[]): Found | null {
  const started = performance.now();
  // A frame larger than this only slows the search down; codes are found just as well smaller.
  const scale = Math.min(1, 800 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let text: string;
  try {
    text = decodeQR({ width: image.width, height: image.height, data: image.data });
  } catch {
    // No QR code: it may be me7's own sign. Its lines are fine, so it is looked for in the picture at its full size.
    const full = Math.min(1, 1280 / Math.max(width, height));
    canvas.width = Math.round(width * full);
    canvas.height = Math.round(height * full);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const whole = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const afterQr = performance.now();
    const sign = readSign(greyOf(whole.data, whole.width, whole.height, 1280), told);
    told?.push(`frame ${width}x${height}: no QR in ${Math.round(afterQr - started)} ms, sign looked for in ${Math.round(performance.now() - afterQr)} ms`);
    if (!sign) return null;
    return { request: { network: 'evm', address: toChecksumAddress(bytesToHex(sign.address)), ...(sign.kind === 'usdc-base' ? { asset: 'usdc-base' } : {}) } };
  }
  const request = readPayText(text);
  return request ? { request } : { other: true };
}

const DUST = 170;

/**
 * The scanner: the camera's picture with a frame in the middle, and the page's
 * particles drifting over it. When a code is found they rush into the frame.
 * Without a camera, a picture of a code can be chosen or pasted.
 *
 * It only reads. What it finds goes into the send form, to be checked and
 * confirmed like anything typed by hand; a web link in a code is never opened.
 */
export function Scanner({ t, onResult, onClose }: { t: Dict; onResult: (request: PayRequest) => void; onClose: () => void }) {
  const p = t.pay;
  const video = useRef<HTMLVideoElement>(null);
  const dust = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const caught = useRef(false);
  // me7.network/#debug: the scanner reads on without closing and writes out what it saw in each picture, to be copied
  // and sent when a sign is not read on some device. Nothing is sent anywhere by itself.
  const debug = useRef(location.hash === '#debug').current;
  const fresh = () => ({ frames: 0, read: 0, failed: 0, none: 0, about: '', lastRead: '', lastFailed: [] as string[], nearest: '', nearestVote: 0 });
  const seen = useRef(fresh());
  const [report, setReport] = useState('');
  const [state, setState] = useState<'starting' | 'scanning' | 'no-camera'>('starting');
  const [hint, setHint] = useState('');

  const take = (found: Found | null) => {
    if (!found) return false;
    if ('other' in found) {
      setHint(p.notAddress);
      return false;
    }
    if (caught.current) return true;
    caught.current = true;
    navigator.vibrate?.(40);
    // A moment for the particles to gather before the form takes over.
    setTimeout(() => onResult(found.request), 420);
    return true;
  };

  // The camera, and a look at its picture five times a second.
  useEffect(() => {
    work.current = document.createElement('canvas');
    let stream: MediaStream | null = null;
    let timer = 0;
    let gone = false;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setState('no-camera');
      return;
    }
    // A sharp picture is asked for: the default of many phones is too coarse for a code held at arm's length.
    media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(
      (s) => {
        if (gone) return s.getTracks().forEach((track) => track.stop());
        stream = s;
        const el = video.current;
        if (!el) return;
        el.srcObject = s;
        void el.play().catch(() => undefined);
        setState('scanning');
        timer = window.setInterval(() => {
          if (caught.current || !work.current || el.videoWidth === 0) return;
          if (!debug) return void take(readFrame(el, el.videoWidth, el.videoHeight, work.current));
          const told: string[] = [];
          const found = readFrame(el, el.videoWidth, el.videoHeight, work.current, told);
          const log = seen.current;
          log.frames++;
          if (!log.about) {
            const set = s.getVideoTracks()[0]?.getSettings() ?? {};
            log.about = `camera ${String(set.width)}x${String(set.height)} at ${String(set.frameRate)} · video ${el.videoWidth}x${el.videoHeight} · ${navigator.userAgent}`;
          }
          // The pictures worth sending are not the last ones (the phone is turned away to press the button) but one
          // of each kind: a sign read, a sign found and read wrong, and the nearest the search came to finding one.
          const text = `#${log.frames}\n${told.join('\n') || '(a QR code was read)'}`;
          if (found && 'request' in found) {
            log.read++;
            log.lastRead = text;
          } else if (told.some((line) => line.includes(' oval: '))) {
            log.failed++;
            log.lastFailed = [...log.lastFailed, text].slice(-3);
          } else {
            log.none++;
            const vote = Math.max(0, ...told.map((line) => Number(/vote (\d+)\//.exec(line)?.[1] ?? 0)));
            if (vote >= log.nearestVote) (log.nearestVote = vote), (log.nearest = text);
          }
          setReport(
            [
              `me7 scan debug · pictures ${log.frames} · read ${log.read} · found but check sum failed ${log.failed} · no sign found ${log.none}`,
              log.about,
              `== found but check sum failed, the last ${log.lastFailed.length} ==\n${log.lastFailed.join('\n\n') || '(none)'}`,
              `== no sign found: the nearest miss, vote ${log.nearestVote}/72 ==\n${log.nearest || '(none)'}`,
              `== the last one read ==\n${log.lastRead || '(none)'}`,
            ].join('\n\n'),
          );
        }, 200);
      },
      () => !gone && setState('no-camera'),
    );
    return () => {
      gone = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // A picture of a code, chosen or pasted.
  const fromBlob = async (blob: Blob) => {
    try {
      const bitmap = await createImageBitmap(blob);
      const found = work.current ? readFrame(bitmap, bitmap.width, bitmap.height, work.current) : null;
      bitmap.close();
      if (!take(found) && !(found && 'other' in found)) setHint(p.nothing);
    } catch {
      setHint(p.nothing);
    }
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (image) return void fromBlob(image);
      const text = e.clipboardData?.getData('text');
      if (text) {
        const request = readPayText(text);
        take(request ? { request } : { other: true });
      }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, []);

  // The particles: large, grey, and always outside the square where the code is held, so they never get
  // between the camera and the code. The picture around the square is dimmed, which leaves the square
  // itself the brightest thing on the screen. Once a code is caught the particles close in on the
  // square's edge.
  useEffect(() => {
    const canvas = dust.current;
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
    const dots = Array.from({ length: DUST }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
      at: i / DUST,
      seed: Math.random(),
      size: 2.6 + Math.random() * 2.6,
    }));
    let frame = 0;
    let time = 0;
    const step = () => {
      time += 0.012;
      const cx = w / 2;
      const cy = h / 2;
      const half = Math.min(w, h) * 0.31;
      const keep = half + 10;
      ctx.clearRect(0, 0, w, h);
      // Everything but the square is dimmed.
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, w, cy - half);
      ctx.fillRect(0, cy + half, w, h - cy - half);
      ctx.fillRect(0, cy - half, cx - half, half * 2);
      ctx.fillRect(cx + half, cy - half, w - cx - half, half * 2);
      ctx.fillStyle = '#9a9a9a';
      for (const d of dots) {
        if (caught.current) {
          // Caught: every particle makes for its place on the square's edge.
          const a = d.at * Math.PI * 2;
          const k = (half + 3) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          d.vx = (d.vx + (cx + Math.cos(a) * k - d.x) * 0.18) * 0.7;
          d.vy = (d.vy + (cy + Math.sin(a) * k - d.y) * 0.18) * 0.7;
        } else {
          // Current: they drift on a slow stream, like the page's backdrop, and flow round the square.
          const a = Math.sin(d.x * 0.011 + time * 0.8) + Math.cos(d.y * 0.013 - time * 0.6) + d.seed;
          d.vx = (d.vx + Math.cos(a) * 0.09) * 0.97;
          d.vy = (d.vy + Math.sin(a) * 0.09) * 0.97;
        }
        if (!still) {
          d.x += d.vx;
          d.y += d.vy;
        }
        if (!caught.current) {
          // Off one side, on at the other.
          if (d.x < -6) d.x = w + 6;
          if (d.x > w + 6) d.x = -6;
          if (d.y < -6) d.y = h + 6;
          if (d.y > h + 6) d.y = -6;
          // The square is theirs to go round, never through: one that strays in is put out at the nearest side.
          const dx = d.x - cx;
          const dy = d.y - cy;
          if (Math.abs(dx) < keep && Math.abs(dy) < keep) {
            if (keep - Math.abs(dx) < keep - Math.abs(dy)) {
              d.x = cx + Math.sign(dx || 1) * keep;
              d.vx = Math.abs(d.vx) * Math.sign(dx || 1);
            } else {
              d.y = cy + Math.sign(dy || 1) * keep;
              d.vy = Math.abs(d.vy) * Math.sign(dy || 1);
            }
          }
        }
        ctx.globalAlpha = caught.current ? 0.95 : 0.3 + d.seed * 0.5;
        ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', size);
    };
  }, []);

  return (
    <section class="panel scanner">
      <h2 class="title">{p.scanTitle}</h2>
      <div class="scanner-view">
        <video ref={video} class="scanner-video" playsInline muted />
        <canvas ref={dust} class="scanner-dust" aria-hidden="true" />
        <div class="scanner-frame" aria-hidden="true" />
        {state === 'starting' && (
          <p class="scanner-wait">
            <Spinner />
          </p>
        )}
        {state === 'no-camera' && <p class="scanner-wait">{p.noCamera}</p>}
      </div>
      <p class={hint ? 'alert' : 'note'}>{hint || p.scanNote}</p>
      {debug && (
        <>
          <div class="row">
            <button type="button" class="btn" onClick={() => void navigator.clipboard?.writeText(report).catch(() => undefined)}>
              copy the debug log
            </button>
            <button type="button" class="btn" onClick={() => ((seen.current = fresh()), setReport(''))}>
              start over
            </button>
          </div>
          <pre class="scan-debug">{report}</pre>
        </>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={onClose}>
          {t.back}
        </button>
        <label class="btn scanner-file">
          {p.fromPicture}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void fromBlob(file);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>
    </section>
  );
}
