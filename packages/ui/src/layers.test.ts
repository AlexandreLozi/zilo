// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { openNativeLayers } from './layers.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('openNativeLayers', () => {
  it('records the open dialogs, in light DOM and open shadow roots, and no closed one', () => {
    document.body.innerHTML = '<dialog id="open" open></dialog><dialog id="closed"></dialog>';
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<dialog open></dialog>';
    document.body.append(host);
    const shadowDialog = root.querySelector('dialog');
    const open = document.querySelector('#open');
    const closed = document.querySelector('#closed');
    if (!shadowDialog || !open || !closed) throw new Error('fixture');

    const record = openNativeLayers(document);
    expect(record.has(open)).toBe(true);
    expect(record.has(shadowDialog)).toBe(true);
    expect(record.has(closed)).toBe(false);
  });

  it('is a record of the moment it was taken: a dialog opened later is not in it', () => {
    document.body.innerHTML = '<dialog id="later"></dialog>';
    const later = document.querySelector('dialog');
    if (!later) throw new Error('fixture');
    const record = openNativeLayers(document);
    later.setAttribute('open', '');
    expect(record.has(later)).toBe(false);
  });
});
