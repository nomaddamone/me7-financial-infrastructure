/**
 * The backdrop of me7's public pages: the same drifting lines the wallet draws behind itself,
 * caught at one moment and written down as a picture. The wallet's backdrop is alive because a
 * script draws it; these pages run no script, so theirs stands still. Same field, same tones.
 */
const W = 1200;
const H = 2000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wallet's own field (see Backdrop in src/app/fx.tsx), at a fixed moment. */
function field(x: number, y: number): number {
  const time = 41.3;
  const X = x * 0.0042;
  const Y = y * 0.0042;
  return (
    (Math.sin(X * 1.3 + time * 0.6) +
      Math.sin(Y * 1.7 - time * 0.45) +
      Math.sin((X + Y) * 0.9 + time * 0.3) +
      Math.sin(Math.hypot(X - 2.2, Y - 1.4) * 1.6 - time * 0.7)) /
    4
  );
}

export function backdropSvg(): string {
  const rand = rng(7);
  const dim: string[] = [];
  const bright: string[] = [];
  for (let i = 0; i < 520; i++) {
    let x = rand() * W;
    let y = rand() * H;
    const steps = 14 + Math.floor(rand() * 26);
    let d = `M${x.toFixed(0)} ${y.toFixed(0)}`;
    for (let s = 0; s < steps; s++) {
      const angle = field(x, y) * Math.PI * 2.2;
      x += Math.cos(angle) * 5;
      y += Math.sin(angle) * 5;
      d += `L${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    (i % 7 === 0 ? bright : dim).push(d);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="${W}" height="${H}" fill="#0e0e0e"/>` +
    `<path d="${dim.join('')}" fill="none" stroke="#9a9a9a" stroke-opacity="0.26" stroke-width="1.1" stroke-linecap="round"/>` +
    `<path d="${bright.join('')}" fill="none" stroke="#f4f4f4" stroke-opacity="0.5" stroke-width="1.1" stroke-linecap="round"/>` +
    `</svg>\n`
  );
}
