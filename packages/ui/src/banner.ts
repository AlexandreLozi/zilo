import { ZiloElement, defineOnce, readEnum, writeAttr } from './base.js';
import { createIcon, setIcon } from './icons.js';

export type ZiloBannerVariant = 'info' | 'success' | 'warning' | 'danger';
/** `off`: plain region; `polite`: `role="status"`; `assertive`: `role="alert"`. */
export type ZiloBannerLive = 'off' | 'polite' | 'assertive';

const variants: readonly ZiloBannerVariant[] = ['info', 'success', 'warning', 'danger'];
const lives: readonly ZiloBannerLive[] = ['off', 'polite', 'assertive'];

/** Default politeness per variant (accessibility.md §4–§5: only errors interrupt). */
const defaultLive: Readonly<Record<ZiloBannerVariant, ZiloBannerLive>> = {
  info: 'off',
  success: 'polite',
  warning: 'polite',
  danger: 'assertive',
};

const css = `
:host {
  display: block;
  --_tone: var(--z-info);
  --_tone-subtle: var(--z-info-subtle);
}
:host([variant='success']) { --_tone: var(--z-success); --_tone-subtle: var(--z-success-subtle); }
:host([variant='warning']) { --_tone: var(--z-warning); --_tone-subtle: var(--z-warning-subtle); }
:host([variant='danger']) { --_tone: var(--z-danger); --_tone-subtle: var(--z-danger-subtle); }
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--z-space-3);
  padding: var(--z-space-3) var(--z-space-4);
  border: 1px solid var(--_tone);
  border-inline-start-width: 4px;
  border-radius: var(--z-radius-md);
  background: var(--_tone-subtle);
  color: var(--z-text);
}
.icon {
  inline-size: 1.25rem;
  block-size: 1.25rem;
  margin-block-start: 0.0625rem;
  color: var(--_tone);
}
.content {
  flex: 1;
  min-inline-size: 0;
}
.title {
  display: block;
  font-weight: var(--z-weight-semibold);
}
.title:not(.has-title) {
  display: none;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--z-space-2);
  margin-block-start: var(--z-space-2);
}
.actions:not(.has-actions) {
  display: none;
}
.dismiss {
  display: inline-grid;
  place-items: center;
  inline-size: var(--z-control-height-sm);
  block-size: var(--z-control-height-sm);
  margin: calc(-1 * var(--z-space-1));
  padding: 0;
  border: 0;
  border-radius: var(--z-radius-md);
  background: transparent;
  color: var(--z-text);
  cursor: pointer;
}
.dismiss:hover { background: var(--z-hover); }
.dismiss svg { inline-size: 1rem; block-size: 1rem; }
@media (forced-colors: active) {
  .banner { border-color: CanvasText; }
}
`;

/**
 * `<zilo-banner>`: an inline message with an icon and a text title, so meaning never rests on colour
 * alone (WCAG 1.4.1).
 *
 * - `variant`: `info` (default), `success`, `warning`, `danger`.
 * - `live`: `off` (plain region), `polite` (`role="status"`) or `assertive` (`role="alert"`). The
 *   default is `assertive` for `danger`, `polite` for `success` and `warning`, `off` for `info`. The
 *   live container exists from construction, so content set later is announced.
 * - Slots: default (body), `title`, `actions` (buttons).
 * - `dismissible` adds a close button (`dismiss-label`, default "Dismiss"); pressing it fires
 *   the cancelable `zilo-dismiss` and then hides the banner.
 *
 * Parts: `banner`, `icon`, `title`, `content`, `actions`, `dismiss`.
 */
export class ZiloBanner extends ZiloElement {
  static readonly tagName = 'zilo-banner';
  static readonly observedAttributes = ['variant', 'live', 'dismissible', 'dismiss-label'];
  static override readonly upgradedProperties = [
    'theme',
    'variant',
    'live',
    'dismissible',
    'dismissLabel',
  ];

  readonly #banner: HTMLDivElement;
  readonly #icon: SVGSVGElement;
  readonly #title: HTMLElement;
  readonly #actions: HTMLDivElement;
  readonly #dismiss: HTMLButtonElement;

  constructor() {
    super(css);
    this.#banner = document.createElement('div');
    this.#banner.className = 'banner';
    this.#banner.setAttribute('part', 'banner');
    this.#icon = createIcon('info', 'icon');
    this.#icon.classList.add('icon');

    const content = document.createElement('div');
    content.className = 'content';
    content.setAttribute('part', 'content');
    this.#title = document.createElement('strong');
    this.#title.className = 'title';
    this.#title.setAttribute('part', 'title');
    const titleSlot = document.createElement('slot');
    titleSlot.name = 'title';
    this.#title.append(titleSlot);
    const body = document.createElement('div');
    body.append(document.createElement('slot'));
    this.#actions = document.createElement('div');
    this.#actions.className = 'actions';
    this.#actions.setAttribute('part', 'actions');
    const actionsSlot = document.createElement('slot');
    actionsSlot.name = 'actions';
    this.#actions.append(actionsSlot);
    content.append(this.#title, body, this.#actions);

    this.#dismiss = document.createElement('button');
    this.#dismiss.type = 'button';
    this.#dismiss.className = 'dismiss';
    this.#dismiss.setAttribute('part', 'dismiss');
    this.#dismiss.append(createIcon('close'));
    this.#dismiss.addEventListener('click', () => {
      if (this.emit('zilo-dismiss', null, true)) this.hidden = true;
    });

    this.#banner.append(this.#icon, content, this.#dismiss);
    this.root.append(this.#banner);

    titleSlot.addEventListener('slotchange', () => {
      this.#title.classList.toggle('has-title', titleSlot.assignedNodes().length > 0);
    });
    actionsSlot.addEventListener('slotchange', () => {
      this.#actions.classList.toggle('has-actions', actionsSlot.assignedNodes().length > 0);
    });
    this.#sync();
  }

  get variant(): ZiloBannerVariant {
    return readEnum(this, 'variant', variants, 'info');
  }
  set variant(value: ZiloBannerVariant) {
    this.setAttribute('variant', value);
  }

  /** The effective politeness (the attribute, else the variant's default). */
  get live(): ZiloBannerLive {
    return readEnum(this, 'live', lives, defaultLive[this.variant]);
  }
  set live(value: ZiloBannerLive) {
    this.setAttribute('live', value);
  }

  get dismissible(): boolean {
    return this.hasAttribute('dismissible');
  }
  set dismissible(value: boolean) {
    this.toggleAttribute('dismissible', value);
  }

  get dismissLabel(): string {
    return this.getAttribute('dismiss-label') ?? 'Dismiss';
  }
  set dismissLabel(value: string) {
    this.setAttribute('dismiss-label', value);
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    const live = this.live;
    writeAttr(
      this.#banner,
      'role',
      live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : null,
    );
    setIcon(this.#icon, this.variant);
    this.#dismiss.hidden = !this.dismissible;
    this.#dismiss.setAttribute('aria-label', this.dismissLabel);
  }
}

/** Registers `<zilo-banner>`; safe to call repeatedly. */
export function defineZiloBanner(registry?: CustomElementRegistry): void {
  defineOnce(ZiloBanner.tagName, ZiloBanner, registry);
}

declare global {
  interface HTMLElementTagNameMap {
    'zilo-banner': ZiloBanner;
  }
}
