import { useCallback, useEffect, useState } from 'preact/hooks';
import { wipe } from '../core/index.ts';
import { readPayAskHash } from '../core/payrequest.ts';
import { PayPage } from './paypage.tsx';
import { SoundCheck } from './soundcheck.tsx';
import { Register, SignIn, type Picked } from './auth.tsx';
import { coldAddress, ColdHome, LedgerConnect, type ColdSession } from './cold.tsx';
import { Backdrop } from './fx.tsx';
import { Header, type Section } from './header.tsx';
import { dicts, type Lang } from './i18n.ts';
import { Home } from './home.tsx';
import { LOGO_ONLY, Welcome } from './screens.tsx';
import { Trading } from './trading.tsx';
import { closeWallet, forgetPassword, openWallet, type Wallet } from './wallet.ts';

type Screen = 'welcome' | 'register' | 'signin' | 'reissue' | 'home' | 'ledger' | 'cold';

const LANGS: readonly Lang[] = ['ru', 'en'];

/** The interface language. Keys and secrets are never stored; notes about an account's addresses are (see the stores under src/app), and none about a vault's (src/app/quiet.ts). */
function loadLang(): Lang {
  try {
    const v = localStorage.getItem('me7.lang');
    if (LANGS.includes(v as Lang)) return v as Lang;
  } catch {
    /* storage unavailable: fall through to the browser language */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function App() {
  const [lang, setLang] = useState<Lang>(loadLang);
  const [screen, setScreen] = useState<Screen>('welcome');
  // Which part of the platform is shown. The account stays open underneath while another part is looked at.
  // The pages about the wallet link to its parts by name: me7.network/#trading opens that part.
  const [section, setSection] = useState<Section>(() => (location.hash === '#trading' ? 'trading' : 'finance'));
  const [wallet, setWallet] = useState<Wallet | null>(null);
  // A link that asks for a payment opens on the request itself, before anything of the wallet: the payer needs no account.
  const [asked, setAsked] = useState(() => readPayAskHash(location.hash));
  // me7.network/#sound: a measure of what sound gets from one device to another, for choosing the whisper's band.
  const [sounding, setSounding] = useState(() => location.hash === '#sound');
  const leaveAsked = () => {
    setAsked(null);
    setSounding(false);
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* the link stays in the address bar, which changes nothing */
    }
  };
  // A session opened with a Ledger instead of a key file: the device signs, nothing secret is in the page.
  const [cold, setCold] = useState<ColdSession | null>(null);
  // Master secret recovered from the spare key, held only until a new key file is issued.
  const [recovered, setRecovered] = useState<Uint8Array | null>(null);
  // A key file dropped on the start page, handed to the sign-in screen.
  const [dropped, setDropped] = useState<Picked | null>(null);
  const takeKeyFile = useCallback((file: Picked) => {
    setDropped(file);
    setScreen('signin');
  }, []);
  const t = dicts[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('me7.lang', lang);
    } catch {
      /* private mode: the choice just won't persist */
    }
  }, [lang]);

  const forget = () => {
    if (recovered) wipe(recovered);
    setRecovered(null);
    setDropped(null);
  };
  const enter = (phrase: string) => {
    setWallet(openWallet(phrase));
    forget();
    setScreen('home');
  };
  const exit = () => {
    if (wallet) closeWallet(wallet);
    forgetPassword();
    setWallet(null);
    if (cold) void cold.ledger.close();
    setCold(null);
    setSection('finance');
    forget();
    setScreen('welcome');
  };

  return (
    <>
      <Backdrop />
      <div class={section === 'trading' && screen === 'home' ? 'shell shell--wide' : 'shell'}>
        <Header
          t={t}
          lang={lang}
          screen={screen}
          section={section}
          address={screen === 'home' ? wallet?.evm : screen === 'cold' && cold ? coldAddress(cold) : undefined}
          hidden={LOGO_ONLY && screen === 'welcome'}
          onLang={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          onBrand={() => {
            // From another part of the platform the name leads back to the wallet, never out of the account.
            if (section !== 'finance') setSection('finance');
            else if (screen !== 'home' && screen !== 'cold') exit();
          }}
          onSection={setSection}
        />
        {section === 'trading' && (
          <main class="screen">
            {screen === 'home' && wallet ? (
              <Trading t={t} wallet={wallet} />
            ) : screen === 'cold' ? (
              <section class="panel">
                <h2 class="title">{t.trading.title}</h2>
                <p class="lead">{t.ledger.noTrading}</p>
                <button class="btn" onClick={() => setSection('finance')}>
                  {t.marketBack}
                </button>
              </section>
            ) : (
              <section class="panel">
                <h2 class="title">{t.trading.title}</h2>
                <p class="lead">{t.trading.signIn}</p>
                <button class="btn" onClick={() => setSection('finance')}>
                  {t.trading.toStart}
                </button>
              </section>
            )}
          </main>
        )}
        {section === 'market' && (
          <main class="screen">
            <section class="panel">
              <div class="kv">
                <h2 class="title">{t.marketTitle}</h2>
                <span class="tag">{t.soon}</span>
              </div>
              <p class="lead">{t.marketLead}</p>
              <button class="btn" onClick={() => setSection('finance')}>
                {t.marketBack}
              </button>
            </section>
          </main>
        )}
        {asked && (
          <main class="screen">
            <PayPage t={t} ask={asked} onLeave={leaveAsked} />
          </main>
        )}
        {sounding && (
          <main class="screen">
            <SoundCheck t={t} onLeave={leaveAsked} />
          </main>
        )}
        <main class="screen" key={screen} hidden={section !== 'finance' || !!asked || sounding}>
          {screen === 'welcome' && (
            <Welcome
              t={t}
              onCreate={() => setScreen('register')}
              onImport={() => setScreen('signin')}
              onLedger={() => setScreen('ledger')}
              onKeyFile={takeKeyFile}
            />
          )}
          {screen === 'register' && <Register t={t} onDone={enter} onBack={exit} />}
          {screen === 'signin' && (
            <SignIn
              t={t}
              initial={dropped}
              onDone={enter}
              onBack={exit}
              onRecover={(entropy) => {
                setRecovered(entropy);
                setScreen('reissue');
              }}
            />
          )}
          {screen === 'reissue' && recovered && (
            <Register
              t={t}
              entropy={recovered}
              onDone={enter}
              onBack={() => {
                forget();
                setScreen('signin');
              }}
            />
          )}
          {screen === 'home' && wallet && <Home t={t} wallet={wallet} onExit={exit} />}
          {screen === 'ledger' && (
            <LedgerConnect
              t={t}
              onBack={exit}
              onDone={(session) => {
                setCold(session);
                setScreen('cold');
              }}
            />
          )}
          {screen === 'cold' && cold && <ColdHome t={t} session={cold} onSession={setCold} onExit={exit} />}
        </main>
      </div>
    </>
  );
}
