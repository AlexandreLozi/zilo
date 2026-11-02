// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZiloBanner, ZiloButton, ZiloProgress, ZiloSpinner, defineZiloElements } from './index.js';

function inner(host: Element, selector: string): HTMLElement {
  const el = host.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('registration', () => {
  it('defines every element once and tolerates repeated calls', () => {
    defineZiloElements();
    expect(customElements.get('zilo-button')).toBe(ZiloButton);
    expect(customElements.get('zilo-banner')).toBe(ZiloBanner);
    expect(customElements.get('zilo-progress')).toBe(ZiloProgress);
    expect(customElements.get('zilo-spinner')).toBe(ZiloSpinner);
  });
});

describe('<zilo-button>', () => {
  it('reflects properties to attributes and the inner button', () => {
    const el = document.createElement('zilo-button');
    el.textContent = 'Scan';
    document.body.append(el);
    expect(el.variant).toBe('secondary');
    el.variant = 'primary';
    el.size = 'sm';
    el.theme = 'dark';
    expect(el.getAttribute('variant')).toBe('primary');
    expect(el.getAttribute('size')).toBe('sm');
    expect(el.getAttribute('theme')).toBe('dark');

    const button = inner(el, 'button') as HTMLButtonElement;
    expect(button.type).toBe('button');
    el.disabled = true;
    expect(button.disabled).toBe(true);
    el.disabled = false;
    el.busy = true;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    el.label = 'Refresh';
    expect(button.getAttribute('aria-label')).toBe('Refresh');
  });

  it('delegates focus and suppresses clicks while busy or disabled', () => {
    const el = document.createElement('zilo-button');
    document.body.append(el);
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    const button = inner(el, 'button') as HTMLButtonElement;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    el.busy = true;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    el.busy = false;
    el.focus();
    expect(el.shadowRoot?.activeElement).toBe(button);
  });

  it('replays a property set before upgrade', () => {
    const pre = document.createElement('zilo-button-pre');
    (pre as unknown as { variant: string }).variant = 'danger';
    document.body.append(pre);
    customElements.define('zilo-button-pre', class extends ZiloButton {});
    expect(pre.getAttribute('variant')).toBe('danger');
  });
});

describe('<zilo-banner>', () => {
  it('picks live semantics from the variant, overridable with live', () => {
    const el = document.createElement('zilo-banner');
    document.body.append(el);
    const banner = inner(el, '[part="banner"]');
    expect(banner.hasAttribute('role')).toBe(false);
    el.variant = 'danger';
    expect(banner.getAttribute('role')).toBe('alert');
    el.variant = 'success';
    expect(banner.getAttribute('role')).toBe('status');
    el.live = 'off';
    expect(banner.hasAttribute('role')).toBe(false);
    expect(inner(el, '[part="icon"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('fires a cancelable zilo-dismiss and hides unless prevented', () => {
    const el = document.createElement('zilo-banner');
    el.dismissible = true;
    document.body.append(el);
    const dismiss = inner(el, '[part="dismiss"]') as HTMLButtonElement;
    expect(dismiss.hidden).toBe(false);
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    const prevent = (e: Event): void => {
      e.preventDefault();
    };
    el.addEventListener('zilo-dismiss', prevent);
    dismiss.click();
    expect(el.hidden).toBe(false);
    el.removeEventListener('zilo-dismiss', prevent);
    dismiss.click();
    expect(el.hidden).toBe(true);
  });
});

describe('<zilo-progress> and <zilo-spinner>', () => {
  it('omits aria-valuenow while indeterminate and clamps the value', () => {
    const el = document.createElement('zilo-progress');
    el.label = 'Scan progress';
    document.body.append(el);
    const bar = inner(el, '[role="progressbar"]');
    expect(bar.getAttribute('aria-label')).toBe('Scan progress');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    el.max = 6;
    el.value = 9;
    expect(bar.getAttribute('aria-valuenow')).toBe('6');
    expect(bar.getAttribute('aria-valuemax')).toBe('6');
    el.valueText = 'Scanning page 3…';
    expect(bar.getAttribute('aria-valuetext')).toBe('Scanning page 3…');
    el.value = null;
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('names the spinner and can show its label', () => {
    const el = document.createElement('zilo-spinner');
    document.body.append(el);
    const role = inner(el, '[role="progressbar"]');
    expect(role.getAttribute('aria-label')).toBe('Loading');
    el.label = 'Looking for scanners…';
    el.visibleLabel = true;
    const label = inner(el, '[part="label"]');
    expect(label.textContent).toBe('Looking for scanners…');
    expect(label.classList.contains('visually-hidden')).toBe(false);
  });
});
