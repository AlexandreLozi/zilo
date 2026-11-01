/** A package as reported by `pnpm licenses list --json`. */
export interface PackageLicense {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
}

/** `pnpm licenses list --json` output: packages grouped by licence. */
export type PnpmLicenseReport = Readonly<Record<string, readonly PackageLicense[]>>;

export interface LicenseException {
  /** Exact `name@version`. */
  readonly package: string;
  /** Licence expression the exception was reviewed for. */
  readonly license: string;
  /** Pointer to the reviewed entry in `docs/legal/exceptions.md`. */
  readonly reference: string;
}

export interface LicensePolicy {
  readonly allowed: readonly string[];
  /** Licence id to justification; accepted only for packages outside the production graph. */
  readonly devOnlyAllowed: Readonly<Record<string, string>>;
  readonly exceptions: readonly LicenseException[];
}

export interface Violation {
  readonly package: string;
  readonly license: string;
  readonly reason: string;
}

/** Licence id prefixes that may never be allowlisted (exceptions are the only way through). */
const FORBIDDEN_PREFIXES = ['GPL-', 'AGPL-', 'LGPL-', 'SSPL-'];

const isForbidden = (id: string): boolean =>
  FORBIDDEN_PREFIXES.some((prefix) => id.toUpperCase().startsWith(prefix.toUpperCase()));

/** Throws if the policy tries to allowlist a copyleft licence outright. */
export function assertPolicySane(policy: LicensePolicy): void {
  const ids = [...policy.allowed, ...Object.keys(policy.devOnlyAllowed)];
  const bad = ids.filter(isForbidden);
  if (bad.length > 0) {
    throw new Error(
      `Licence policy must not allowlist ${bad.join(', ')}; use a reviewed exception.`,
    );
  }
  for (const exception of policy.exceptions) {
    if (!/^(@[^@/]+\/)?[^@/]+@\d/.test(exception.package)) {
      throw new Error(`Exception "${exception.package}" must name an exact name@version.`);
    }
  }
}

type Node =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'and' | 'or'; readonly left: Node; readonly right: Node };

/**
 * Parses a (simplified) SPDX licence expression. `WITH` clauses stay part of the licence id, so
 * `GPL-2.0-only WITH Classpath-exception-2.0` is one id that must itself be allowed.
 * Returns `undefined` for anything it cannot parse, which the gate treats as unknown.
 */
export function parseExpression(expression: string): Node | undefined {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];

  const parseAtom = (): Node | undefined => {
    const token = tokens[pos++];
    if (token === undefined || token === ')') return undefined;
    if (token === '(') {
      const inner = parseOr();
      return tokens[pos++] === ')' ? inner : undefined;
    }
    if (/^(AND|OR|WITH)$/i.test(token)) return undefined;
    let id = token;
    while (peek()?.toUpperCase() === 'WITH') {
      const exception = tokens[pos + 1];
      if (exception === undefined || exception === '(' || exception === ')') return undefined;
      id = `${id} WITH ${exception}`;
      pos += 2;
    }
    return { kind: 'id', id };
  };

  const parseBinary = (op: 'and' | 'or', next: () => Node | undefined) => (): Node | undefined => {
    let left = next();
    while (left && peek()?.toLowerCase() === op) {
      pos++;
      const right = next();
      if (!right) return undefined;
      left = { kind: op, left, right };
    }
    return left;
  };

  const parseAnd = parseBinary('and', parseAtom);
  const parseOr = parseBinary('or', parseAnd);

  const result = parseOr();
  return pos === tokens.length ? result : undefined;
}

function satisfies(node: Node, isAllowed: (id: string) => boolean): boolean {
  switch (node.kind) {
    case 'id':
      return isAllowed(node.id);
    case 'and':
      return satisfies(node.left, isAllowed) && satisfies(node.right, isAllowed);
    case 'or':
      return satisfies(node.left, isAllowed) || satisfies(node.right, isAllowed);
  }
}

function flatten(report: PnpmLicenseReport): { pkg: string; license: string }[] {
  return Object.values(report).flatMap((entries) =>
    entries.flatMap((entry) =>
      entry.versions.map((version) => ({
        pkg: `${entry.name}@${version}`,
        license: entry.license,
      })),
    ),
  );
}

/**
 * Checks every package in `fullReport` (production and development graph). Packages that also
 * appear in `prodReport` must satisfy `allowed`; development-only packages may also use
 * `devOnlyAllowed`. Unknown or unparsable licences always fail unless covered by an exception.
 */
export function evaluate(
  policy: LicensePolicy,
  fullReport: PnpmLicenseReport,
  prodReport: PnpmLicenseReport,
): Violation[] {
  assertPolicySane(policy);
  const prodPackages = new Set(flatten(prodReport).map(({ pkg }) => pkg));
  const allowed = new Set(policy.allowed);
  const devAllowed = new Set([...allowed, ...Object.keys(policy.devOnlyAllowed)]);

  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const { pkg, license } of [...flatten(fullReport), ...flatten(prodReport)]) {
    if (seen.has(pkg)) continue;
    seen.add(pkg);

    const exception = policy.exceptions.find((e) => e.package === pkg);
    if (exception) {
      if (exception.license !== license) {
        violations.push({
          package: pkg,
          license,
          reason: `exception was reviewed for "${exception.license}", not "${license}"`,
        });
      }
      continue;
    }

    const isProd = prodPackages.has(pkg);
    const ast = parseExpression(license);
    if (!ast) {
      violations.push({ package: pkg, license, reason: 'unknown or unparsable licence' });
    } else if (!satisfies(ast, (id) => (isProd ? allowed : devAllowed).has(id))) {
      violations.push({
        package: pkg,
        license,
        reason: isProd
          ? 'licence not allowed in the production dependency graph'
          : 'licence not allowed',
      });
    }
  }
  return violations.sort((a, b) => a.package.localeCompare(b.package));
}
