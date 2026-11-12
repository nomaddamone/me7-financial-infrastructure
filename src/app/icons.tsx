import type { ComponentChildren } from 'preact';

/**
 * Coin marks, drawn here as simple one-colour line glyphs in the app's own
 * style: each echoes the shape people know the coin by (the B with strokes,
 * the diamond, the T, the hexagon) without copying anyone's logo artwork.
 */
const GLYPHS: Record<string, ComponentChildren> = {
  btc: (
    <>
      <path d="M8.5 6.2h4.1a2.45 2.45 0 0 1 0 4.9H8.5zM8.5 11.1h4.8a2.45 2.45 0 0 1 0 4.9H8.5z" />
      <path d="M10 4.2v2M12.4 4.2v2M10 16v2M12.4 16v2" />
    </>
  ),
  eth: (
    <>
      <path d="M11 3.2l5.2 7.9L11 14.2l-5.2-3.1z" />
      <path d="M5.8 12.9L11 16l5.2-3.1L11 19z" />
    </>
  ),
  trx: (
    <>
      <path d="M4.2 5.2l13.6 2.6L9.6 18.8z" />
      <path d="M4.2 5.2l6.6 5.6 7-3M10.8 10.8l-1.2 8" />
    </>
  ),
  usdt: (
    <>
      <path d="M6.6 6.4h8.8M11 6.4v10.4" />
      <ellipse cx="11" cy="10.9" rx="6" ry="1.7" />
    </>
  ),
  usdc: (
    <>
      <path d="M13.6 8.9c-.4-1-1.3-1.5-2.6-1.5-1.5 0-2.5.8-2.5 1.9 0 2.6 5.2 1.2 5.2 3.8 0 1.2-1.1 2-2.7 2-1.4 0-2.4-.6-2.8-1.6" />
      <path d="M11 5.4v2M11 15.1v1.9" />
    </>
  ),
  dai: (
    <>
      <path d="M7.4 5.8h3.1c3.3 0 5.4 2.1 5.4 5.2s-2.1 5.2-5.4 5.2H7.4z" />
      <path d="M5 9.7h12.4M5 12.3h12.4" />
    </>
  ),
  link: <path d="M11 3.6l6.4 3.7v7.4L11 18.4l-6.4-3.7V7.3z" stroke-width="2.2" />,
};

// Wrapped bitcoin wears bitcoin's mark; its name beside it says which token it is.
GLYPHS.wbtc = GLYPHS.btc;
GLYPHS.cbbtc = GLYPHS.btc;

export function CoinIcon({ ticker }: { ticker: string }) {
  const glyph = GLYPHS[ticker];
  return (
    <span class="coin" aria-hidden="true">
      {glyph ? (
        <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          {glyph}
        </svg>
      ) : (
        ticker.charAt(0)
      )}
    </span>
  );
}
