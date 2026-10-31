// Manual S1 trust-scope experiment helper (see docs/spikes/SP-1a.md, real-Safari script, step S1).
// Creates a root CA whose name constraints permit only 127.0.0.1 and localhost, plus two leaves:
//   in-scope.pem   SAN IP:127.0.0.1, DNS:localhost   -> should be trusted once the root is trusted
//   out-of-scope.pem SAN DNS:app.zilo.test           -> must be REJECTED if the trust store honours
//                                                        root name constraints
// Output: spikes/transport/.certs-s1 (gitignored). Never trust this root on a machine you use.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SPIKE_DIR } from '../config.ts';

const dir = `${SPIKE_DIR}.certs-s1`;
mkdirSync(dir, { recursive: true });
const p = (f: string) => `${dir}/${f}`;
const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

writeFileSync(p('ca.ext'), [
  'basicConstraints=critical,CA:TRUE,pathlen:0',
  'keyUsage=critical,keyCertSign,cRLSign',
  'nameConstraints=critical,permitted;IP:127.0.0.1/255.255.255.255,permitted;DNS:localhost',
  'subjectKeyIdentifier=hash',
  '',
].join('\n'));
openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('ca.key')]);
openssl(['req', '-new', '-key', p('ca.key'), '-subj', '/CN=Zilo SP-1a S1 name-constrained test CA', '-out', p('ca.csr')]);
openssl(['x509', '-req', '-in', p('ca.csr'), '-signkey', p('ca.key'), '-days', '7', '-sha256', '-extfile', p('ca.ext'), '-out', p('ca.pem')]);

for (const [name, san] of [['in-scope', 'IP:127.0.0.1,DNS:localhost'], ['out-of-scope', 'DNS:app.zilo.test']]) {
  writeFileSync(p(`${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p(`${name}.key`)]);
  openssl(['req', '-new', '-key', p(`${name}.key`), '-subj', `/CN=${name}`, '-out', p(`${name}.csr`)]);
  openssl(['x509', '-req', '-in', p(`${name}.csr`), '-CA', p('ca.pem'), '-CAkey', p('ca.key'), '-CAcreateserial', '-days', '7', '-sha256', '-extfile', p(`${name}.ext`), '-out', p(`${name}.pem`)]);
}
console.log(`S1 test material in ${dir}: ca.pem, in-scope.{pem,key}, out-of-scope.{pem,key}`);
