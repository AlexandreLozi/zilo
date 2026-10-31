import { describe, expect, it } from 'vitest';
import {
  assertPolicySane,
  evaluate,
  parseExpression,
  type LicensePolicy,
  type PnpmLicenseReport,
} from './gate.ts';

const policy: LicensePolicy = {
  allowed: ['MIT', 'Apache-2.0'],
  devOnlyAllowed: { 'MPL-2.0': 'build tooling only' },
  exceptions: [],
};

const pkg = (name: string, license: string, version = '1.0.0'): PnpmLicenseReport => ({
  [license]: [{ name, versions: [version], license }],
});

describe('licence gate', () => {
  it('passes permissive licences', () => {
    expect(evaluate(policy, pkg('a', 'MIT'), pkg('a', 'MIT'))).toEqual([]);
  });

  it.each(['GPL-3.0-only', 'AGPL-3.0-or-later', 'Unknown', '', 'MIT AND'])(
    'denies %j by default, even for dev-only packages',
    (license) => {
      expect(evaluate(policy, pkg('bad', license), {})).toHaveLength(1);
    },
  );

  it('evaluates SPDX OR/AND expressions', () => {
    expect(evaluate(policy, pkg('dual', '(MIT OR GPL-3.0-only)'), {})).toEqual([]);
    expect(evaluate(policy, pkg('both', 'MIT AND GPL-3.0-only'), {})).toHaveLength(1);
    expect(parseExpression('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual({
      kind: 'id',
      id: 'GPL-2.0-only WITH Classpath-exception-2.0',
    });
  });

  it('allows dev-only licences only outside the production graph', () => {
    expect(evaluate(policy, pkg('tool', 'MPL-2.0'), {})).toEqual([]);
    expect(evaluate(policy, pkg('lib', 'MPL-2.0'), pkg('lib', 'MPL-2.0'))).toHaveLength(1);
  });

  it('honours exceptions for the exact version and licence only', () => {
    const withException: LicensePolicy = {
      ...policy,
      exceptions: [{ package: 'x@1.0.0', license: 'GPL-3.0-only', reference: 'legal#x' }],
    };
    expect(evaluate(withException, pkg('x', 'GPL-3.0-only'), {})).toEqual([]);
    expect(evaluate(withException, pkg('x', 'GPL-3.0-only', '1.0.1'), {})).toHaveLength(1);
    expect(evaluate(withException, pkg('x', 'AGPL-3.0-only'), {})).toHaveLength(1);
  });

  it('refuses a policy that allowlists GPL or AGPL', () => {
    expect(() => {
      assertPolicySane({ ...policy, allowed: ['MIT', 'GPL-3.0-only'] });
    }).toThrow(/GPL-3.0-only/);
    expect(() => {
      assertPolicySane({ ...policy, devOnlyAllowed: { 'AGPL-3.0-only': 'no' } });
    }).toThrow(/AGPL/);
  });
});
