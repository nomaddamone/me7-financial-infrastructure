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
  return `<section><h2>${esc(s.h)}</h2>${paragraphs}${list}${steps}</section>`;
}

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
  const others = PAGES.filter((p) => p.id !== page.id);
  const cards = (list: Page[]) =>
    `<ul class="cards">${list.map((p) => `<li><a href="${pathOf(p, lang)}"><b>${esc(p[lang].h1)}</b><span>${esc(p[lang].card)}</span></a></li>`).join('')}</ul>`;
  const cta = `<div class="cta"><a class="btn" href="/">${esc(t.open)}</a><p>${esc(t.cta)}</p></div>`;

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
<meta property="og:type" content="${page.id === 'hub' ? 'website' : 'article'}">
<meta property="og:site_name" content="me7">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta property="og:locale" content="${lang === 'ru' ? 'ru_RU' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
${structured(page, lang)}
</head>
<body>
<header class="top">
<a class="brand" href="${hub}">me7<span>/about</span></a>
<nav><a href="${hub}">${esc(t.all)}</a><a href="${pathOf(page, other)}" hreflang="${other}" lang="${other}">${esc(t.other)}</a><a class="btn btn--small" href="/">${esc(t.open)}</a></nav>
</header>
<main>
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
${cta}
${page.id === 'hub' ? `<section><h2>${esc(t.all)}</h2>${cards(PAGES)}</section>` : ''}
${c.sections.map(section).join('\n')}
<section id="faq"><h2>${esc(t.questions)}</h2>${c.faq.map((item) => `<h3>${esc(item.q)}</h3><p>${esc(item.a)}</p>`).join('')}</section>
${cta}
${page.id === 'hub' ? '' : `<section><h2>${esc(t.more)}</h2>${cards(others)}</section>`}
</main>
<footer>
<p>${esc(t.foot)}</p>
<p><a href="/">me7.network</a> · <a href="${hub}">${esc(t.all)}</a> · <a href="${SOURCE}" rel="noopener">${esc(t.source)}</a></p>
</footer>
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
  return [
    `<meta name="description" content="${esc(c.description)}" />`,
    `<link rel="canonical" href="${ORIGIN}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="me7" />`,
    `<meta property="og:title" content="me7 — financial infrastructure" />`,
    `<meta property="og:description" content="${esc(c.description)}" />`,
    `<meta property="og:url" content="${ORIGIN}/" />`,
    `<meta property="og:image" content="${ORIGIN}/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="icon" href="/favicon.png" type="image/png" />`,
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
  return [...pages, { fileName: 'sitemap.xml', source: siteMap() }, { fileName: 'robots.txt', source: ROBOTS }];
}
