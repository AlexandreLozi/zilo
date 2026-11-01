import { describe, expect, it } from 'vitest';
import { mount } from './app.js';
import { specimens } from './specimens.js';
import { catalogStates } from './states.js';

describe('catalog', () => {
  it('has a specimen for every state', () => {
    expect(Object.keys(specimens).sort()).toEqual(catalogStates.map((s) => s.id).sort());
  });

  it('renders the index with a light and dark link per state', () => {
    const root = document.createElement('div');
    mount(root, '');
    expect(root.querySelector('h1')?.textContent).toBe('Zilo component catalog');
    expect(root.querySelectorAll('a')).toHaveLength(catalogStates.length * 2);
  });

  it('renders a state and themes only the outermost Zilo elements', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, '?state=dialog-open&theme=dark');
    const dialog = root.querySelector('zilo-dialog');
    expect(dialog?.getAttribute('theme')).toBe('dark');
    expect(root.querySelector('#dialog-save')?.hasAttribute('theme')).toBe(false);
    expect(document.body.className).toBe('theme-dark');
    dialog?.close();
    root.remove();
  });
});
