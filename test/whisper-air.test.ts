import { describe, expect, it } from 'vitest';
import { createWhisperListener, whisperSamples, type Band } from '../src/core/whisper.ts';

const ADDRESS = Uint8Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255);
const RATE = 48_000;

/** The sound as a phone moving at `speed` metres a second towards the listener would deliver it: every pitch shifted a little. */
export function moving(sound: Float32Array, speed: number): Float32Array {
  const ratio = 1 + speed / 343;
  const out = new Float32Array(Math.floor(sound.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const n = Math.floor(at);
    out[i] = (sound[n] as number) * (1 - (at - n)) + ((sound[n + 1] ?? 0) as number) * (at - n);
  }
  return out;
}

/** The sound with the echoes of a room: forty copies that come later and weaker, together a quarter as strong as the sound itself. */
export function echoing(sound: Float32Array, rate: number, seed = 5): Float32Array {
  let s = seed >>> 0;
  const random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 0x100000000);
  const out = new Float32Array(sound.length + rate / 4);
  const paths = [{ delay: 0, gain: 1 }, ...Array.from({ length: 40 }, () => ({ delay: 0.003 + random() * 0.2 })).map((p) => ({ delay: p.delay, gain: (random() < 0.5 ? -1 : 1) * 0.25 * Math.exp(-p.delay / 0.045) }))];
  for (const p of paths) {
    const shift = Math.round(p.delay * rate);
    for (let i = 0; i < sound.length; i++) out[i + shift] = (out[i + shift] as number) + p.gain * (sound[i] as number);
  }
  return out;
}

function hear(sound: Float32Array): boolean {
  const listener = createWhisperListener(RATE);
  const all = new Float32Array(sound.length + RATE);
  all.set(sound, Math.round(0.21 * RATE));
  for (let at = 0; at < all.length; at += 4096) {
    const found = listener.push(all.subarray(at, at + 4096));
    if (found) return found.every((b, i) => b === ADDRESS[i]);
  }
  return false;
}

describe('an address said as sound, through the air', () => {
  for (const band of ['quiet', 'loud'] as Band[]) {
    it(`is heard on the ${band} band from a phone being moved`, () => {
      for (const speed of [0.15, -0.15, 0.3, -0.3, 0.5]) expect(hear(moving(whisperSamples(ADDRESS, band, RATE, 1), speed)), `at ${speed} m/s`).toBe(true);
    });
    it(`is heard on the ${band} band in a room with echoes`, () => {
      for (const seed of [5, 6, 7, 8]) expect(hear(echoing(whisperSamples(ADDRESS, band, RATE, 1), RATE, seed)), `room ${seed}`).toBe(true);
    });
    it(`is heard on the ${band} band from a moving phone in a room with echoes`, () => {
      expect(hear(echoing(moving(whisperSamples(ADDRESS, band, RATE, 1), 0.25), RATE, 9))).toBe(true);
    });
  }
});
