import { describe, expect, it } from 'vitest';
import { mount } from './app.js';

describe('demo app', () => {
  it('renders the heading and a <zilo-button> with the SDK version', () => {
    const root = document.createElement('main');
    mount(root);

    expect(root.querySelector('h1')?.textContent).toBe('Zilo demo');
    const button = root.querySelector('zilo-button');
    expect(button?.shadowRoot?.querySelector('button')).toBeTruthy();
    expect(button?.textContent).toMatch(/^Zilo SDK v\d+\.\d+\.\d+/);
  });
});
