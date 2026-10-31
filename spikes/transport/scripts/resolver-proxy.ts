// Tiny HTTP/CONNECT proxy that resolves *.zilo.test (and loopback) to 127.0.0.1, for browsers
// without a host-resolver switch (Playwright WebKit). It needs no root, no hosts-file edit and no
// OS trust change. It only changes name resolution: the page URL, its origin, TLS and the
// mixed-content inputs stay exactly https://app.zilo.test:<port>. Anything else is refused.
import http from 'node:http';
import net from 'node:net';

import { PROXY_PORT } from './resolver-proxy-port.ts';
const allowed = (host: string) => host.endsWith('.zilo.test') || host === '127.0.0.1' || host === 'localhost';

const server = http.createServer((req, res) => {
  // Absolute-form request for plain HTTP through the proxy.
  let target: URL;
  try { target = new URL(req.url ?? ''); } catch { res.writeHead(400); return res.end('absolute-form only'); }
  if (!allowed(target.hostname)) { res.writeHead(403); return res.end('host not allowed by spike proxy'); }
  const up = http.request({
    host: '127.0.0.1', port: Number(target.port || 80), method: req.method,
    path: target.pathname + target.search, headers: req.headers,
  }, (upRes) => { res.writeHead(upRes.statusCode ?? 502, upRes.headers); upRes.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});

server.on('connect', (req, client, head) => {
  const [host, portStr] = (req.url ?? '').split(':');
  if (!host || !allowed(host)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const up = net.connect(Number(portStr || 443), '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
  });
  up.on('error', () => client.destroy());
  client.on('error', () => up.destroy());
});

server.listen(PROXY_PORT, '127.0.0.1', () => console.log(`[resolver-proxy] on 127.0.0.1:${PROXY_PORT}`));
