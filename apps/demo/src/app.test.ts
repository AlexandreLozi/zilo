import { describe, expect, it } from 'vitest';
import { mount } from './app.js';

describe('demo app', () => {
  it('renders the heading and a <zilo-placeholder> with the SDK version', () => {
    const root = document.createElement('main');
    mount(root);

    expect(root.querySelector('h1')?.textContent).toBe('Zilo demo');
    const placeholder = root.querySelector('zilo-placeholder');
    expect(placeholder?.shadowRoot?.textContent).toMatch(/^Zilo SDK v\d+\.\d+\.\d+/);
  });
});
