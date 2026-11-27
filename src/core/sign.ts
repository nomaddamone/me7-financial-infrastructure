/**
 * The sign: an address drawn as three rings of arcs round the name, shown in place of a QR code and read by
 * me7's own scanner. Nothing else reads it, which is why a tap on it shows an ordinary QR code.
 *
 * Each ring is 64 places going clockwise: an arc for a one, a gap for a zero. Three rings carry 192 bits: the
 * address's twenty bytes and a check sum of four, so a sign read wrong is dropped and never taken for an
 * address. A ring may be turned any way, and the rings turn separately; where a ring starts is marked by a
 * short spoke that sticks out of it into the dark between the rings. A thin unbroken circle runs round the
 * whole: it is what the reader finds the sign by, and how it tells a sign seen at a slant.
 *
 * All lengths here are in parts of the sign's radius, measured to its edge.
 */

export const SIGN_RINGS = [0.52, 0.67, 0.82] as const;
/** Half the width of the circle round the sign; the circle's middle is the sign's edge, at 1. */
export const SIGN_EDGE_HALF = 0.014;
export const SIGN_CELLS = 64;
/** Half the width of a ring's band, how far a spoke reaches past the band, and half the spoke's width. */
export const SIGN_HALF = 0.03;
export const SIGN_SPOKE = 0.058;
export const SIGN_SPOKE_HALF = 0.016;

/** What an address in a sign is for. It is not drawn: it goes into the check sum, and the reader tries each. */
export const SIGN_KINDS = ['usdc-base', 'evm'] as const;
export type SignKind = (typeof SIGN_KINDS)[number];

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const checkOf = (kind: SignKind, address: Uint8Array): number => crc32(Uint8Array.from([SIGN_KINDS.indexOf(kind) + 1, ...address]));
/** Bytes are mixed with their place, so that the rings look alike in weight whatever the address. */
const mix = (place: number) => (place * 151 + 73) & 255;

/** The 192 places of a sign, ring by ring from the inside, each ring clockwise from its spoke. */
export function signBits(address: Uint8Array, kind: SignKind): Uint8Array {
  if (address.length !== 20) throw new Error('an address is twenty bytes');
  const sum = checkOf(kind, address);
  const body = Uint8Array.from([...address, (sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]);
  const bits = new Uint8Array(body.length * 8);
  body.forEach((b, i) => {
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = ((b ^ mix(i)) >> (7 - k)) & 1;
  });
  return bits;
}

/** The address 192 places spell and what it is for, or null when the check sum fits no kind. */
export function readSignBits(bits: ArrayLike<number>): { address: Uint8Array; kind: SignKind } | null {
  if (bits.length !== SIGN_RINGS.length * SIGN_CELLS) return null;
  const body = new Uint8Array(24);
  for (let i = 0; i < 24; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | ((bits[i * 8 + k] as number) & 1);
    body[i] = b ^ mix(i);
  }
  const address = body.slice(0, 20);
  const sum = ((body[20] as number) * 0x1000000 + ((body[21] as number) << 16) + ((body[22] as number) << 8) + (body[23] as number)) >>> 0;
  for (const kind of SIGN_KINDS) if (checkOf(kind, address) === sum) return { address, kind };
  return null;
}

/** A picture in shades of grey, one byte a point, row by row. */
export interface Grey {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A coloured picture as a canvas gives it, in shades of grey and no larger than `most` points a side. */
export function greyOf(rgba: ArrayLike<number>, width: number, height: number, most: number): Grey {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / most));
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const at = ((y * step + dy) * width + x * step + dx) * 4;
          sum += (rgba[at] as number) * 2 + (rgba[at + 1] as number) * 5 + (rgba[at + 2] as number);
        }
      }
      data[y * w + x] = sum / (8 * step * step);
    }
  }
  return { data, width: w, height: h };
}

function shrink(g: Grey, most: number): Grey {
  const step = Math.max(1, Math.ceil(Math.max(g.width, g.height) / most));
  if (step === 1) return g;
  const w = Math.floor(g.width / step);
  const h = Math.floor(g.height / step);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) sum += g.data[(y * step + dy) * g.width + x * step + dx] as number;
      data[y * w + x] = sum / (step * step);
    }
  }
  return { data, width: w, height: h };
}

/** How bright the picture is at a place between its points; nothing outside it. */
function at(g: Grey, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x < g.width - 1 && y < g.height - 1)) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * g.width + x0;
  const d = g.data;
  return ((d[i] as number) * (1 - fx) + (d[i + 1] as number) * fx) * (1 - fy) + ((d[i + g.width] as number) * (1 - fx) + (d[i + g.width + 1] as number) * fx) * fy;
}

/** Where a sign lies in a picture: its middle, its two half-widths (a sign seen at a slant is an oval) and how the oval is turned. */
interface Lie {
  cx: number;
  cy: number;
  a: number;
  b: number;
  turn: number;
}

const place = (lie: Lie, radius: number, angle: number): [number, number] => {
  const x = lie.a * radius * Math.cos(angle);
  const y = lie.b * radius * Math.sin(angle);
  const c = Math.cos(lie.turn);
  const s = Math.sin(lie.turn);
  return [lie.cx + x * c - y * s, lie.cy + x * s + y * c];
};

const TABLES = new Map<number, { cos: Float32Array; sin: Float32Array }>();
function round(angles: number): { cos: Float32Array; sin: Float32Array } {
  let t = TABLES.get(angles);
  if (!t) {
    t = { cos: Float32Array.from({ length: angles }, (_, k) => Math.cos((k / angles) * 2 * Math.PI)), sin: Float32Array.from({ length: angles }, (_, k) => Math.sin((k / angles) * 2 * Math.PI)) };
    TABLES.set(angles, t);
  }
  return t;
}

/** How bright the picture is, on average, round the sign at one distance from its middle. */
function roundMean(g: Grey, lie: Lie, radius: number, angles: number): number {
  const { cos, sin } = round(angles);
  const c = Math.cos(lie.turn);
  const s = Math.sin(lie.turn);
  const ax = lie.a * radius;
  const by = lie.b * radius;
  let sum = 0;
  for (let k = 0; k < angles; k++) {
    const x = ax * (cos[k] as number);
    const y = by * (sin[k] as number);
    sum += at(g, lie.cx + x * c - y * s, lie.cy + x * s + y * c);
  }
  return sum / angles;
}

/**
 * How well a sign would lie here: the rings are about half lit all the way round, the rounds between them dark.
 * The higher, the better the fit. The blunt measure looks at the middle of each ring and of each dark round, and
 * rises from far off; the sharp one looks at a ring's edges too, and falls off as soon as the lie is a little wrong.
 */
function fit(g: Grey, lie: Lie, angles: number, sharp: boolean): number {
  const before = roundMean(g, lie, sharp ? 0.962 : 0.945, angles);
  const after = roundMean(g, lie, sharp ? 1.04 : 1.06, angles);
  // The circle round the sign is lit all the way, with dark on both sides of it.
  const edge = roundMean(g, lie, 1, angles) - (before + after) / 2;
  let lit = 0;
  let dark = roundMean(g, lie, 0.455, angles) + before + after;
  if (!sharp) {
    for (const r of SIGN_RINGS) lit += roundMean(g, lie, r, angles);
    dark += roundMean(g, lie, 0.595, angles) + roundMean(g, lie, 0.745, angles);
    return lit / 3 - dark / 5 + edge;
  }
  for (const r of SIGN_RINGS) {
    lit += roundMean(g, lie, r - 0.019, angles) + roundMean(g, lie, r, angles) + roundMean(g, lie, r + 0.019, angles);
    dark += roundMean(g, lie, r - 0.047, angles) + roundMean(g, lie, r + 0.047, angles);
  }
  return lit / 9 - dark / 9 + 2 * edge;
}

/** Places a sign may lie, best first: a search over where its middle is and how large it is, on a small copy of the picture. */
function seek(g: Grey): Lie[] {
  const small = shrink(g, 120);
  const scale = g.width / small.width;
  const least = Math.min(small.width, small.height);
  const found: { lie: Lie; score: number }[] = [];
  for (let r = least * 0.19; r <= least * 0.62; r *= 1.07) {
    const step = Math.max(1.5, r * 0.09);
    for (let cy = small.height * 0.22; cy <= small.height * 0.78; cy += step) {
      for (let cx = small.width * 0.22; cx <= small.width * 0.78; cx += step) {
        const lie = { cx, cy, a: r, b: r, turn: 0 };
        found.push({ lie, score: fit(small, lie, 20, false) });
      }
    }
  }
  found.sort((p, q) => q.score - p.score);
  // The best few that are not one and the same place.
  const picked: Lie[] = [];
  for (const f of found) {
    if (picked.length === 6 || f.score <= 0) break;
    const lie = { cx: (f.lie.cx + 0.5) * scale, cy: (f.lie.cy + 0.5) * scale, a: f.lie.a * scale, b: f.lie.b * scale, turn: 0 };
    if (picked.every((p) => Math.hypot(p.cx - lie.cx, p.cy - lie.cy) > p.a * 0.3 || Math.abs(p.a - lie.a) > p.a * 0.2)) picked.push(lie);
  }
  return picked;
}

/** A lie made better: each of its measures is nudged in turn for as long as the fit rises, in ever smaller steps. */
function settle(g: Grey, start: Lie, steps: readonly number[], sharp: boolean): Lie {
  let lie = start;
  let best = fit(g, lie, 72, sharp);
  for (const part of steps) {
    const move = part * start.a;
    const nudges: ((l: Lie, by: number) => Lie)[] = [
      (l, by) => ({ ...l, cx: l.cx + by }),
      (l, by) => ({ ...l, cy: l.cy + by }),
      (l, by) => ({ ...l, a: l.a + by, b: l.b + by }),
      (l, by) => ({ ...l, a: l.a + by }),
      (l, by) => ({ ...l, b: l.b + by }),
      (l, by) => ({ ...l, turn: l.turn + part * 4 * Math.sign(by) }),
    ];
    for (let turnOfRounds = 0; turnOfRounds < 8; turnOfRounds++) {
      let moved = false;
      for (const nudge of nudges) {
        for (const by of [move, -move]) {
          const next = nudge(lie, by);
          const score = fit(g, next, 72, sharp);
          if (score > best) (best = score), (lie = next), (moved = true);
        }
      }
      if (!moved) break;
    }
  }
  return lie;
}

/** Five unknowns from five sums: the least-squares answer, or null when the points do not pin one down. */
function solve(m: number[][], v: number[]): number[] | null {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs((a[row] as number[])[col] as number) > Math.abs((a[pivot] as number[])[col] as number)) pivot = row;
    if (Math.abs((a[pivot] as number[])[col] as number) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]];
    const top = a[col] as number[];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const line = a[row] as number[];
      const by = (line[col] as number) / (top[col] as number);
      for (let k = col; k <= n; k++) line[k] = (line[k] as number) - by * (top[k] as number);
    }
  }
  return a.map((row, i) => (row[n] as number) / (row[i] as number));
}

/**
 * The circle round the sign, found from a rough lie. Along many spokes from the middle the picture is walked
 * inward from well outside, and the first bright line met is the circle. An oval is laid through those points,
 * the points that lie off it (something else bright was met first) are dropped, and it is laid again.
 */
function rim(g: Grey, rough: Lie, from: number, to: number): Lie | null {
  const rays = 72;
  const size = Math.max(rough.a, rough.b);
  const step = 0.6 / size;
  const walks: Float32Array[] = [];
  const all: number[] = [];
  for (let k = 0; k < rays; k++) {
    const angle = (k / rays) * 2 * Math.PI;
    const walk = new Float32Array(Math.ceil((from - to) / step));
    for (let i = 0; i < walk.length; i++) {
      const [x, y] = place(rough, from - i * step, angle);
      walk[i] = at(g, x, y);
    }
    walks.push(walk);
    for (let i = 0; i < walk.length; i += 3) all.push(walk[i] as number);
  }
  all.sort((p, q) => p - q);
  const dark = all[Math.floor(all.length * 0.2)] as number;
  const bright = all[Math.floor(all.length * 0.97)] as number;
  if (bright - dark < 12) return null;
  const edge = dark + 0.4 * (bright - dark);
  let points: { u: number; v: number }[] = [];
  walks.forEach((walk, k) => {
    let i = 0;
    while (i < walk.length && (walk[i] as number) <= edge) i++;
    if (i === 0 || i >= walk.length) return;
    while (i + 1 < walk.length && (walk[i + 1] as number) > (walk[i] as number)) i++;
    const [x, y] = place(rough, from - i * step, (k / rays) * 2 * Math.PI);
    points.push({ u: (x - rough.cx) / size, v: (y - rough.cy) / size });
  });
  let lie: Lie | null = null;
  for (let round = 0; round < 4; round++) {
    if (points.length < rays * 0.45) return null;
    // A u² + B uv + C v² + D u + E v = 1 through the points, as nearly as may be.
    const m = Array.from({ length: 5 }, () => new Array<number>(5).fill(0));
    const rhs = new Array<number>(5).fill(0);
    for (const p of points) {
      const row = [p.u * p.u, p.u * p.v, p.v * p.v, p.u, p.v];
      for (let i = 0; i < 5; i++) {
        rhs[i] = (rhs[i] as number) + (row[i] as number);
        for (let j = 0; j < 5; j++) (m[i] as number[])[j] = ((m[i] as number[])[j] as number) + (row[i] as number) * (row[j] as number);
      }
    }
    const conic = solve(m, rhs);
    if (!conic) return null;
    const [A, B, C, D, E] = conic as [number, number, number, number, number];
    const det = 4 * A * C - B * B;
    if (!(det > 1e-9)) return null;
    const uc = (-2 * C * D + B * E) / det;
    const vc = (-2 * A * E + B * D) / det;
    const k = 1 + A * uc * uc + B * uc * vc + C * vc * vc;
    if (!(k > 0)) return null;
    // The oval's two half-widths and the way the first lies.
    const mean = (A + C) / 2;
    const spread = Math.hypot((A - C) / 2, B / 2);
    const l1 = (mean - spread) / k;
    const l2 = (mean + spread) / k;
    if (!(l1 > 0)) return null;
    const turn = 0.5 * Math.atan2(B, A - C) + Math.PI / 2;
    lie = { cx: rough.cx + uc * size, cy: rough.cy + vc * size, a: size / Math.sqrt(l1), b: size / Math.sqrt(l2), turn };
    if (!(lie.b > lie.a * 0.6) || lie.a > size * 2.2 || lie.a < size * 0.4) return null;
    // How far each point lies off the oval, as a part of its size; the far ones are dropped.
    const off = points.map((p) => Math.abs(Math.sqrt((A * (p.u - uc) ** 2 + B * (p.u - uc) * (p.v - vc) + C * (p.v - vc) ** 2) / k) - 1));
    const usual = [...off].sort((p, q) => p - q)[Math.floor(off.length / 2)] as number;
    const kept = points.filter((_, i) => (off[i] as number) <= Math.max(0.012, 2.5 * usual));
    if (kept.length === points.length) break;
    points = kept;
  }
  return lie;
}

/** One ring read: where its spoke may be (the two likeliest places), and how bright the ring is at each of many angles. */
function spokes(g: Grey, lie: Lie, ring: number): number[] {
  const n = 256;
  const round = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const angle = (k / n) * 2 * Math.PI;
    round[k] = at(g, ...place(lie, ring + SIGN_SPOKE - 0.012, angle)) + at(g, ...place(lie, ring + SIGN_SPOKE + 0.004, angle));
  }
  const smooth = Array.from({ length: n }, (_, k) => (round[(k + n - 1) % n] as number) + 2 * (round[k] as number) + (round[(k + 1) % n] as number));
  const order = smooth.map((v, k) => ({ v, k })).sort((p, q) => q.v - p.v);
  const first = order[0] as { k: number };
  const second = order.find((o) => Math.min(Math.abs(o.k - first.k), n - Math.abs(o.k - first.k)) > 6) as { k: number };
  return [first.k, second.k].map((k) => (k / n) * 2 * Math.PI);
}

function ringBits(g: Grey, lie: Lie, ring: number, spoke: number): Uint8Array {
  const lit = new Float32Array(SIGN_CELLS);
  for (let i = 0; i < SIGN_CELLS; i++) {
    let sum = 0;
    for (const da of [0.3, 0.5, 0.7]) {
      const angle = spoke + ((i + da) / SIGN_CELLS) * 2 * Math.PI;
      for (const dr of [-0.012, 0, 0.012]) sum += at(g, ...place(lie, ring + dr, angle));
    }
    lit[i] = sum;
  }
  const sorted = [...lit].sort((p, q) => p - q);
  const edge = ((sorted[Math.floor(SIGN_CELLS * 0.1)] as number) + (sorted[Math.floor(SIGN_CELLS * 0.9)] as number)) / 2;
  return Uint8Array.from(lit, (v) => (v > edge ? 1 : 0));
}

/**
 * Look for a sign in a picture and read it. Null when there is none, or when what was read fails its check sum.
 * The sign must be whole and near the middle of the picture, light on dark, and not mirrored.
 */
export function readSign(picture: Grey): { address: Uint8Array; kind: SignKind } | null {
  const g = shrink(picture, 800);
  // From each rough place the circle round the sign is found point by point and an oval laid through the points;
  // the oval that fits best by the sharp measure is the one made exact.
  let start: Lie | null = null;
  let most = 0;
  for (const rough of seek(g)) {
    let lie: Lie | null = rough;
    for (let pass = 0; pass < 2 && lie; pass++) lie = rim(g, lie, pass === 0 ? 1.6 : 1.2, pass === 0 ? 0.55 : 0.85);
    if (!lie) continue;
    const score = fit(g, lie, 48, true);
    if (score > most) (most = score), (start = lie);
  }
  for (const rough of start ? [start] : []) {
    const lie = settle(g, rough, [0.006, 0.003, 0.0015], true);
    const tries = SIGN_RINGS.map((ring) => spokes(g, lie, ring).map((spoke) => ringBits(g, lie, ring, spoke)));
    // The likeliest spoke of every ring first; then each mix with the second likeliest.
    for (let mask = 0; mask < 8; mask++) {
      const bits = new Uint8Array(SIGN_RINGS.length * SIGN_CELLS);
      tries.forEach((ring, k) => bits.set(ring[(mask >> k) & 1] as Uint8Array, k * SIGN_CELLS));
      const read = readSignBits(bits);
      if (read) return read;
    }
  }
  return null;
}
