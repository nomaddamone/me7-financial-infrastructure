import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  base: './',
  plugins: [csp()],
  build: { target: 'es2022', sourcemap: false },
  // In development the relay runs beside the dev server (node dist-relay/relay.mjs) and is reached the same way as on the site.
  server: { port: 5173, strictPort: true, proxy: { '/relay': 'http://127.0.0.1:8787', '/sync': 'http://127.0.0.1:8788' } },
});
