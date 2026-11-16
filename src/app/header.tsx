import { useEffect, useState } from 'preact/hooks';
import { NET, saveMode, SOURCE_URL } from '../net/endpoints.ts';
import { fetchUsdPrices, type UsdPrices } from '../net/send.ts';
import type { Dict, Lang } from './i18n.ts';
import { useOwnName } from './ownname.ts';
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
  // The name registered for this address, if there is one: shown in the middle, copied by a tap like the address.
  const ownName = useOwnName(address);
  const [nameCopied, setNameCopied] = useState(false);
  useEffect(() => {
    if (!nameCopied) return;
    const id = setTimeout(() => setNameCopied(false), 1200);
    return () => clearTimeout(id);
  }, [nameCopied]);
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
            {/* The fourth part is the public pages about the wallet: plain pages of their own, in this language. */}
            <a class="hd-menu-item" role="menuitem" href={`/${lang}/`}>
              /about
            </a>
          </span>
        )}
        {/* The source code, one click away from the name. */}
        <a class="hd-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" aria-label={t.sourceCode} title={t.sourceCode}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
        </a>
      </span>
      {address && ownName && (
        <button
          class="hd-name"
          title={`${t.copy}: ${ownName}`}
          onClick={() => {
            navigator.clipboard?.writeText(ownName).then(
              () => setNameCopied(true),
              () => undefined,
            );
          }}
        >
          {nameCopied ? (
            <span class="hd-name-main">{t.copied}</span>
          ) : (
            <>
              <span class="hd-name-main">{ownName.replace(/\.base\.eth$/, '')}</span>
              {ownName.endsWith('.base.eth') && <span class="hd-name-end">.base.eth</span>}
            </>
          )}
        </button>
      )}
      <span class="top-tools">
        {address ? (
          <button
            class="hd-chip"
            title={`${t.copy}: ${address}`}
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
