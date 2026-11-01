// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { canReceiveFocus, tabbableElements } from './focus.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function ids(container: Element): string[] {
  return tabbableElements(container).map((el) => el.id);
}

describe('tabbableElements', () => {
  it('skips controls disabled by a fieldset, except inside its first legend', () => {
    document.body.innerHTML = `
      <div id="root">
        <button id="before">Before</button>
        <fieldset disabled>
          <legend><input id="in-legend" aria-label="Toggle" /></legend>
          <legend><input id="second-legend" aria-label="Second" /></legend>
          <input id="field" aria-label="Field" />
          <fieldset><button id="nested">Nested</button></fieldset>
        </fieldset>
        <button id="after">After</button>
      </div>`;
    const root = document.querySelector('#root');
    if (!root) throw new Error('fixture');
    expect(ids(root)).toEqual(['before', 'in-legend', 'after']);
    expect(canReceiveFocus(document.querySelector('#field'))).toBe(false);
    expect(canReceiveFocus(document.querySelector('#in-legend'))).toBe(true);
  });

  it('treats a fieldset nested in a disabled fieldset legend as enabled', () => {
    document.body.innerHTML = `
      <div id="root">
        <fieldset disabled>
          <legend><fieldset><input id="deep" aria-label="Deep" /></fieldset></legend>
        </fieldset>
      </div>`;
    const root = document.querySelector('#root');
    if (!root) throw new Error('fixture');
    expect(ids(root)).toEqual(['deep']);
  });

  it('skips disabled radios when choosing the group stop', () => {
    document.body.innerHTML = `
      <div id="root">
        <fieldset disabled><input type="radio" name="g" id="r1" aria-label="One" /></fieldset>
        <input type="radio" name="g" id="r2" aria-label="Two" />
        <input type="radio" name="g" id="r3" aria-label="Three" />
      </div>`;
    const root = document.querySelector('#root');
    if (!root) throw new Error('fixture');
    expect(ids(root)).toEqual(['r2']);
  });
});
