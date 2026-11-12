import { useEffect, useState } from 'preact/hooks';
import { NET, saveMode } from '../net/endpoints.ts';
import { fetchUsdPrices, type UsdPrices } from '../net/send.ts';
import type { Dict, Lang } from './i18n.ts';
import './header.css';

/**
 * The page header: the name on the left; on the right the network and the
 * language. Before signing in it also shows the going prices of two coins;
 * once signed in, the account's short address (tap to copy).
 */
const TICKER = ['btc', 'eth'] as const;

/** The parts of the platform. The word after "me7" in the header names the current one and switches between them. */
export type Section = 'finance' | 'trading' | 'market';
const SECTIONS: readonly { id: Section; soon?: boolean }[] = [{ id: 'finance' }, { id: 'trading' }, { id: 'market', soon: true }];
const PRICE_REFRESH_MS = 60_000;
const priceText = (value: number) =>
  value >= 1000
    ? `$${Math.round(value).toLocaleString('en-US')}`
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 })}`;

export function Header({
  t,
  lang,
  screen,
  section,
  address,
  hidden,
  onLang,
  onBrand,
  onSection,
}: {
  t: Dict;
  lang: Lang;
  screen: string;
  /** The account's address once signed in. */
  address?: string;
  hidden: boolean;
  onLang: () => void;
  onBrand: () => void;
  section: Section;
  onSection: (section: Section) => void;
}) {
  const [menu, setMenu] = useState(false);
  // The menu closes on Escape and on a click anywhere outside it.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element | null)?.closest?.('.hd-brand')) setMenu(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  const [copied, setCopied] = useState(false);
  const [prices, setPrices] = useState<UsdPrices | null>(null);
  const signedIn = Boolean(address);
  useEffect(() => {
    if (signedIn) return;
    let stale = false;
    const load = () =>
      fetchUsdPrices().then(
        (p) => {
          if (!stale) setPrices(p);
        },
        () => undefined,
      );
    void load();
    const id = setInterval(() => void load(), PRICE_REFRESH_MS);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [signedIn]);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <header class="top" hidden={hidden}>
      {/* The name leads back to the start page; inside the account it stays put so a stray click can't sign you out. */}
      <span class="hd-brand">
        <button class="brand" onClick={onBrand}>
          me7
        </button>
        <button class="hd-section" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          /{section}
          <span class="hd-section-mark" aria-hidden="true">
            {menu ? '▴' : '▾'}
          </span>
        </button>
        {menu && (
          <span class="hd-menu" role="menu">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                role="menuitemradio"
                aria-checked={item.id === section}
                class="hd-menu-item"
                onClick={() => {
                  onSection(item.id);
                  setMenu(false);
                }}
              >
                /{item.id}
                {item.soon && <span class="tab-soon">{t.soon}</span>}
              </button>
            ))}
          </span>
        )}
      </span>
      <span class="top-tools">
        {address ? (
          <button
            class="hd-chip"
            title={address}
            onClick={() => {
              navigator.clipboard?.writeText(address).then(
                () => setCopied(true),
                () => undefined,
              );
            }}
          >
            {copied ? t.copied : `${address.slice(0, 6)}…${address.slice(-4)}`}
          </button>
        ) : (
          prices && (
            <span class="hd-prices">
              {TICKER.map((id) => (
                <span key={id}>
                  <span class="dim">{id}</span> {priceText(prices[id])}
                </span>
              ))}
            </span>
          )
        )}
        {/*
          The app runs on real networks and offers no switch. A device left in test mode by an
          earlier version still shows it, with the way back (before signing in: it reloads the page).
        */}
        {NET.mode === 'testnet' &&
          (screen === 'welcome' ? (
            <button
              class="link"
              onClick={() => {
                saveMode('mainnet');
                location.reload();
              }}
            >
              {t.netTest}
            </button>
          ) : (
            <span class="mode-badge">{t.testBadge}</span>
          ))}
        <button class="link" onClick={onLang}>
          {lang === 'ru' ? 'en' : 'ru'}
        </button>
      </span>
    </header>
  );
}
