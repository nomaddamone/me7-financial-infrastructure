import { describe, expect, it } from 'vitest';
import { greyOf, readSign, readSignBits, SIGN_CELLS, SIGN_EDGE_HALF, SIGN_HALF, SIGN_RINGS, SIGN_SPOKE, SIGN_SPOKE_HALF, signBits, type Grey, type SignKind } from '../src/core/sign.ts';

const ADDRESS = Uint8Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255);

function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 0x100000000);
}

interface Shot {
  width?: number;
  height?: number;
  /** The sign's middle and radius in the picture, in points. */
  cx?: number;
  cy?: number;
  radius?: number;
  /** How each ring is turned, in parts of a full turn. */
  turns?: [number, number, number];
  /** Seen at a slant: one way across is this much narrower, and the narrow way lies at this angle. */
  squash?: number;
  slant?: number;
  /** Seen at a slant and close: how much the far side is drawn in by the perspective (see `lean` in src/core/sign.ts). */
  lean?: number;
  /** How far each point is smeared, in points, and how much noise is laid over, out of 255. */
  blur?: number;
  hiss?: number;
  /** How bright the arcs and the dark are, out of 255. */
  light?: number;
  dark?: number;
  seed?: number;
}

/** A photograph of a sign, as a camera pointed at a screen might take it: drawn point by point, then smeared and made noisy. */
function shoot(address: Uint8Array, kind: SignKind, shot: Shot = {}): Grey {
  const { width = 640, height = 480, cx = width / 2, cy = height / 2, radius = 170, turns = [0.11, 0.62, 0.87], squash = 1, slant = 0, lean = 0, blur = 1, hiss = 6, light = 235, dark = 18, seed = 1 } = shot;
  const bits = signBits(address, kind);
  const random = noise(seed);
  // The name in the middle and some clutter outside the sign: thin strokes of light that carry nothing.
  const strokes = Array.from({ length: 14 }, (_, i) => {
    const inside = i < 6;
    const r = inside ? random() * 0.38 : 1.15 + random() * 0.8;
    const a = random() * 2 * Math.PI;
    return { x: r * Math.cos(a), y: r * Math.sin(a), dx: random() - 0.5, dy: random() - 0.5, long: inside ? 0.25 : 0.4 };
  });
  const lit = (x: number, y: number): boolean => {
    const r = Math.hypot(x, y);
    if (Math.abs(r - 1) <= SIGN_EDGE_HALF) return true;
    const turn = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
    for (let k = 0; k < SIGN_RINGS.length; k++) {
      const ring = SIGN_RINGS[k] as number;
      const local = (turn - (turns[k] as number) + 2) % 1;
      if (Math.abs(r - ring) <= SIGN_HALF && bits[k * SIGN_CELLS + Math.floor(local * SIGN_CELLS)]) return true;
      const across = Math.min(local, 1 - local) * 2 * Math.PI * r;
      if (r > ring + SIGN_HALF && r <= ring + SIGN_HALF + SIGN_SPOKE && across <= SIGN_SPOKE_HALF) return true;
    }
    for (const s of strokes) {
      const n = Math.hypot(s.dx, s.dy);
      const along = ((x - s.x) * s.dx + (y - s.y) * s.dy) / n;
      const off = Math.abs((x - s.x) * s.dy - (y - s.y) * s.dx) / n;
      if (along >= 0 && along <= s.long && off <= 0.006) return true;
    }
    return false;
  };
  const c = Math.cos(slant);
  const s = Math.sin(slant);
  const sharp = new Float32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let sum = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        // From the picture back onto the sign: the slant is undone, and then the perspective.
        const ux = (px + ox - cx) / radius;
        const uy = (py + oy - cy) / radius;
        const vx = (ux * c + uy * s) / squash;
        const vy = -ux * s + uy * c;
        const wx = vx / (1 - lean * lean) - lean / (1 - lean * lean);
        const wy = vy / Math.sqrt(1 - lean * lean);
        const x = wx / (1 - lean * wx);
        const y = wy / (1 - lean * wx);
        sum += lit(x * c - y * s, x * s + y * c) ? light : dark;
      }
      sharp[py * width + px] = sum / 4;
    }
  }
  const data = new Uint8Array(width * height);
  const reach = Math.round(blur);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let sum = 0;
      let count = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          sum += sharp[y * width + x] as number;
          count++;
        }
      }
      data[py * width + px] = Math.max(0, Math.min(255, sum / count + (random() - 0.5) * 2 * hiss));
    }
  }
  return { data, width, height };
}

const reads = (shot: Shot, kind: SignKind = 'usdc-base') => {
  const read = readSign(shoot(ADDRESS, kind, shot));
  return !!read && read.kind === kind && read.address.every((b, i) => b === ADDRESS[i]);
};

// Each picture is drawn point by point, which takes a while when every test file runs at once: these tests are given time.
describe('the sign: an address as rings of arcs', { timeout: 60_000 }, () => {
  it('spells an address and what it is for, and drops what was read wrong', () => {
    for (const kind of ['usdc-base', 'evm'] as const) {
      const bits = signBits(ADDRESS, kind);
      expect(bits).toHaveLength(192);
      expect(readSignBits(bits)).toEqual({ address: ADDRESS, kind });
      for (const flip of [0, 77, 191]) expect(readSignBits(bits.map((b, i) => (i === flip ? 1 - b : b)))).toBeNull();
    }
    // The rings weigh about the same whatever the address: an address of noughts is not three empty rings.
    const lit = signBits(new Uint8Array(20), 'evm').reduce((sum, b) => sum + b, 0);
    expect(lit).toBeGreaterThan(70);
    expect(lit).toBeLessThan(122);
    expect(() => signBits(new Uint8Array(19), 'evm')).toThrow();
    expect(readSignBits(new Uint8Array(100))).toBeNull();
  });

  it('is read straight on, of either kind, with its rings turned any way', () => {
    expect(reads({})).toBe(true);
    expect(reads({}, 'evm')).toBe(true);
    for (const turns of [[0, 0, 0], [0.5, 0.25, 0.75], [0.993, 0.004, 0.331], [0.2, 0.2001, 0.9]] as [number, number, number][]) expect(reads({ turns }), String(turns)).toBe(true);
  });

  it('is read small, large and off the middle of the picture', () => {
    expect(reads({ radius: 95 })).toBe(true);
    expect(reads({ radius: 225 })).toBe(true);
    expect(reads({ radius: 120, cx: 250, cy: 190 })).toBe(true);
    expect(reads({ radius: 130, cx: 410, cy: 280 })).toBe(true);
    expect(reads({ width: 480, height: 640, radius: 190 })).toBe(true);
  });

  it('is read from far off and from close by in a sharp picture', () => {
    expect(reads({ width: 1280, height: 720, radius: 64, cx: 700, cy: 330 })).toBe(true);
    expect(reads({ width: 1280, height: 720, radius: 90, cx: 420, cy: 400, squash: 0.9, slant: 0.4 })).toBe(true);
    expect(reads({ width: 1280, height: 720, radius: 340 })).toBe(true);
  });

  it('is read at a slant', () => {
    for (const slant of [0, 0.7, 1.6, 2.5]) {
      expect(reads({ squash: 0.9, slant }), `a tenth narrower at ${slant}`).toBe(true);
      expect(reads({ squash: 0.8, slant, radius: 190 }), `a fifth narrower at ${slant}`).toBe(true);
    }
  });

  it('is read at a slant and close, where the far side is smaller than the near', () => {
    expect(reads({ squash: 0.89, slant: 0.3, lean: 0.12, radius: 175 })).toBe(true);
    expect(reads({ squash: 0.89, slant: 2.0, lean: -0.15, radius: 175 })).toBe(true);
    expect(reads({ squash: 0.8, slant: 1.2, lean: 0.25, radius: 180 })).toBe(true);
    expect(reads({ squash: 0.85, slant: 0.9, lean: -0.3, radius: 150, cx: 300, cy: 250, blur: 2, hiss: 10 })).toBe(true);
    expect(reads({ width: 720, height: 1280, cx: 320, cy: 580, radius: 180, squash: 0.79, slant: 1.5, lean: 0.2 })).toBe(true);
  });

  it('is read smeared, noisy and dim', () => {
    expect(reads({ blur: 2, hiss: 14 })).toBe(true);
    expect(reads({ blur: 3, radius: 200 })).toBe(true);
    expect(reads({ light: 120, dark: 45, hiss: 10 })).toBe(true);
    expect(reads({ blur: 2, hiss: 12, squash: 0.88, slant: 1.1, radius: 150, cx: 300, cy: 250, seed: 4 })).toBe(true);
  });

  it('takes nothing for a sign: neither noise, nor an empty screen, nor a sign with a ring spoiled', () => {
    const random = noise(9);
    expect(readSign({ data: Uint8Array.from({ length: 320 * 240 }, () => random() * 255), width: 320, height: 240 })).toBeNull();
    expect(readSign({ data: new Uint8Array(320 * 240).fill(20), width: 320, height: 240 })).toBeNull();
    const shot = shoot(ADDRESS, 'evm');
    // A bright patch over a stretch of the two outer rings: gaps there read as arcs that are not there.
    for (let y = 200; y < 280; y++) for (let x = 425; x < 468; x++) shot.data[y * shot.width + x] = 240;
    expect(readSign(shot)).toBeNull();
  });

  it('is read from a coloured picture as a camera gives it', () => {
    const grey = shoot(ADDRESS, 'usdc-base', { width: 800, height: 600, radius: 220 });
    const rgba = new Uint8ClampedArray(grey.width * grey.height * 4);
    grey.data.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
    expect(readSign(greyOf(rgba, grey.width, grey.height, 480))?.address).toEqual(ADDRESS);
  });
});
