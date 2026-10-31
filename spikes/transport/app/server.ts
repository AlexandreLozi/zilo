// SP-1a test-page server. Serves the same page over HTTPS for app.zilo.test (allowed origin) and
// evil.zilo.test (hostile origin), plus an HTTP control on a second port. The browsers map those
// names to this server (host-resolver-rules / Firefox DNS prefs / hosts file), so the page is never
// served from localhost. `/coop` serves the page with Cross-Origin-Opener-Policy: same-origin and
// `/coop-allow-popups` with same-origin-allow-popups. ZILO_LEAF_CERT/ZILO_LEAF_KEY override the leaf
// (used by the manual S1 trust-scope step in docs/spikes/SP-1a.md).
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PORT, APP_HOST, APP_HTTP_PORT, APP_HTTPS_PORT, EVIL_HOST, MAX_BRIDGE_BYTES,
} from '../config.ts';
import { ensureCerts } from '../scripts/gen-certs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const certs = ensureCerts();
const pageTemplate = readFileSync(`${here}/index.html`, 'utf8');
const appJs = readFileSync(`${here}/app.js`, 'utf8');

const httpsHosts = new Set([`${APP_HOST}:${APP_HTTPS_PORT}`, `${EVIL_HOST}:${APP_HTTPS_PORT}`]);
const httpHosts = new Set([`${APP_HOST}:${APP_HTTP_PORT}`, `127.0.0.1:${APP_HTTP_PORT}`]);

function handler(allowedHosts: Set<string>): http.RequestListener {
  return (req, res) => {
    const host = req.headers.host ?? '';
    const url = new URL(req.url ?? '/', 'http://page.invalid');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (!allowedHosts.has(host)) {
      res.writeHead(421, { 'Content-Type': 'text/plain' });
      return res.end('unknown host');
    }
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (url.pathname === '/app.js') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(appJs);
    }
    const coop: Record<string, string> = { '/coop': 'same-origin', '/coop-allow-popups': 'same-origin-allow-popups' };
    if (url.pathname === '/' || url.pathname in coop) {
      if (coop[url.pathname]) headers['Cross-Origin-Opener-Policy'] = coop[url.pathname];
      const cfg = { agentPort: AGENT_PORT, maxBridgeBytes: MAX_BRIDGE_BYTES, variant: url.pathname === '/' ? 'plain' : url.pathname.slice(1) };
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pageTemplate.replace('__ZILO_APP_CONFIG__', JSON.stringify(cfg)));
    }
    if (req.method === 'HEAD') { res.writeHead(404); return res.end(); }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
}

https
  .createServer({
    cert: readFileSync(process.env.ZILO_LEAF_CERT ?? certs.leafCert),
    key: readFileSync(process.env.ZILO_LEAF_KEY ?? certs.leafKey),
  }, handler(httpsHosts))
  .listen(APP_HTTPS_PORT, '127.0.0.1', () => console.log(`[app] https on 127.0.0.1:${APP_HTTPS_PORT} for ${[...httpsHosts].join(', ')}`));
http
  .createServer(handler(httpHosts))
  .listen(APP_HTTP_PORT, '127.0.0.1', () => console.log(`[app] http control on 127.0.0.1:${APP_HTTP_PORT}`));
