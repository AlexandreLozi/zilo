// Runs `pnpm licenses list` for the whole workspace and fails on any licence the policy does not
// allow. Usage: `pnpm licenses` from the repository root.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluate, type LicensePolicy, type PnpmLicenseReport } from './gate.ts';

const policy = JSON.parse(
  readFileSync(new URL('../policy.json', import.meta.url), 'utf8'),
) as LicensePolicy;

function report(prod: boolean): PnpmLicenseReport {
  // When started by pnpm, reuse the same pnpm binary; otherwise fall back to PATH.
  const pnpm = process.env['npm_execpath'];
  const args = ['licenses', 'list', '--json', '--recursive', ...(prod ? ['--prod'] : [])];
  const output =
    pnpm && /pnpm/.test(pnpm)
      ? execFileSync(process.execPath, [pnpm, ...args], { encoding: 'utf8', cwd: '../..' })
      : execFileSync('pnpm', args, { encoding: 'utf8', cwd: '../..' });
  // With no third-party packages in scope, pnpm prints a plain sentence instead of `{}`.
  if (/^No licenses in packages found/.test(output.trim())) return {};
  return JSON.parse(output) as PnpmLicenseReport;
}

const full = report(false);
const prod = report(true);
const violations = evaluate(policy, full, prod);
const total = new Set(
  Object.values(full).flatMap((entries) => entries.map((e) => `${e.name}@${e.versions.join()}`)),
).size;

if (violations.length > 0) {
  console.error(`Licence gate FAILED: ${String(violations.length)} package(s) not allowed.`);
  for (const v of violations) console.error(`  ${v.package}  [${v.license}]  ${v.reason}`);
  console.error('Fix the dependency, or record a reviewed exception (docs/legal/exceptions.md).');
  process.exitCode = 1;
} else {
  const counts = Object.entries(full)
    .map(([license, entries]) => `${license}: ${String(entries.length)}`)
    .join(', ');
  console.log(`Licence gate passed for ${String(total)} package(s) (${counts}).`);
}
