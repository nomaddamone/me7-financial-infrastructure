import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toChecksumAddress } from '../core/evm.ts';
import { addressCode } from '../core/payqr.ts';
import { BANDS, createWhisperListener, whisperSamples, type Band } from '../core/whisper.ts';
import { Spinner } from './fx.tsx';
import type { Dict } from './i18n.ts';

/** How many times over an address is said, and how long a listener waits for one, in milliseconds. */
const TIMES = 4;
const WAIT = 25_000;

type AudioMaker = typeof AudioContext;
const audioMaker = (): AudioMaker | undefined => window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioMaker }).webkitAudioContext;

/** Say an address through the speaker. Returns what silences it; `onEnd` is called once, when it is over either way. */
function sayAddress(address: string, band: Band, onEnd: () => void): () => void {
  const Maker = audioMaker();
  if (!Maker) throw new Error('no sound');
  const ctx = new Maker();
  // A device whose sound cannot carry the quiet band says it aloud: a tone it cannot make would come out as another.
  const fits = BANDS[band] + 2_000 < ctx.sampleRate / 2;
  const samples = whisperSamples(hexToBytes(address.replace(/^0x/i, '')), fits ? band : 'loud', ctx.sampleRate, TIMES);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    try {
      source.stop();
    } catch {
      /* it had not started, or had ended already */
    }
    void ctx.close().catch(() => undefined);
    onEnd();
  };
  source.onended = end;
  void ctx.resume().catch(() => undefined);
  source.start();
  return end;
}

/**
 * Listen for an address through the microphone. The microphone is asked for here and nowhere else, and is let go
 * the moment an address is heard, the wait runs out, or the returned function is called. Nothing heard is kept or
 * sent anywhere: the sound is looked at in this page and dropped.
 */
function hearAddress(onFound: (address: string) => void, onFail: (why: 'denied' | 'nothing') => void): () => void {
  let over = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let timer = 0;
  const stop = () => {
    over = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    void ctx?.close().catch(() => undefined);
  };
  const Maker = audioMaker();
  const media = navigator.mediaDevices;
  if (!Maker || !media?.getUserMedia) {
    queueMicrotask(() => !over && onFail('denied'));
    return stop;
  }
  // A phone cleans up a voice by default; here that would clean the address away.
  media.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false }).then(
    (s) => {
      if (over) return s.getTracks().forEach((track) => track.stop());
      stream = s;
      ctx = new Maker();
      const listener = createWhisperListener(ctx.sampleRate);
      const source = ctx.createMediaStreamSource(s);
      const tap = ctx.createScriptProcessor(4096, 1, 1);
      // The tap works only while it leads somewhere; it leads to the speaker through a gain of nothing, so nothing is played back.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      tap.onaudioprocess = (e) => {
        if (over) return;
        const found = listener.push(e.inputBuffer.getChannelData(0));
        if (!found) return;
        stop();
        onFound(toChecksumAddress(bytesToHex(found)));
      };
      source.connect(tap);
      tap.connect(mute);
      mute.connect(ctx.destination);
      void ctx.resume().catch(() => undefined);
      timer = window.setTimeout(() => {
        if (over) return;
        stop();
        onFail('nothing');
      }, WAIT);
    },
    () => !over && onFail('denied'),
  );
  return stop;
}

/**
 * Under an address shown for receiving: say it as sound, for a sender whose device is listening. Quietly first, in a
 * band most people do not hear; aloud when that did not get through. No microphone is used here.
 */
export function Whisper({ t, address }: { t: Dict; address: string }) {
  const w = t.whisper;
  const [band, setBand] = useState<Band | null>(null);
  const [tried, setTried] = useState(false);
  const [fault, setFault] = useState(false);
  const silence = useRef<(() => void) | null>(null);
  // Another address shown, or the screen left: what was being said is cut short.
  useEffect(() => () => silence.current?.(), [address]);

  const say = (next: Band) => {
    silence.current?.();
    setFault(false);
    try {
      const end = sayAddress(address, next, () => {
        if (silence.current === end) (silence.current = null), setBand(null);
      });
      silence.current = end;
      setBand(next);
      setTried(true);
    } catch {
      setFault(true);
    }
  };

  return (
    <div class="whisper">
      <div class="row">
        {band ? (
          <button type="button" class="btn" onClick={() => silence.current?.()}>
            {w.stop}
          </button>
        ) : (
          <button type="button" class="btn" onClick={() => say('quiet')}>
            {w.say}
          </button>
        )}
        {(tried || band) && (
          <button type="button" class="btn" disabled={band === 'loud'} onClick={() => say('loud')}>
            {w.louder}
          </button>
        )}
      </div>
      {band && (
        <p class="note" role="status">
          <Spinner /> {band === 'loud' ? w.sayingLoud : w.saying}
        </p>
      )}
      {!band && tried && <p class="note">{w.sayHint}</p>}
      {fault && <p class="alert">{w.noSound}</p>}
    </div>
  );
}

/**
 * The sender's side: the microphone listens until an address is heard. What is heard goes into the send form with
 * its code, to be compared with the receiver's screen and confirmed like anything typed.
 */
export function Hearer({ t, onResult, onClose }: { t: Dict; onResult: (address: string) => void; onClose: () => void }) {
  const w = t.whisper;
  const [state, setState] = useState<'listening' | 'denied' | 'nothing'>('listening');
  const [round, setRound] = useState(0);
  useEffect(() => {
    setState('listening');
    return hearAddress(
      (address) => {
        navigator.vibrate?.(40);
        onResult(address);
      },
      (why) => setState(why),
    );
  }, [round]);

  return (
    <section class="panel">
      <h2 class="title">{w.listenTitle}</h2>
      {state === 'listening' && (
        <>
          <p class="note" role="status">
            <Spinner /> {w.listening}
          </p>
          <p class="note">{w.micNote}</p>
        </>
      )}
      {state !== 'listening' && (
        <p class="alert" role="status">
          {state === 'denied' ? w.denied : w.nothing}
        </p>
      )}
      <div class="row">
        <button type="button" class="btn" onClick={onClose}>
          {t.back}
        </button>
        {state === 'nothing' && (
          <button type="button" class="btn btn--accent" onClick={() => setRound((n) => n + 1)}>
            {w.again}
          </button>
        )}
      </div>
    </section>
  );
}

/** What the send form says under an address that came by sound. */
export const heardNote = (t: Dict, address: string): string => t.whisper.heard.replace('{code}', addressCode(address));
