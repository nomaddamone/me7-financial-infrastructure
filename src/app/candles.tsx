import { useEffect, useRef } from 'preact/hooks';
import { movingAverage, type Candle } from '../net/market.ts';

/**
 * The trading chart: candles (or a line), volume bars, moving averages, a
 * price scale, a line at the last price and a crosshair that reads out the
 * candle under it. Drawn on a canvas by hand, in the app's own two tones:
 * a candle that closed higher is hollow, one that closed lower is filled.
 *
 * Wheel zooms, dragging moves through history, moving the pointer reads a candle.
 */
export interface ChartOptions {
  kind: 'candles' | 'line';
  volume: boolean;
  ma7: boolean;
  ma25: boolean;
}

const AXIS_W = 62;
const AXIS_H = 20;
const TOP = 26;
const MIN_VISIBLE = 20;
const MAX_VISIBLE = 300;

/** A price with as many digits as its size needs. */
export function priceText(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(value >= 100 ? 2 : 4);
  return value.toPrecision(4);
}

function timeText(time: number, span: number): string {
  const d = new Date(time * 1000);
  // Candles of a day or longer are labelled by date, shorter ones by the clock.
  return span >= 86_400
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Round steps for the price grid: 1, 2 or 5 times a power of ten. */
function niceStep(range: number, lines: number): number {
  const raw = range / lines;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

export function CandleChart({ candles, options }: { candles: readonly Candle[]; options: ChartOptions }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // What part of history is on screen, and where the pointer is. Kept outside React state: it changes on every pointer move.
  const view = useRef({ visible: 90, offset: 0, cross: null as { x: number; y: number } | null, drag: null as { x: number; offset: number } | null });
  const data = useRef({ candles, options });
  data.current = { candles, options };
  const draw = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = canvas.current;
    const host = box.current;
    if (!el || !host) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(host);
    const tone = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const FG = tone('--fg', '#f4f4f4');
    const DIM = tone('--dim', '#8c8c8c');
    const LINE = tone('--line', '#2d2d2d');
    const PANEL = tone('--panel', '#171717');
    const FONT = `11px ${tone('--mono', 'ui-monospace, monospace')}`;

    draw.current = () => {
      const { candles: all, options: opt } = data.current;
      const ratio = window.devicePixelRatio || 1;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
        el.width = Math.round(width * ratio);
        el.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      if (all.length < 2) return;

      const v = view.current;
      v.visible = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.min(v.visible, all.length)));
      v.offset = Math.max(0, Math.min(all.length - v.visible, v.offset));
      const end = all.length - v.offset;
      const start = end - v.visible;
      const shown = all.slice(start, end);
      const plotW = width - AXIS_W;
      const plotH = height - AXIS_H - TOP;
      const volH = opt.volume ? Math.round(plotH * 0.18) : 0;
      const priceH = plotH - volH - (opt.volume ? 6 : 0);
      const step = plotW / v.visible;
      const body = Math.max(1, Math.min(14, Math.floor(step * 0.7)));
      const xOf = (i: number) => (i + 0.5) * step;

      const ma7 = opt.ma7 ? movingAverage(all, 7).slice(start, end) : null;
      const ma25 = opt.ma25 ? movingAverage(all, 25).slice(start, end) : null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of shown) {
        lo = Math.min(lo, c.low);
        hi = Math.max(hi, c.high);
      }
      const pad = (hi - lo || hi * 0.01) * 0.08;
      lo -= pad;
      hi += pad;
      const yOf = (price: number) => TOP + ((hi - price) / (hi - lo)) * priceH;

      // Price grid and scale.
      const grid = niceStep(hi - lo, 5);
      ctx.strokeStyle = LINE;
      ctx.fillStyle = DIM;
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (let p = Math.ceil(lo / grid) * grid; p < hi; p += grid) {
        const y = Math.round(yOf(p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.fillText(priceText(p), plotW + 6, y);
      }
      // Time scale.
      const span = (shown[1]?.time ?? 0) - (shown[0]?.time ?? 0);
      const every = Math.max(1, Math.round(70 / step));
      ctx.textAlign = 'center';
      for (let i = shown.length - 1; i >= 0; i -= every) {
        const x = Math.round(xOf(i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, TOP);
        ctx.lineTo(x, TOP + plotH);
        ctx.stroke();
        ctx.fillText(timeText((shown[i] as Candle).time, span), Math.min(Math.max(x, 26), plotW - 26), height - AXIS_H / 2);
      }

      // Volume.
      if (opt.volume) {
        const top = Math.max(...shown.map((c) => c.volume)) || 1;
        shown.forEach((c, i) => {
          const h = Math.max(1, (c.volume / top) * volH);
          ctx.fillStyle = c.close >= c.open ? LINE : DIM;
          ctx.globalAlpha = c.close >= c.open ? 1 : 0.45;
          ctx.fillRect(Math.round(xOf(i) - body / 2), TOP + plotH - h, body, h);
        });
        ctx.globalAlpha = 1;
      }

      // Price: candles or a line.
      if (opt.kind === 'line') {
        ctx.strokeStyle = FG;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        shown.forEach((c, i) => (i === 0 ? ctx.moveTo(xOf(i), yOf(c.close)) : ctx.lineTo(xOf(i), yOf(c.close))));
        ctx.stroke();
        ctx.lineTo(xOf(shown.length - 1), TOP + priceH);
        ctx.lineTo(xOf(0), TOP + priceH);
        ctx.closePath();
        ctx.fillStyle = FG;
        ctx.globalAlpha = 0.06;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 1;
        shown.forEach((c, i) => {
          const x = Math.round(xOf(i));
          const up = c.close >= c.open;
          const top = yOf(Math.max(c.open, c.close));
          const bottom = yOf(Math.min(c.open, c.close));
          const h = Math.max(1, bottom - top);
          ctx.strokeStyle = up ? FG : DIM;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, yOf(c.high));
          ctx.lineTo(x + 0.5, yOf(c.low));
          ctx.stroke();
          if (up) {
            // Hollow: the wick must not show through the body.
            ctx.fillStyle = PANEL;
            ctx.fillRect(x - body / 2, top, body, h);
            if (body > 2) ctx.strokeRect(Math.round(x - body / 2) + 0.5, Math.round(top) + 0.5, body - 1, Math.max(1, Math.round(h) - 1));
            else ctx.fillRect(x - body / 2, top, body, h);
          } else {
            ctx.fillStyle = DIM;
            ctx.fillRect(x - body / 2, top, body, h);
          }
        });
      }

      // Moving averages.
      const average = (series: (number | null)[] | null, dash: number[], alpha: number) => {
        if (!series) return;
        ctx.strokeStyle = FG;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let pen = false;
        series.forEach((value, i) => {
          if (value === null) return;
          if (pen) ctx.lineTo(xOf(i), yOf(value));
          else ctx.moveTo(xOf(i), yOf(value));
          pen = true;
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      };
      average(ma7, [], 0.75);
      average(ma25, [5, 4], 0.5);

      // The last price: a dashed line across and a tag on the scale.
      const last = all[all.length - 1] as Candle;
      if (last.close > lo && last.close < hi) {
        const y = Math.round(yOf(last.close)) + 0.5;
        ctx.strokeStyle = FG;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = FG;
        ctx.fillRect(plotW, y - 9, AXIS_W, 18);
        ctx.fillStyle = PANEL;
        ctx.textAlign = 'left';
        ctx.fillText(priceText(last.close), plotW + 6, y);
      }

      // Crosshair and the readout of the candle under it (the last candle when the pointer is away).
      let focus = shown[shown.length - 1] as Candle;
      const cross = v.cross;
      if (cross && cross.x < plotW && cross.y > TOP && cross.y < TOP + plotH) {
        const i = Math.max(0, Math.min(shown.length - 1, Math.floor(cross.x / step)));
        focus = shown[i] as Candle;
        const x = Math.round(xOf(i)) + 0.5;
        const y = Math.round(cross.y) + 0.5;
        ctx.strokeStyle = DIM;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, TOP);
        ctx.lineTo(x, TOP + plotH);
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (cross.y < TOP + priceH) {
          ctx.fillStyle = DIM;
          ctx.fillRect(plotW, y - 9, AXIS_W, 18);
          ctx.fillStyle = PANEL;
          ctx.textAlign = 'left';
          ctx.fillText(priceText(hi - ((cross.y - TOP) / priceH) * (hi - lo)), plotW + 6, y);
        }
        ctx.fillStyle = DIM;
        const label = new Date(focus.time * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const w = ctx.measureText(label).width + 12;
        const lx = Math.min(Math.max(x - w / 2, 0), plotW - w);
        ctx.fillRect(lx, height - AXIS_H, w, AXIS_H);
        ctx.fillStyle = PANEL;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx + 6, height - AXIS_H / 2);
      }
      const change = ((focus.close - focus.open) / focus.open) * 100;
      const parts: [string, string][] = [
        ['O', priceText(focus.open)],
        ['H', priceText(focus.high)],
        ['L', priceText(focus.low)],
        ['C', priceText(focus.close)],
        ['', `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`],
      ];
      let x = 2;
      ctx.textAlign = 'left';
      for (const [name, value] of parts) {
        if (x > plotW - 60) break;
        ctx.fillStyle = DIM;
        ctx.fillText(name, x, 10);
        x += name ? ctx.measureText(name).width + 4 : 0;
        ctx.fillStyle = FG;
        ctx.fillText(value, x, 10);
        x += ctx.measureText(value).width + 10;
      }
    };

    const redraw = () => requestAnimationFrame(() => draw.current());
    const at = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const move = (e: PointerEvent) => {
      const v = view.current;
      const p = at(e);
      if (v.drag) {
        const step = (host.clientWidth - AXIS_W) / v.visible;
        v.offset = Math.round(v.drag.offset + (p.x - v.drag.x) / step);
        v.cross = null;
      } else {
        v.cross = p;
      }
      redraw();
    };
    const down = (e: PointerEvent) => {
      view.current.drag = { x: at(e).x, offset: view.current.offset };
      el.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      view.current.drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const leave = () => {
      view.current.cross = null;
      redraw();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.visible = Math.round(v.visible * (e.deltaY > 0 ? 1.15 : 0.87));
      redraw();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(redraw);
    observer.observe(host);
    redraw();
    return () => {
      observer.disconnect();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  // New data or other options: draw again.
  useEffect(() => {
    requestAnimationFrame(() => draw.current());
  }, [candles, options]);

  return (
    <div class="candles" ref={box}>
      <canvas ref={canvas} />
    </div>
  );
}
