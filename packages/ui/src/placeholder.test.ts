// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZiloPlaceholder } from './index.js';

describe('<zilo-placeholder>', () => {
  it('is registered and renders its label in the shadow root', () => {
    expect(customElements.get('zilo-placeholder')).toBe(ZiloPlaceholder);

    const el = document.createElement('zilo-placeholder');
    el.setAttribute('label', 'Scan');
    document.body.append(el);

    expect(el.shadowRoot?.textContent).toBe('Scan');
    el.remove();
  });
});
