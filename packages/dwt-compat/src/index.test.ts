import { describe, expect, it } from 'vitest';

describe('@zilo/dwt-compat', () => {
  it('is an empty stub until the owner integration code arrives', async () => {
    const mod: Record<string, unknown> = await import('./index.js');
    expect(Object.keys(mod)).toEqual([]);
  });
});
