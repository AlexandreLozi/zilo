import { version } from '@zilo/sdk';
import '@zilo/ui';

/** Renders the placeholder demo into `root`. */
export function mount(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Zilo demo';

  const placeholder = document.createElement('zilo-placeholder');
  placeholder.setAttribute('label', `Zilo SDK v${version}`);

  root.replaceChildren(heading, placeholder);
}
