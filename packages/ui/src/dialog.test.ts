// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZiloDialog } from './index.js';
import { scrollLockCount } from './scroll-lock.js';
import { focused, press } from './test/helpers.js';

function setup(inner = ''): { opener: HTMLButtonElement; dialog: ZiloDialog } {
  document.body.innerHTML = `
    <button id="opener">Open</button>
    <zilo-dialog heading="Remove access?">
      <p>Body text.</p>
      <input id="name" aria-label="Name" />
      ${inner}
      <zilo-button slot="footer" id="cancel">Cancel</zilo-button>
      <zilo-button slot="footer" id="ok" variant="primary">OK</zilo-button>
    </zilo-dialog>`;
  const opener = document.querySelector<HTMLButtonElement>('#opener');
  const dialog = document.querySelector('zilo-dialog');
  if (!opener || !dialog) throw new Error('fixture');
  opener.focus();
  return { opener, dialog };
}

function nativeDialog(dialog: ZiloDialog): HTMLDialogElement {
  const native = dialog.shadowRoot?.querySelector('dialog');
  if (!native) throw new Error('no native dialog');
  return native;
}

function idOf(el: Element | null): string | null {
  if (!el) return null;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? `${root.host.id}>${el.tagName.toLowerCase()}` : el.id;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<zilo-dialog>', () => {
  it('is registered and exposes dialog semantics', () => {
    const { dialog } = setup();
    expect(customElements.get('zilo-dialog')).toBe(ZiloDialog);
    dialog.show();
    const native = nativeDialog(dialog);
    expect(native.open).toBe(true);
    expect(native.getAttribute('aria-modal')).toBe('true');
    const headingId = native.getAttribute('aria-labelledby') ?? '';
    expect(dialog.shadowRoot?.getElementById(headingId)?.textContent).toBe('Remove access?');
    expect(native.hasAttribute('role')).toBe(false);
    expect(native.hasAttribute('aria-describedby')).toBe(false);
  });

  it('uses alertdialog and a description when asked', () => {
    const { dialog } = setup();
    dialog.alert = true;
    dialog.description = 'The site can no longer scan.';
    dialog.show();
    const native = nativeDialog(dialog);
    expect(native.getAttribute('role')).toBe('alertdialog');
    const descId = native.getAttribute('aria-describedby') ?? '';
    expect(dialog.shadowRoot?.getElementById(descId)?.textContent).toBe(
      'The site can no longer scan.',
    );
  });

  it('focuses the first content tab stop, or [autofocus], on open', () => {
    const { dialog } = setup();
    dialog.show();
    expect(idOf(focused())).toBe('name');
    dialog.close();

    const second = setup('<button id="auto" autofocus>Auto</button>');
    second.dialog.show();
    expect(idOf(focused())).toBe('auto');
  });

  it('traps Tab and Shift+Tab, wrapping at both ends', () => {
    const { dialog } = setup();
    dialog.show();
    // Order: close button, #name, Cancel, OK.
    expect(idOf(focused())).toBe('name');
    press('Tab');
    expect(idOf(focused())).toBe('cancel>button');
    press('Tab');
    expect(idOf(focused())).toBe('ok>button');
    press('Tab');
    expect(focused()?.getAttribute('part')).toBe('close-button');
    press('Tab', { shiftKey: true });
    expect(idOf(focused())).toBe('ok>button');
  });

  it('closes on Escape, fires cancel then close, and returns focus to the opener', () => {
    const { opener, dialog } = setup();
    const events: string[] = [];
    dialog.addEventListener('zilo-cancel', (e) => events.push(`cancel:${e.detail.reason}`));
    dialog.addEventListener('zilo-close', (e) => events.push(`close:${e.detail.reason}`));
    dialog.show();
    const keydown = press('Escape');
    expect(keydown.defaultPrevented).toBe(true);
    expect(events).toEqual(['cancel:escape', 'close:escape']);
    expect(dialog.open).toBe(false);
    expect(nativeDialog(dialog).open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('stays open when zilo-cancel is prevented', () => {
    const { dialog } = setup();
    dialog.addEventListener('zilo-cancel', (e) => {
      e.preventDefault();
    });
    dialog.show();
    press('Escape');
    expect(dialog.open).toBe(true);
    dialog.shadowRoot?.querySelector<HTMLButtonElement>('[part="close-button"]')?.click();
    expect(dialog.open).toBe(true);
  });

  it('closes from the close button with its reason', () => {
    const { dialog } = setup();
    const onClose = vi.fn();
    dialog.addEventListener('zilo-close', (e) => {
      onClose(e.detail.reason);
    });
    dialog.show();
    const close = dialog.shadowRoot?.querySelector<HTMLButtonElement>('[part="close-button"]');
    expect(close?.getAttribute('aria-label')).toBe('Close');
    close?.click();
    expect(onClose).toHaveBeenCalledWith('close-button');
  });

  it('falls back to returnFocus when the opener is gone', () => {
    const { opener, dialog } = setup();
    const fallback = document.createElement('button');
    document.body.append(fallback);
    dialog.returnFocus = fallback;
    dialog.show();
    opener.remove();
    dialog.close();
    expect(document.activeElement).toBe(fallback);
  });

  it('locks page scroll while open, reference-counted', () => {
    const { dialog } = setup();
    const before = scrollLockCount();
    dialog.open = true;
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(scrollLockCount()).toBe(before + 1);
    dialog.open = false;
    expect(scrollLockCount()).toBe(before);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('has polite and assertive live regions before any message', async () => {
    const { dialog } = setup();
    const regions = dialog.shadowRoot?.querySelectorAll('[aria-live]') ?? [];
    expect([...regions].map((r) => r.getAttribute('aria-live'))).toEqual(['polite', 'assertive']);
    expect([...regions].every((r) => r.getAttribute('aria-atomic') === 'true')).toBe(true);
    dialog.show();
    vi.useFakeTimers();
    dialog.announce('Page 3 scanned');
    vi.runAllTimers();
    vi.useRealTimers();
    await Promise.resolve();
    expect(regions[0]?.textContent).toBe('Page 3 scanned');
  });

  it('makes the page inert in the fallback when showModal is missing', () => {
    const { opener, dialog } = setup();
    const proto = HTMLDialogElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'showModal');
    // Simulate a browser without top-layer dialogs.
    Object.defineProperty(proto, 'showModal', { value: undefined, configurable: true });
    try {
      dialog.show();
      expect(opener.inert).toBe(true);
      expect(nativeDialog(dialog).hasAttribute('open')).toBe(true);
      dialog.close();
      expect(opener.inert).toBe(false);
    } finally {
      if (original) Object.defineProperty(proto, 'showModal', original);
    }
  });

  it('opens when connected with the open attribute and closes when removed', () => {
    const before = scrollLockCount();
    const dialog = document.createElement('zilo-dialog');
    dialog.setAttribute('open', '');
    dialog.heading = 'Late';
    document.body.append(dialog);
    expect(nativeDialog(dialog).open).toBe(true);
    dialog.remove();
    expect(scrollLockCount()).toBe(before);
  });
});
