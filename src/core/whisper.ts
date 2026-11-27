/**
 * An address said aloud: twenty bytes carried from one device to another as sound.
 *
 * Each half-byte is one of sixteen tones, held for 64 milliseconds. Four tones of two more pitches open a
 * message, so a listener knows where it starts; a check sum closes it, so a message heard wrong is dropped
 * and not taken for an address. The message is said several times over, and a listener that caught none of
 * them cleanly adds up what it heard of each.
 *
 * There are two bands. The quiet one sits just under 20 kHz, where most grown-ups hear nothing and most
 * phones still can; the loud one is plainly heard and gets through where the quiet one does not.
 *
 * Sound is heard by everyone near. Only an address may be said this way, never a key, and whoever hears one
 * compares its code with the speaker's screen: a louder voice close by could say an address of its own.
 */

/**
 * How long one tone is held, in seconds, and how far apart the tones are, in hertz. A listener goes by the last
 * three quarters of a tone: by then the echoes of the tone before have died down. And it weighs that stretch
 * towards its middle, which makes it deaf to the neighbouring tones yet forgiving of a pitch that is a little off:
 * a phone being moved in a hand shifts a pitch of 18 kHz by tens of hertz.
 */
export const SYMBOL = 0.064;
const HEARD = 0.048;
const STEP = 125;
/** The lowest tone of each band. Eighteen tones up from it: sixteen for the half-bytes and two for the opening. */
export const BANDS = { quiet: 17_250, loud: 4_000 } as const;
export type Band = keyof typeof BANDS;
const TONES = 18;
const OPENING = [16, 17, 16, 17] as const;
/** What is said: an address of twenty bytes. */
const KIND_ADDRESS = 1;
const BODY = 1 + 20 + 4;
const FRAME = OPENING.length + BODY * 2;
/** Silence between two sayings, in tones. */
const GAP = 3;
const PERIOD = FRAME + GAP;
/** How many times a tone's length is looked at while listening. */
const HOPS = 4;

/** One saying of the message, in seconds. */
export const WHISPER_SECONDS = PERIOD * SYMBOL;

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Half-bytes are shifted by their place, so that a run of equal ones is not one long tone. */
const shift = (place: number) => (place * 7 + 3) & 15;

/** The tones of one saying of an address, by their numbers in the band. */
export function whisperTones(address: Uint8Array): number[] {
  if (address.length !== 20) throw new Error('an address is twenty bytes');
  const body = new Uint8Array(BODY);
  body[0] = KIND_ADDRESS;
  body.set(address, 1);
  const sum = crc32(body.subarray(0, 21));
  for (let i = 0; i < 4; i++) body[21 + i] = (sum >>> (24 - 8 * i)) & 255;
  const tones: number[] = [...OPENING];
  body.forEach((b, i) => tones.push((b >> 4) ^ shift(2 * i), (b & 15) ^ shift(2 * i + 1)));
  return tones;
}

/** The address a run of sixteen-way choices spells, or null when the check sum says it was heard wrong. */
function readBody(choices: ArrayLike<number>): Uint8Array | null {
  const body = new Uint8Array(BODY);
  for (let i = 0; i < BODY; i++) body[i] = ((((choices[2 * i] as number) ^ shift(2 * i)) & 15) << 4) | (((choices[2 * i + 1] as number) ^ shift(2 * i + 1)) & 15);
  if (body[0] !== KIND_ADDRESS) return null;
  const sum = crc32(body.subarray(0, 21));
  for (let i = 0; i < 4; i++) if (body[21 + i] !== ((sum >>> (24 - 8 * i)) & 255)) return null;
  return body.slice(1, 21);
}

/**
 * The sound of an address said `times` over, as samples between -1 and 1. Each tone swells and fades over a
 * few milliseconds: a tone cut off sharp clicks, and a click is heard even when the tone is not.
 */
export function whisperSamples(address: Uint8Array, band: Band, sampleRate: number, times: number): Float32Array {
  const tones = whisperTones(address);
  const at = (symbol: number) => Math.round(symbol * SYMBOL * sampleRate);
  const out = new Float32Array(at(PERIOD * times));
  const edge = Math.round(0.006 * sampleRate);
  for (let time = 0; time < times; time++) {
    tones.forEach((tone, i) => {
      const from = at(time * PERIOD + i);
      const to = at(time * PERIOD + i + 1);
      const turn = (2 * Math.PI * (BANDS[band] + tone * STEP)) / sampleRate;
      for (let n = from; n < to; n++) {
        const near = Math.min(n - from, to - 1 - n);
        const swell = near >= edge ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * near) / edge);
        out[n] = 0.95 * swell * Math.sin(turn * n);
      }
    });
  }
  return out;
}

/**
 * A listener: sound is pushed into it as it comes, and it answers with the address once one is heard whole.
 * It listens on both bands at once, on whichever of them the sound's sample rate can carry.
 */
export function createWhisperListener(sampleRate: number): { push(samples: Float32Array): Uint8Array | null } {
  const bands = (Object.keys(BANDS) as Band[]).filter((b) => BANDS[b] + TONES * STEP < sampleRate / 2 - 500);
  const turns = bands.map((b) => Array.from({ length: TONES }, (_, tone) => 2 * Math.cos((2 * Math.PI * (BANDS[b] + tone * STEP)) / sampleRate)));
  const window = Math.round(HEARD * sampleRate);
  const weight = Float32Array.from({ length: window }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / window));
  // A look is at the end of the tone that would start at its hop.
  const hopAt = (hop: number) => Math.round(((hop + HOPS) * SYMBOL * sampleRate) / HOPS) - window;
  /** Sound not yet looked at whole, and the place of its first sample in all that was ever pushed. */
  let kept = new Float32Array(0);
  let keptFrom = 0;
  let hop = 0;
  /** How loud each tone was at each look, for as many looks back as one saying takes. */
  const looks = new Map<number, Float32Array>();
  /** Sayings that opened right and failed their check sum: what was heard of each half-byte, kept to be added to the next saying. */
  const failed = new Map<string, Float32Array>();
  const span = HOPS * (FRAME - 1);

  function loudness(from: number): Float32Array {
    const heard = new Float32Array(bands.length * TONES);
    turns.forEach((band, b) =>
      band.forEach((turn, tone) => {
        let one = 0;
        let two = 0;
        for (let n = 0; n < window; n++) {
          const next = (kept[from + n] as number) * (weight[n] as number) + turn * one - two;
          two = one;
          one = next;
        }
        heard[b * TONES + tone] = one * one + two * two - turn * one * two;
      }),
    );
    return heard;
  }

  /** Whether a saying ends at this look on this band; if so, what it spells. */
  function read(end: number, b: number): Uint8Array | null {
    const start = end - span;
    const look = (symbol: number) => looks.get(start + symbol * HOPS);
    for (let i = 0; i < OPENING.length; i++) {
      const heard = look(i);
      if (!heard) return null;
      // The tone expected stands well clear of the rest: four times what the others are on average.
      const mine = heard[b * TONES + (OPENING[i] as number)] as number;
      let rest = 0;
      for (let tone = 0; tone < TONES; tone++) rest += heard[b * TONES + tone] as number;
      rest -= mine;
      if (!(mine > 0) || mine * (TONES - 1) < 4 * rest) return null;
    }
    // The opening is there. Each half-byte is the loudest of its sixteen tones.
    const symbols = BODY * 2;
    const heard = new Float32Array(symbols * 16);
    for (let i = 0; i < symbols; i++) {
      const at = look(OPENING.length + i);
      if (!at) return null;
      let all = 0;
      for (let tone = 0; tone < 16; tone++) all += at[b * TONES + tone] as number;
      for (let tone = 0; tone < 16; tone++) heard[i * 16 + tone] = all > 0 ? (at[b * TONES + tone] as number) / all : 0;
    }
    const spell = (h: Float32Array): Uint8Array | null => {
      const choices = new Uint8Array(symbols);
      for (let i = 0; i < symbols; i++) {
        let best = 0;
        for (let tone = 1; tone < 16; tone++) if ((h[i * 16 + tone] as number) > (h[i * 16 + best] as number)) best = tone;
        choices[i] = best;
      }
      return readBody(choices);
    };
    const alone = spell(heard);
    if (alone) return alone;
    // Heard wrong. The saying before it, heard wrong too, may make it right when the two are added up.
    let sum = heard;
    for (let back = 1; back <= 2; back++) {
      const earlier = failed.get(`${b}:${end - back * PERIOD * HOPS}`);
      if (!earlier) continue;
      sum = sum.map((v, i) => v + (earlier[i] as number));
      const together = spell(sum);
      if (together) return together;
    }
    failed.set(`${b}:${end}`, heard);
    return null;
  }

  return {
    push(samples) {
      const joined = new Float32Array(kept.length + samples.length);
      joined.set(kept);
      joined.set(samples, kept.length);
      kept = joined;
      let found: Uint8Array | null = null;
      while (!found && hopAt(hop) + window <= keptFrom + kept.length) {
        looks.set(hop, loudness(hopAt(hop) - keptFrom));
        looks.delete(hop - span - 1);
        for (let b = 0; b < bands.length && !found; b++) found = read(hop, b);
        if (hop % (PERIOD * HOPS) === 0) for (const key of failed.keys()) if (Number(key.split(':')[1]) < hop - 3 * PERIOD * HOPS) failed.delete(key);
        hop++;
      }
      // What every look to come starts after is let go.
      const drop = Math.min(kept.length, Math.max(0, hopAt(hop) - keptFrom));
      kept = kept.slice(drop);
      keptFrom += drop;
      return found;
    },
  };
}
