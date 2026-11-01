// Builds the SP-1a results matrix (markdown) from committed evidence JSON:
//   evidence/<os>/<project>/<scenario>.json  ->  one row per scenario, one column per browser/OS.
// Usage: node scripts/matrix.ts > artifacts/matrix.md
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SPIKE_DIR } from '../config.ts';

interface Ev {
  scenario: string; outcome: string; browserVersion: string | null; project: string; os: string;
  observed: any; console?: string[];
}

/** A few words on what was observed, for rows where browsers legitimately differ. */
function note(ev: Ev): string {
  const o = ev.observed ?? {};
  const mixed = (ev.console ?? []).some((l) => l.includes('[blocked]') && l.includes('insecure content'));
  switch (ev.scenario) {
    case 'env':
      return String(o.addressSpace ?? '').startsWith('public') ? 'address space public (forced)' : 'secure context only; public address space **unproven**';
    case 'hello-tas': case 'hello-plain': case 'sse-fetch-stream': case 'blob':
      if (o.result?.ok) return o.result.incremental ? `200, spread ${o.result.spreadMs} ms` : '200';
      return mixed ? 'mixed-content blocked, never sent' : `${o.result?.error}`;
    case 'perm-prompt':
      if (o.hello?.timedOut) return 'held on prompt';
      if (o.after?.['loopback-network'] === 'denied') return 'headless auto-deny';
      return `query=${o.before?.['loopback-network']}; fetch ${mixed ? 'mixed-content blocked' : o.hello?.error}`;
    case 'perm-denied':
      return `query=${o.permissions?.['loopback-network']}; ${o.hello?.error}`;
    case 'neg-hostile-origin':
      return o.audit?.length ? 'agent 403 origin-denied' : (mixed ? 'browser-blocked (mixed content)' : 'not sent');
    case 'neg-forged-mint':
      return o.forged?.status ? `agent ${o.forged.status} ${o.forged.code}` : (mixed ? 'browser-blocked (mixed content)' : 'not sent');
    case 'neg-http-control':
      if (String(o.grant).startsWith('not grantable') && !o.hello?.ok) return 'LNA not grantable; blocked';
      return o.hello?.ok ? (o.grant === 'granted' ? 'reaches loopback after grant' : 'reaches loopback, no prompt') : 'blocked';
    case 'control-no-override':
      return o.hello?.ok ? 'no prompt, 200' : 'blocked';
    default:
      return '';
  }
}

const ROWS: Array<[string, string]> = [
  ['env', 'HTTPS page on a non-loopback hostname is a secure context (public address space only where forced)'],
  ['hello-tas', "fetch `hello` with `targetAddressSpace:'loopback'` (granted where grantable)"],
  ['hello-plain', 'fetch `hello` without the option (granted where grantable)'],
  ['sse-fetch-stream', 'SSE over fetch streaming with `Authorization`, 5 incremental ticks'],
  ['blob', '1 MiB binary over fetch'],
  ['perm-prompt', 'Permission **prompt** (default): never silently allowed'],
  ['perm-prompt-headful', 'Permission prompt, headful Chromium: request held on the real prompt'],
  ['perm-denied', 'Permission **denied**: refused fast'],
  ['s2-bridge', 'S2 bridge: handshake + typed `hello` + 1 MiB ArrayBuffer transfer + SSE relay + bounds'],
  ['s2-closure', 'S2 bridge: window closure detected'],
  ['s2-session-envelope', 'S2 envelope (fix r1): version, unique request ID and bound session required; mismatches refused'],
  ['s2-backpressure', 'S2 backpressure (fix r1): binary slot held until ack; stalled event consumer cut off'],
  ['s2-navigation-reconnect', 'S2 navigation/reload (fix r1): bound state invalidated; reload re-handshakes; reopen recovers'],
  ['s2-coop', 'S2 with COOP `same-origin`: explicit `coop-severed` failure, nothing minted'],
  ['s2-coop-allow-popups', 'S2 with COOP `same-origin-allow-popups`: bridge still works'],
  ['s2-hostile-opener', 'S2 hostile opener: no ready, forced hello rejected, nothing minted'],
  ['s2-wrong-source', 'S2 forged `bridge-ready` from the wrong window ignored'],
  ['s2-nonce-replay', 'S2 nonce replay refused by the agent (409)'],
  ['neg-hostile-origin', 'Negative: hostile HTTPS origin cannot read the agent'],
  ['neg-bad-host', 'Negative: DNS-rebinding Host refused (403 host-denied)'],
  ['neg-forged-mint', 'Negative: public page cannot mint a bridge capability'],
  ['neg-http-control', 'Control: HTTP (insecure) page → loopback (browser policy only)'],
  ['control-no-override', 'Method control: page on loopback address space is not LNA-gated'],
];

/** Rows added in T01 fix r1, after OD-6 stopped native Windows runs. */
const FIX_R1_ROWS = new Set(['s2-session-envelope', 's2-backpressure', 's2-navigation-reconnect']);

const COLUMNS: Array<[string, string, string]> = [
  ['linux', 'chromium', 'Chromium'],
  ['linux', 'firefox', 'Firefox'],
  ['linux', 'webkit', 'PW WebKit · Linux'],
  ['win32', 'webkit', 'PW WebKit · Windows'],
  ['darwin', 'webkit', 'PW WebKit · macOS'],
];

const load = (os: string, project: string, scenario: string): Ev | null => {
  const f = `${SPIKE_DIR}evidence/${os}/${project}/${scenario}.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Ev) : null;
};
const version = (os: string, project: string): string => {
  const dir = `${SPIKE_DIR}evidence/${os}/${project}`;
  if (!existsSync(dir)) return 'pending';
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) return (JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Ev).browserVersion ?? '?';
  }
  return 'pending';
};

const header = ['Scenario', ...COLUMNS.map(([os, p, label]) => `${label} ${version(os, p)}${os === 'win32' ? ' (observed before OD-6)' : ''}`), 'Real Safari 26'];
const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
for (const [scenario, title] of ROWS) {
  const cells = COLUMNS.map(([os, project]) => {
    const ev = load(os, project, scenario);
    if (!ev) return os === 'darwin' ? 'pending' : os === 'win32' && FIX_R1_ROWS.has(scenario) ? 'not run (OD-6)' : 'n/a';
    const path = `evidence/${os}/${project}/${scenario}`;
    const n = note(ev);
    return `${ev.outcome}${n ? ` · ${n}` : ''} ([json](../../spikes/transport/${path}.json))`;
  });
  lines.push(`| ${title} | ${cells.join(' | ')} | **pending** |`);
}
console.log(lines.join('\n'));
