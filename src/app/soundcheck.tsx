import { useEffect, useRef, useState } from 'preact/hooks';
import { bytesToHex } from '@noble/hashes/utils.js';
import { addressCode } from '../core/payqr.ts';
import { createWhisperListener, toneLoudness } from '../core/whisper.ts';
import { CopyButton } from './home.tsx';
import type { Dict } from './i18n.ts';

/**
 * A measure of what sound gets from one device to another, opened at me7.network/#sound with no account. One device
 * plays plain tones one after another, the other listens and says how far each stood above its own noise. It is how
 * the band the quiet whisper uses is chosen: speakers and microphones of phones differ most just under 20 kHz.
 * Nothing heard is kept or sent anywhere.
 */
const TONES = [4000, ...Array.from({ length: 17 }, (_, i) => 12_000 + i * 500)];
const EACH = 0.5;
const ROUNDS = 3;

type AudioMaker = typeof AudioContext;
const audioMaker = (): AudioMaker | undefined => window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioMaker }).webkitAudioContext;

export function SoundCheck({ t, onLeave }: { t: Dict; onLeave: () => void }) {
  const w = t.whisper;
  const [mode, setMode] = useState<'idle' | 'playing' | 'listening' | 'denied'>('idle');
  const [rows, setRows] = useState<{ hz: number; db: number }[]>([]);
  const [about, setAbout] = useState('');
  // A whisper from the wallet's own receive screen is listened for as well: whether it was heard, and if not, how far it got.
  const [said, setSaid] = useState('');
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const play = () => {
    stop.current?.();
    const Maker = audioMaker();
    if (!Maker) return;
    const ctx = new Maker();
    const rate = ctx.sampleRate;
    const each = Math.round(EACH * rate);
    const edge = Math.round(0.01 * rate);
    const samples = new Float32Array(each * TONES.length * ROUNDS);
    for (let k = 0; k < TONES.length * ROUNDS; k++) {
      const hz = TONES[k % TONES.length] as number;
      // A tone the device cannot make would come out as another: it is left silent.
      if (hz > rate / 2 - 500) continue;
      for (let n = 0; n < each; n++) {
        const near = Math.min(n, each - 1 - n);
        samples[k * each + n] = 0.95 * (near >= edge ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * near) / edge)) * Math.sin((2 * Math.PI * hz * n) / rate);
      }
    }
    const buffer = ctx.createBuffer(1, samples.length, rate);
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
        /* ended already */
      }
      void ctx.close().catch(() => undefined);
      setMode('idle');
    };
    source.onended = end;
    stop.current = end;
    void ctx.resume().catch(() => undefined);
    source.start();
    setAbout(`${rate} Hz`);
    setMode('playing');
  };

  const listen = () => {
    stop.current?.();
    const Maker = audioMaker();
    const media = navigator.mediaDevices;
    if (!Maker || !media?.getUserMedia) return setMode('denied');
    let over = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;
    const end = () => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close().catch(() => undefined);
      setMode((m) => (m === 'listening' ? 'idle' : m));
    };
    stop.current = end;
    setRows([]);
    setSaid('');
    setMode('listening');
    media.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false }).then(
      (s) => {
        if (over) return s.getTracks().forEach((track) => track.stop());
        stream = s;
        ctx = new Maker();
        const rate = ctx.sampleRate;
        const set = s.getAudioTracks()[0]?.getSettings() ?? {};
        setAbout(`${rate} Hz · echo ${String(set.echoCancellation)} · noise ${String(set.noiseSuppression)} · gain ${String(set.autoGainControl)} · mic ${String(set.sampleRate ?? '?')} Hz`);
        const seen = TONES.map(() => [] as number[]);
        const whisper = createWhisperListener(rate);
        let address = '';
        const source = ctx.createMediaStreamSource(s);
        const tap = ctx.createScriptProcessor(4096, 1, 1);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        let chunks = 0;
        tap.onaudioprocess = (e) => {
          if (over) return;
          // The stretch is faded in and out before it is measured, so that a loud tone does not spill onto its neighbours' pitches.
          const raw = e.inputBuffer.getChannelData(0);
          const found = address ? null : whisper.push(raw);
          if (found) address = addressCode(`0x${bytesToHex(found)}`);
          const data = raw.map((v, n) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (raw.length - 1))));
          TONES.forEach((hz, i) => hz < rate / 2 - 500 && (seen[i] as number[]).push(toneLoudness(data, hz, rate)));
          if (++chunks % 6 !== 0) return;
          setSaid(`whisper: ${address ? `heard, code ${address}` : 'not heard'} · ${whisper.heard().map((c) => `${c.band} opened ${c.opened} failed ${c.failed}`).join(' · ')}`);
          // How far the loudest moment of each tone stood above what that pitch is like the rest of the time.
          setRows(
            TONES.map((hz, i) => {
              const all = [...(seen[i] as number[])].sort((a, b) => a - b);
              // A tone sounds for a small part of the time: three quarters of what was heard at its pitch is surely the noise there.
              const usual = all[Math.floor(all.length * 0.75)] ?? 0;
              const most = all[all.length - 1] ?? 0;
              return { hz, db: usual > 0 && most > 0 ? Math.round(10 * Math.log10(most / usual)) : 0 };
            }),
          );
        };
        source.connect(tap);
        tap.connect(mute);
        mute.connect(ctx.destination);
        void ctx.resume().catch(() => undefined);
        timer = window.setTimeout(end, 45_000);
      },
      () => !over && (setMode('denied'), (over = true)),
    );
  };

  const report = [about, said, ...rows.map((r) => `${(r.hz / 1000).toFixed(1)} kHz  ${r.db >= 0 ? '+' : ''}${r.db} dB`), navigator.userAgent].join('\n');
  return (
    <section class="panel">
      <h2 class="title">{w.checkTitle}</h2>
      <p class="lead">{w.checkLead}</p>
      <div class="row">
        <button type="button" class="btn" onClick={mode === 'playing' ? () => stop.current?.() : play}>
          {mode === 'playing' ? w.stop : w.checkPlay}
        </button>
        <button type="button" class="btn" onClick={mode === 'listening' ? () => stop.current?.() : listen}>
          {mode === 'listening' ? w.stop : w.checkListen}
        </button>
      </div>
      {mode === 'playing' && <p class="note" role="status">{w.checkPlaying}</p>}
      {mode === 'listening' && <p class="note" role="status">{w.checkListening}</p>}
      {mode === 'denied' && <p class="alert">{w.denied}</p>}
      {about && <p class="note">{about}</p>}
      {said && <p class="note">{said}</p>}
      {rows.length > 0 && (
        <>
          <pre class="sound-rows">{rows.map((r) => `${(r.hz / 1000).toFixed(1).padStart(4)} kHz  ${'█'.repeat(Math.max(0, Math.min(20, Math.round(r.db / 2))))} ${r.db >= 0 ? '+' : ''}${r.db} dB`).join('\n')}</pre>
          <CopyButton t={t} value={report} />
        </>
      )}
      <button type="button" class="linklike" onClick={onLeave}>
        {t.back}
      </button>
    </section>
  );
}
