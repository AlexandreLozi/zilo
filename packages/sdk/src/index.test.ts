import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { version } from './index.js';

describe('@zilo/sdk', () => {
  it('exports a version that matches package.json', () => {
    expect(version).toBe(pkg.version);
  });
});
