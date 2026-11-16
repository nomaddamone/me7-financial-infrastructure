import { useEffect, useState } from 'preact/hooks';
import './crossbar.css';

/**
 * How far a payment that crosses from Base to Tron has got, drawn as a route with three stops:
 * Base, the crossing, Tron.
 *
 * Nobody knows the true fraction: the crossing service only says "working". So the mark moves by
 * the clock towards the end of the step it is in and never reaches it by itself; each real event
 * (the USDT arrived, the recipient was paid) moves it on for certain.
 */
export type BarPhase = 'cross' | 'paying' | 'done' | 'halt';

/** Where each step begins and ends on the route, and how fast the mark creeps towards its end (seconds to get about two thirds of the way). */
const STEP: Record<Exclude<BarPhase, 'halt'>, { from: number; to: number; pace: number }> = {
  cross: { from: 0.06, to: 0.68, pace: 70 },
  paying: { from: 0.7, to: 0.97, pace: 30 },
  done: { from: 1, to: 1, pace: 1 },
};

/** The fraction shown, and the seconds since the screen was opened. */
export function useCrossProgress(phase: BarPhase): { p: number; seconds: number } {
  const [tick, setTick] = useState(0);
  const [began] = useState(() => Date.now());
  const [stepAt, setStepAt] = useState(() => Date.now());
  const [held, setHeld] = useState(0.06);
  useEffect(() => setStepAt(Date.now()), [phase]);
  useEffect(() => {
    if (phase === 'done' || phase === 'halt') return;
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [phase]);
  let p = held;
  if (phase !== 'halt') {
    const s = STEP[phase];
    p = s.from + (s.to - s.from) * (1 - Math.exp(-(Date.now() - stepAt) / 1000 / s.pace));
  }
  // A stop keeps the mark where it was.
  useEffect(() => {
    if (phase !== 'halt') setHeld(p);
  }, [tick, phase]);
  return { p, seconds: Math.floor((Date.now() - began) / 1000) };
}

export function CrossBar({ phase, p, stops }: { phase: BarPhase; p: number; stops: readonly [string, string, string] }) {
  const x = 30 + 240 * p;
  return (
    <svg class="cbar-svg" viewBox="0 0 300 62" role="img" aria-label={`${Math.round(p * 100)}%`}>
      <line class="cbar-rail" x1="30" y1="22" x2="270" y2="22" />
      <line class="cbar-done" x1="30" y1="22" x2={x} y2="22" />
      {[30, 150, 270].map((at, i) => (
        <g key={at}>
          <circle class={x >= at - 1 ? 'cbar-stop cbar-stop--on' : 'cbar-stop'} cx={at} cy="22" r="6" />
          <text class="cbar-label" x={at} y="50" text-anchor="middle">
            {stops[i]}
          </text>
        </g>
      ))}
      {(phase === 'cross' || phase === 'paying') && <circle class="cbar-ping" cx={x} cy="22" r="9" />}
      <circle class="cbar-head" cx={x} cy="22" r="3.5" />
    </svg>
  );
}
