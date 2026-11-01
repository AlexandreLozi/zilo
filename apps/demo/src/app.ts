import { version } from '@zilo/sdk';
import '@zilo/ui';

/** Renders the demo into `root`: a heading and a `<zilo-button>` showing the SDK version. */
export function mount(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Zilo demo';

  const button = document.createElement('zilo-button');
  button.textContent = `Zilo SDK v${version}`;

  root.replaceChildren(heading, button);
}
