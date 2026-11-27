import { describe, expect, it } from 'vitest';
import { createWhisperListener, whisperSamples, whisperTones, WHISPER_SECONDS, type Band } from '../src/core/whisper.ts';

const ADDRESS = Uint8Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255);
const ZEROS = new Uint8Array(20);

/** Noise that is the same at every run. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

/** What a microphone would hand over: silence first, the sound made quieter, noise over all of it, in pieces as they come. */
function hear(sound: Float32Array, rate: number, { lead = 0.37, gain = 1, hiss = 0, seed = 1 }: { lead?: number; gain?: number; hiss?: number; seed?: number } = {}): Uint8Array | null {
  const random = noise(seed);
  const before = Math.round(lead * rate);
  const all = new Float32Array(before + sound.length + Math.round(0.3 * rate));
  for (let i = 0; i < all.length; i++) all[i] = hiss * random() + (i >= before && i - before < sound.length ? gain * (sound[i - before] as number) : 0);
  const listener = createWhisperListener(rate);
  for (let at = 0; at < all.length; at += 4096) {
    const found = listener.push(all.subarray(at, at + 4096));
    if (found) return found;
  }
  return null;
}

describe('an address said as sound', () => {
  it('opens every saying the same way and spells the address after it', () => {
    const tones = whisperTones(ADDRESS);
    expect(tones.slice(0, 4)).toEqual([16, 17, 16, 17]);
    expect(tones).toHaveLength(4 + 25 * 2);
    expect(tones.slice(4).every((t) => t >= 0 && t < 16)).toBe(true);
    // An address of equal bytes is still not one long tone.
    expect(new Set(whisperTones(ZEROS).slice(6, 46)).size).toBeGreaterThan(8);
    expect(() => whisperTones(new Uint8Array(19))).toThrow();
  });

  it('is heard on both bands at the rates phones use', () => {
    for (const rate of [48_000, 44_100]) {
      for (const band of ['quiet', 'loud'] as Band[]) {
        expect(hear(whisperSamples(ADDRESS, band, rate, 1), rate), `${band} at ${rate}`).toEqual(ADDRESS);
        expect(hear(whisperSamples(ZEROS, band, rate, 1), rate, { lead: 0.123 })).toEqual(ZEROS);
      }
    }
  });

  it('is heard when it is far quieter than the noise around', () => {
    // The noise is some five times as strong as the sound.
    expect(hear(whisperSamples(ADDRESS, 'quiet', 48_000, 1), 48_000, { gain: 0.04, hiss: 0.2 })).toEqual(ADDRESS);
    expect(hear(whisperSamples(ADDRESS, 'loud', 44_100, 1), 44_100, { gain: 0.04, hiss: 0.2, seed: 7 })).toEqual(ADDRESS);
  });

  it('adds up sayings that were each heard wrong', () => {
    const rate = 48_000;
    const once = Math.round(WHISPER_SECONDS * rate);
    const sound = whisperSamples(ADDRESS, 'quiet', rate, 2);
    // A different tenth of each saying is lost under a burst of noise: neither is whole, the two together are.
    const random = noise(3);
    for (const from of [Math.round(0.3 * once), once + Math.round(0.6 * once)]) for (let i = from; i < from + Math.round(0.1 * once); i++) sound[i] = random();
    expect(hear(sound.slice(0, once), rate)).toBeNull();
    expect(hear(sound.slice(once), rate)).toBeNull();
    expect(hear(sound, rate)).toEqual(ADDRESS);
  });

  it('takes nothing for an address: neither noise nor a saying with a tone changed', () => {
    const rate = 48_000;
    const random = noise(11);
    expect(hear(Float32Array.from({ length: rate * 8 }, () => random()), rate)).toBeNull();
    const sound = whisperSamples(ADDRESS, 'loud', rate, 1);
    const other = whisperSamples(Uint8Array.from(ADDRESS, (b, i) => (i === 9 ? b ^ 16 : b)), 'loud', rate, 1);
    // The tones of the tenth byte are taken from another address: the check sum no longer fits.
    const symbol = Math.round(0.064 * rate);
    sound.set(other.subarray((4 + 2 + 18) * symbol, (4 + 2 + 20) * symbol), (4 + 2 + 18) * symbol);
    expect(hear(sound, rate)).toBeNull();
  });

  it('listens on the loud band alone when the sound cannot carry the quiet one', () => {
    expect(hear(whisperSamples(ADDRESS, 'loud', 16_000, 1), 16_000)).toEqual(ADDRESS);
  });
});
