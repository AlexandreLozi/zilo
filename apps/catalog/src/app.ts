import '@zilo/ui';
import type { ZiloDialog } from '@zilo/ui';
import { specimens } from './specimens.js';
import {
  catalogStates,
  catalogThemes,
  stateUrl,
  type CatalogState,
  type CatalogTheme,
} from './states.js';

function parseTheme(value: string | null): CatalogTheme {
  return (catalogThemes as readonly string[]).includes(value ?? '')
    ? (value as CatalogTheme)
    : 'light';
}

function renderIndex(root: HTMLElement): void {
  const groups = new Map<string, CatalogState[]>();
  for (const state of catalogStates) {
    groups.set(state.component, [...(groups.get(state.component) ?? []), state]);
  }
  const sections = [...groups]
    .map(
      ([component, states]) => `
      <section aria-labelledby="h-${component}">
        <h2 id="h-${component}">${component}</h2>
        <ul>${states
          .map(
            (s) =>
              `<li>${s.title}: <a href="${stateUrl(s.id, 'light')}">light</a> · <a href="${stateUrl(s.id, 'dark')}">dark</a></li>`,
          )
          .join('')}</ul>
      </section>`,
    )
    .join('');
  root.innerHTML = `<main><h1>Zilo component catalog</h1>${sections}</main>`;
}

function wireDialog(root: HTMLElement): void {
  const dialog = root.querySelector<ZiloDialog>('zilo-dialog');
  if (!dialog) return;
  root.querySelector('#open-dialog')?.addEventListener('click', () => {
    dialog.show();
  });
  for (const id of ['#dialog-cancel', '#dialog-save']) {
    root.querySelector(id)?.addEventListener('click', () => {
      dialog.close();
    });
  }
  dialog.addEventListener('zilo-close', (event) => {
    document.body.dataset['lastClose'] = event.detail.reason;
  });
}

/** Renders the catalog page for `search` (`?state=…&theme=…`) into `root`. */
export function mount(root: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  const theme = parseTheme(params.get('theme'));
  document.body.className = `theme-${theme}`;
  const state = catalogStates.find((s) => s.id === params.get('state'));
  if (!state) {
    renderIndex(root);
    return;
  }
  document.title = `${state.component}: ${state.title} (${theme}) · Zilo catalog`;
  root.innerHTML = `
    <main>
      <p><a href="/">All components</a></p>
      <h1>${state.component}: ${state.title} <span class="theme-tag">(${theme})</span></h1>
      <div class="specimen" data-state="${state.id}">${specimens[state.id]}</div>
    </main>`;
  // Theme only the outermost Zilo elements; nested ones inherit (tokens.md §2).
  for (const el of root.querySelectorAll('.specimen > *, .specimen > * > *')) {
    if (el.tagName.startsWith('ZILO-') && !el.parentElement?.closest('zilo-dialog, zilo-banner')) {
      el.setAttribute('theme', theme);
    }
  }
  wireDialog(root);
}
