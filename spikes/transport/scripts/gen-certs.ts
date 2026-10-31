// Generates a throwaway local CA and a leaf for the test origins (app.zilo.test, evil.zilo.test).
// Output goes to spikes/transport/.certs (gitignored). Keys are created per run and never committed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { CERT_DIR, APP_HOST, EVIL_HOST } from '../config.ts';

export interface CertMeta {
  caCert: string;
  leafCert: string;
  leafKey: string;
  leafSpkiSha256: string;
  firefoxPolicies: string;
  hosts: string[];
}

const openssl = (args: string[], input?: string): string =>
  execFileSync('openssl', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

export function ensureCerts(force = false): CertMeta {
  const metaPath = `${CERT_DIR}/meta.json`;
  if (!force && existsSync(metaPath)) return JSON.parse(readFileSync(metaPath, 'utf8')) as CertMeta;
  mkdirSync(CERT_DIR, { recursive: true });
  const p = (f: string) => `${CERT_DIR}/${f}`;

  openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('ca.key')]);
  openssl([
    'req', '-x509', '-new', '-key', p('ca.key'), '-sha256', '-days', '30',
    '-subj', '/CN=Zilo SP-1a throwaway test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-out', p('ca.pem'),
  ]);

  openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('leaf.key')]);
  openssl(['req', '-new', '-key', p('leaf.key'), '-subj', `/CN=${APP_HOST}`, '-out', p('leaf.csr')]);
  writeFileSync(p('leaf.ext'), [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=DNS:${APP_HOST},DNS:${EVIL_HOST}`,
    '',
  ].join('\n'));
  openssl([
    'x509', '-req', '-in', p('leaf.csr'), '-CA', p('ca.pem'), '-CAkey', p('ca.key'),
    '-CAcreateserial', '-days', '30', '-sha256', '-extfile', p('leaf.ext'), '-out', p('leaf.pem'),
  ]);

  // SPKI pin for Chromium's --ignore-certificate-errors-spki-list (needs no root to install).
  const pub = openssl(['x509', '-in', p('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
  const spki = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: der }).toString('base64');

  // Playwright's Firefox honours PLAYWRIGHT_FIREFOX_POLICIES_JSON; the Certificates policy
  // installs the CA into the profile trust store without touching the OS.
  writeFileSync(p('firefox-policies.json'), JSON.stringify({
    policies: { Certificates: { Install: [p('ca.pem')] } },
  }, null, 2));

  const meta: CertMeta = {
    caCert: p('ca.pem'),
    leafCert: p('leaf.pem'),
    leafKey: p('leaf.key'),
    leafSpkiSha256: spki,
    firefoxPolicies: p('firefox-policies.json'),
    hosts: [APP_HOST, EVIL_HOST],
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const meta = ensureCerts(process.argv.includes('--force'));
  console.log(JSON.stringify(meta, null, 2));
}
