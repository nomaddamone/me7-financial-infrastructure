import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { frontPageHead, frontPageText, siteFiles } from './site/render.ts';
import { ALL_ENDPOINTS } from './src/net/endpoints.ts';

/**
 * Production builds get a strict Content-Security-Policy: only our own code and
 * styles, and network access only to the endpoints listed in src/net/endpoints.ts.
 * (The dev server needs inline styles and a websocket, so it is build-only.)
 */
function csp(): Plugin {
  const connect = [...new Set(ALL_ENDPOINTS.map((u) => new URL(u).origin))].join(' ');
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
    // 'self' is for me7's own relay and address-book store, served from the same site under /relay and /sync.
    `connect-src 'self' ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'me7-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/**
 * The public pages (site/): what search engines and link previews read. The front page gets
 * its description and, inside the wallet's own element, the text it shows before the wallet
 * starts; every other page is written out as plain HTML with no scripts.
 */
function publicPages(): Plugin {
  return {
    name: 'me7-public-pages',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<!--seo-->', frontPageHead()).replace('<!--pre-->', frontPageText()),
    generateBundle() {
      for (const file of siteFiles()) this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
      this.emitFile({ type: 'asset', fileName: 'site.css', source: readFileSync(new URL('./site/site.css', import.meta.url), 'utf8') });
    },
  };
}

/**
 * Every script and stylesheet the page loads is named with its hash in the page itself. The page is always
 * fetched afresh and is checked against the signed release; the files it names are kept by browsers for a
 * year. With the hash in the tag, a browser refuses a copy that differs from the one this release was built
 * with, wherever that copy came from.
 */
function integrity(): Plugin {
  return {
    name: 'me7-integrity',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        return html.replace(/<(script|link)\b([^>]*?)\b(src|href)="\.\/(assets\/[^"]+)"([^>]*)>/g, (tag, name: string, before: string, attr: string, file: string, after: string) => {
          const item = bundle[file];
          if (!item || /\bintegrity=/.test(tag)) return tag;
          const source = item.type === 'chunk' ? item.code : item.source;
          const hash = createHash('sha384').update(source).digest('base64');
          return `<${name}${before}${attr}="./${file}" integrity="sha384-${hash}"${after}>`;
        });
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [csp(), publicPages(), integrity()],
  build: { target: 'es2022', sourcemap: false },
  // In development the relay runs beside the dev server (node dist-relay/relay.mjs) and is reached the same way as on the site.
  server: { port: 5173, strictPort: true, proxy: { '/relay': 'http://127.0.0.1:8787', '/sync': 'http://127.0.0.1:8788' } },
});
