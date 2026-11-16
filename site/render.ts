import { backdropSvg } from './backdrop.ts';
import { HUB, PAGES, UI, type Content, type Lang, type Page, type Section } from './pages.ts';

/**
 * me7's public pages as files: plain HTML made at build time from site/pages.ts, with the
 * site map and robots.txt. The pages carry no scripts at all and their own strict policy,
 * so nothing on them can reach a key; the wallet itself lives at the site's root.
 */
export const ORIGIN = 'https://me7.network';
export const SOURCE = 'https://github.com/nomaddamone/me7-financial-infrastructure';
const LANGS: readonly Lang[] = ['en', 'ru'];

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Where a page lives: /en/ for the overview, /en/<slug>/ for the rest. */
export const pathOf = (page: Page, lang: Lang) => (page[lang].slug ? `/${lang}/${page[lang].slug}/` : `/${lang}/`);

function section(s: Section): string {
  const paragraphs = (s.p ?? []).map((text) => `<p>${esc(text)}</p>`).join('');
  const list = s.list ? `<ul>${s.list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
  const steps = s.steps ? `<ol>${s.steps.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>` : '';
  return `<section class="panel"><h2 class="title">${esc(s.h)}</h2>${paragraphs}${list}${steps}</section>`;
}

/** What the wallet does, in the order a newcomer asks about it: is it safe, who can see me, is it easy. */
const GROUPS: readonly { key: 'protect' | 'private' | 'easy'; ids: readonly string[] }[] = [
  { key: 'protect', ids: ['keyfile', 'vault', 'safesend', 'ledger', 'open'] },
  { key: 'private', ids: ['privacy', 'stealth'] },
  { key: 'easy', ids: ['gasless', 'tronless', 'names', 'batch', 'cashout'] },
];

/** The GitHub mark, as in the wallet's header. */
const GITHUB =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

/** The wallet's logo: outlined letters with light running along the outline (the motion is in site.css). */
const LOGO =
  '<p class="lg" aria-label="me7"><svg viewBox="0 0 230 104" aria-hidden="true"><text x="2" y="80">me7</text><text x="2" y="80" class="lg-run">me7</text><text x="2" y="80" class="lg-draw">me7</text></svg></p>';

/** Structured data for search engines. It is data, not a script: nothing here is ever run. */
function structured(page: Page, lang: Lang): string {
  const c = page[lang];
  const url = ORIGIN + pathOf(page, lang);
  const faq = {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: c.faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  };
  const about =
    page.id === 'hub'
      ? {
          '@type': 'SoftwareApplication',
          name: 'me7',
          url: `${ORIGIN}/`,
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Web',
          description: c.description,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        }
      : { '@type': 'Article', headline: c.h1, description: c.description, inLanguage: lang, mainEntityOfPage: url, publisher: { '@type': 'Organization', name: 'me7', url: `${ORIGIN}/` } };
  const data = { '@context': 'https://schema.org', '@graph': [about, faq] };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function renderPage(page: Page, lang: Lang): string {
  const c: Content = page[lang];
  const t = UI[lang];
  const other: Lang = lang === 'en' ? 'ru' : 'en';
  const url = ORIGIN + pathOf(page, lang);
  const hub = pathOf(HUB, lang);
  const isHub = page.id === 'hub';
  const row = (p: Page) => `<li><a class="cmd" href="${pathOf(p, lang)}"><b class="cmd-name">${esc(p[lang].h1)}</b><span>${esc(p[lang].card)}</span></a></li>`;
  // On the overview the features stand in three groups; on a feature's page the rest are listed plainly.
  const groups = GROUPS.map((g) => {
    const pages = g.ids.map((id) => PAGES.find((p) => p.id === id)).filter((p): p is Page => !!p && p.id !== page.id);
    return pages.length ? `<section class="panel"><h2 class="title">${esc(t.groups[g.key])}</h2><ul class="cmds">${pages.map(row).join('')}</ul></section>` : '';
  }).join('\n');
  const listed = new Set(GROUPS.flatMap((g) => g.ids));
  const rest = PAGES.filter((p) => !listed.has(p.id) && p.id !== page.id);
  const more = rest.length ? `<section class="panel"><h2 class="title">${esc(t.more)}</h2><ul class="cmds">${rest.map(row).join('')}</ul></section>` : '';
  // The way into the wallet, said the way the wallet's own first screen says it.
  const enter = `<ul class="cmds enter"><li><a class="cmd" href="/"><b class="cmd-name">open</b><span>${esc(t.open)}</span></a></li>${
    isHub ? '' : `<li><a class="cmd" href="${hub}"><b class="cmd-name">about</b><span>${esc(t.all)}</span></a></li>`
  }</ul>`;
  const faq = `<section class="panel" id="faq"><h2 class="title">${esc(t.questions)}</h2>${c.faq
    .map((item) => `<details class="qa"><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`)
    .join('')}</section>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0e0e0e">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${url}">
${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN + pathOf(page, l)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${ORIGIN + pathOf(page, 'en')}">
<meta property="og:type" content="${isHub ? 'website' : 'article'}">
<meta property="og:site_name" content="me7">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta property="og:locale" content="${lang === 'ru' ? 'ru_RU' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.png" type="image/png" sizes="96x96">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
${structured(page, lang)}
</head>
<body>
<div class="shell">
<header class="top">
<span class="hd-brand">
<a class="brand" href="/">me7</a>
<details class="hd-pick"><summary class="hd-section">/about<span class="hd-section-mark" aria-hidden="true">▾</span></summary>
<span class="hd-menu"><a class="hd-menu-item" href="/">/finance</a><a class="hd-menu-item" href="/#trading">/trading</a><span class="hd-menu-item hd-menu-item--off">/market<span class="tab-soon">${esc(t.soon)}</span></span><a class="hd-menu-item hd-menu-item--on" href="${hub}" aria-current="page">/about</a></span>
</details>
<a class="hd-source" href="${SOURCE}" rel="noopener" aria-label="${esc(t.source)}" title="${esc(t.source)}">${GITHUB}</a>
</span>
<span class="top-tools"><a class="link" href="${pathOf(page, other)}" hreflang="${other}" lang="${other}">${other}</a></span>
</header>
<main>
${
  isHub
    ? `<div class="hero">${LOGO}<p class="logo-sub">financial infrastructure</p><h1 class="tagline">${esc(c.h1)}</h1><p class="lead">${esc(c.lead)}</p></div>`
    : `<div class="hero hero--page"><p class="crumb"><a href="${hub}">me7/about</a></p><h1>${esc(c.h1)}</h1><p class="lead">${esc(c.lead)}</p></div>`
}
${enter}
${isHub ? groups + more : ''}
${c.sections.map(section).join('\n')}
${faq}
${isHub ? '' : `<h2 class="between">${esc(t.more)}</h2>\n${groups}${more}`}
${enter}
</main>
<footer>
<p>${esc(t.foot)}</p>
<p><a href="/">me7.network</a> · <a href="${hub}">${esc(t.all)}</a> · <a href="${SOURCE}" rel="noopener">${esc(t.source)}</a></p>
</footer>
</div>
</body>
</html>
`;
}

/** What the front page holds before the wallet starts: the same facts the wallet then shows, for readers that run no scripts. */
export function frontPageText(): string {
  const c = HUB.en;
  const links = [HUB, ...PAGES].flatMap((p) => LANGS.map((l) => `<li><a href="${pathOf(p, l)}" hreflang="${l}" lang="${l}">${esc(p[l].h1)}</a></li>`)).join('');
  return `<div class="pre"><h1>me7 — financial infrastructure. ${esc(c.h1)}</h1><p>${esc(c.lead)}</p><ul>${links}</ul></div>`;
}

/** The head of the front page: what search engines and link previews read. */
export function frontPageHead(): string {
  const c = HUB.en;
  const site = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'me7', alternateName: 'me7 — financial infrastructure', url: `${ORIGIN}/` };
  return [
    `<script type="application/ld+json">${JSON.stringify(site).replace(/</g, '\\u003c')}</script>`,
    `<meta name="description" content="${esc(c.description)}" />`,
    `<link rel="canonical" href="${ORIGIN}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="me7" />`,
    `<meta property="og:title" content="me7 — financial infrastructure" />`,
    `<meta property="og:description" content="${esc(c.description)}" />`,
    `<meta property="og:url" content="${ORIGIN}/" />`,
    `<meta property="og:image" content="${ORIGIN}/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="icon" href="/favicon.ico" sizes="48x48" />`,
    `<link rel="icon" href="/favicon.png" type="image/png" sizes="96x96" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
  ].join('\n    ');
}

export function siteMap(): string {
  const urls = [`${ORIGIN}/`, ...[HUB, ...PAGES].flatMap((p) => LANGS.map((l) => ORIGIN + pathOf(p, l)))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

/** Every file of the public pages, by its path inside the built site. */
export function siteFiles(): { fileName: string; source: string }[] {
  const pages = [HUB, ...PAGES].flatMap((p) => LANGS.map((l) => ({ fileName: `${pathOf(p, l).slice(1)}index.html`, source: renderPage(p, l) })));
  return [...pages, { fileName: 'sitemap.xml', source: siteMap() }, { fileName: 'robots.txt', source: ROBOTS }, { fileName: 'backdrop.svg', source: backdropSvg() }];
}
