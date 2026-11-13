import { describe, expect, it } from 'vitest';
import { HUB, PAGES, type Lang } from '../site/pages.ts';
import { frontPageHead, frontPageText, ORIGIN, pathOf, renderPage, ROBOTS, siteFiles, siteMap } from '../site/render.ts';

const LANGS: Lang[] = ['en', 'ru'];
const all = [HUB, ...PAGES];

describe('the public pages', () => {
  it('have every page in both languages, each at an address of its own', () => {
    const paths = all.flatMap((p) => LANGS.map((l) => pathOf(p, l)));
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/(en|ru)\/([a-z0-9-]+\/)?$/);
    expect(siteFiles().filter((f) => f.fileName.endsWith('index.html'))).toHaveLength(paths.length);
  });

  it('give search results a title and a description of a sensible length', () => {
    for (const p of all) {
      for (const l of LANGS) {
        const c = p[l];
        expect(c.title.length, c.title).toBeGreaterThan(25);
        expect(c.title.length, c.title).toBeLessThanOrEqual(70);
        expect(c.description.length, c.title).toBeGreaterThan(90);
        expect(c.description.length, c.title).toBeLessThanOrEqual(180);
        expect(c.faq.length).toBeGreaterThan(1);
        if (p !== HUB) expect(c.card.length).toBeGreaterThan(20);
      }
    }
  });

  it('carry no script that runs, load nothing from elsewhere, and name each other in both languages', () => {
    for (const p of all) {
      for (const l of LANGS) {
        const html = renderPage(p, l);
        expect(html).toContain(`<html lang="${l}">`);
        // The only script element is data for search engines.
        expect(html.match(/<script/g)).toHaveLength(1);
        expect(html).toContain('<script type="application/ld+json">');
        expect(html).toContain("default-src 'none'");
        expect(html).not.toMatch(/(src|href)="(?!\/|https:\/\/(me7\.network|github\.com\/nomaddamone)\/)/);
        expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${pathOf(p, l)}">`);
        for (const other of LANGS) expect(html).toContain(`hreflang="${other}" href="${ORIGIN}${pathOf(p, other)}"`);
        JSON.parse(html.split('<script type="application/ld+json">')[1]!.split('</script>')[0]!);
      }
    }
  });

  it('say nothing the owner ruled out', () => {
    const text = siteFiles().map((f) => f.source).join('\n') + frontPageText() + frontPageHead();
    for (const word of [/ретранслятор/i, /\brelay/i, /anonymous wallet/i, /анонимный кошел/i, /we guarantee/i, /мы гарантируем/i]) expect(text).not.toMatch(word);
  });

  it('are listed in the site map, which robots.txt points to', () => {
    const map = siteMap();
    expect(map).toContain(`<loc>${ORIGIN}/</loc>`);
    for (const p of all) for (const l of LANGS) expect(map).toContain(`<loc>${ORIGIN}${pathOf(p, l)}</loc>`);
    expect(ROBOTS).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(frontPageText()).toContain(`href="${pathOf(PAGES[0]!, 'ru')}"`);
  });
});
