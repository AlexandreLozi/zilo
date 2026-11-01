import { describe, expect, it } from 'vitest';
import { darkPalette, lightPalette, publicColorProperties, tokensCss } from './tokens.js';

describe('design tokens', () => {
  it('matches the tokens.md contract for key colours', () => {
    expect(lightPalette.accent).toBe('#0e6f68');
    expect(darkPalette.accent).toBe('#4fd1c1');
    expect(lightPalette.focus).toBe('#2156d1');
    expect(darkPalette['border-strong']).toBe('#7a838e');
    expect(Object.keys(darkPalette)).toEqual(Object.keys(lightPalette));
  });

  it('resolves every public override with a private fallback', () => {
    expect(publicColorProperties).toContain('--zilo-color-accent');
    for (const prop of publicColorProperties) {
      const key = prop.replace('--zilo-color-', '');
      expect(tokensCss).toContain(`var(${prop}, var(--_${key}))`);
    }
  });

  it('never declares a public --zilo-* property itself', () => {
    expect(tokensCss).not.toMatch(/^\s*--zilo-[\w-]+\s*:/m);
  });

  it('has light, dark and auto themes plus reduced motion and forced colours', () => {
    expect(tokensCss).toContain(":host([theme='light'])");
    expect(tokensCss).toContain(":host([theme='dark'])");
    expect(tokensCss).toContain(":host([theme='auto'])");
    expect(tokensCss).toContain('prefers-color-scheme: dark');
    expect(tokensCss).toContain('prefers-reduced-motion: reduce');
    expect(tokensCss).toContain('forced-colors: active');
  });
});
