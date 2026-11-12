import { useMemo, useRef, useState } from 'preact/hooks';
import type { HistoryPoint } from './portfolio.ts';

const W = 300;
const H = 100;
const PAD = 8;

/**
 * The balance curve. Draws itself in from the left, shows a faint area under
 * the line, and follows the pointer or finger with a marker; `onHover` reports
 * the point under it so the number above can show that moment's value.
 */
export function BalanceChart({
  points,
  onHover,
  minSpan = 0,
}: {
  points: readonly HistoryPoint[] | null;
  onHover: (point: HistoryPoint | null) => void;
  /**
   * Smallest vertical range to draw, as a fraction of the average value. A price
   * that moves by a tenth of a cent (a stablecoin) then reads as nearly flat
   * instead of being stretched to the full height.
   */
  minSpan?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const shape = useMemo(() => {
    if (!points || points.length < 2) return null;
    const values = points.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const floor = minSpan * (values.reduce((sum, v) => sum + v, 0) / values.length);
    if (max - min < floor) {
      const middle = (max + min) / 2;
      min = middle - floor / 2;
      max = middle + floor / 2;
    }
    const flat = max - min < 1e-9;
    // The line stops short of the right edge so the marker on the latest point stays inside the panel.
    const right = W - 7;
    const x = (i: number) => (i / (points.length - 1)) * right;
    // A flat history sits low in the box rather than cutting it in half.
    const y = (v: number) => (flat ? H - PAD - (max > 0 ? (H - 2 * PAD) * 0.35 : 0) : H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD));
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join('');
    return { line, area: `${line}L${right} ${H}L0 ${H}Z`, x, y, right };
  }, [points, minSpan]);

  if (!points || !shape) {
    return (
      <div class="chart chart--empty" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={`M0 ${H - PAD}L${W} ${H - PAD}`} class="chart-line chart-line--idle" />
        </svg>
      </div>
    );
  }

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const across = ((clientX - rect.left) / rect.width) * (W / shape.right);
    const index = Math.max(0, Math.min(points.length - 1, Math.round(across * (points.length - 1))));
    setActive(index);
    onHover(points[index] ?? null);
  };
  const leave = () => {
    setActive(null);
    onHover(null);
  };
  const marked = active ?? points.length - 1;
  const point = points[marked];

  return (
    <div
      class="chart"
      ref={box}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={leave}
      onPointerCancel={leave}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={shape.area} class="chart-area" />
        <path d={shape.line} class="chart-line" pathLength={1} />
        {active !== null && <line x1={shape.x(active)} x2={shape.x(active)} y1={0} y2={H} class="chart-cursor" />}
      </svg>
      {point && (
        <span
          class={active === null ? 'chart-dot chart-dot--live' : 'chart-dot'}
          style={{ left: `${(shape.x(marked) / W) * 100}%`, top: `${(shape.y(point.value) / H) * 100}%` }}
        />
      )}
    </div>
  );
}
