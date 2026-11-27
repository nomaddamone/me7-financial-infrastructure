import { hexToBytes } from '@noble/hashes/utils.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SIGN_CELLS, SIGN_EDGE_HALF, SIGN_HALF, SIGN_RINGS, SIGN_SPOKE, SIGN_SPOKE_HALF, signBits, type SignKind } from '../core/sign.ts';
import type { Dict } from './i18n.ts';
import { BrandQr } from './payqr.tsx';
import './sign.css';

/** The sign is drawn a hundred units to its edge. */
const U = 100;
const f = (n: number) => n.toFixed(2);

/** One ring's arcs: every run of ones is one arc, going clockwise from the ring's spoke, which points to the right. */
function arcs(bits: Uint8Array, ring: number): string {
  const r = (SIGN_RINGS[ring] as number) * U;
  const at = (cell: number) => {
    const angle = (cell / SIGN_CELLS) * 2 * Math.PI;
    return `${f(r * Math.cos(angle))} ${f(r * Math.sin(angle))}`;
  };
  const on = (cell: number) => bits[ring * SIGN_CELLS + cell] === 1;
  let d = '';
  for (let i = 0; i < SIGN_CELLS; i++) {
    if (!on(i) || (i > 0 && on(i - 1))) continue;
    let j = i;
    while (j < SIGN_CELLS && on(j)) j++;
    // A run is drawn in halves, so that even a ring of nothing but ones is two plain arcs.
    const mid = (i + j) / 2;
    d += `M${at(i)}A${f(r)} ${f(r)} 0 0 1 ${at(mid)}A${f(r)} ${f(r)} 0 0 1 ${at(j)}`;
  }
  return d;
}

/**
 * An address as me7's sign: the name in the middle, three rings of arcs turning slowly round it, a thin circle
 * round the whole (see src/core/sign.ts for what the arcs spell). Drawn light on dark, as the scanner expects.
 */
export function Sign({ address, kind }: { address: string; kind: SignKind }) {
  const bits = useMemo(() => signBits(hexToBytes(address.replace(/^0x/i, '')), kind), [address, kind]);
  return (
    <svg class="sign" viewBox="-110 -110 220 220" role="img" aria-label="me7">
      <g class="sign-name">
        <text x="0" y="13">me7</text>
        <text x="0" y="13" class="sign-run">
          me7
        </text>
      </g>
      {SIGN_RINGS.map((ring, k) => (
        <g key={k} class={k % 2 ? 'sign-ring sign-ring--back' : 'sign-ring'} style={`--t:${70 + k * 25}s;--from:${k * 0.37}`}>
          <circle class="sign-orbit" r={ring * U} />
          <path class="sign-arcs" d={arcs(bits, k)} stroke-width={SIGN_HALF * 2 * U} />
          <rect class="sign-spoke" x={(ring + SIGN_HALF) * U - 0.5} y={-SIGN_SPOKE_HALF * U} width={SIGN_SPOKE * U + 0.5} height={SIGN_SPOKE_HALF * 2 * U} />
        </g>
      ))}
      <circle class="sign-edge" r={U} stroke-width={SIGN_EDGE_HALF * 2 * U} />
    </svg>
  );
}

const LEAVE_MS = 460;

/**
 * What the receive screen shows for an address: me7's sign, and at a tap an ordinary QR code, for a sender whose
 * wallet is not me7. The sign winds itself up and is gone, and the code gathers out of particles in its place; a tap
 * on the code brings the sign back. A code that carries more than the address (an amount asked for) is shown at
 * once: the sign carries the address alone.
 */
export function SignOrQr({ t, address, kind, text }: { t: Dict; address: string; kind: SignKind; text: string }) {
  const s = t.sign;
  const more = text !== address;
  const [face, setFace] = useState<'sign' | 'qr'>('sign');
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const turn = () => {
    if (more || leaving) return;
    if (face === 'qr') return setFace('sign');
    if (still) return setFace('qr');
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setLeaving(false);
      setFace('qr');
    }, LEAVE_MS);
  };
  const shown = more ? 'qr' : face;

  return (
    <div class="sign-or-qr">
      <button type="button" class="sign-face" onClick={turn} aria-label={shown === 'sign' ? s.toQr : s.toSign} disabled={more}>
        {shown === 'sign' ? (
          <div class={leaving ? 'sign-box sign-box--out' : 'sign-box sign-box--in'}>
            <Sign address={address} kind={kind} />
          </div>
        ) : (
          <BrandQr text={text} reveal={`${address}:${text}`} />
        )}
      </button>
      {!more && <p class="note sign-hint">{shown === 'sign' ? s.toQr : s.toSign}</p>}
    </div>
  );
}
