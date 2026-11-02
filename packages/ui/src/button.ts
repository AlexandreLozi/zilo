import { ZiloElement, defineOnce, readEnum, writeAttr } from './base.js';

export type ZiloButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ZiloButtonSize = 'md' | 'sm';

const variants: readonly ZiloButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const sizes: readonly ZiloButtonSize[] = ['md', 'sm'];

const css = `
:host {
  display: inline-flex;
  vertical-align: middle;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--z-space-2);
  inline-size: 100%;
  min-block-size: var(--z-control-height);
  padding: var(--z-space-1) var(--z-space-4);
  border: 1px solid var(--z-border-strong);
  border-radius: var(--z-radius-md);
  background: var(--z-bg);
  color: var(--z-text);
  font: inherit;
  font-weight: var(--z-weight-medium);
  cursor: pointer;
  transition:
    background-color var(--z-duration-fast) var(--z-ease-standard),
    border-color var(--z-duration-fast) var(--z-ease-standard);
}
button:hover {
  background: color-mix(in srgb, var(--z-text) 6%, var(--z-bg));
}
button:active {
  background: color-mix(in srgb, var(--z-text) 11%, var(--z-bg));
}
:host([size='sm']) button {
  min-block-size: var(--z-control-height-sm);
  padding: 0 var(--z-space-2);
  font-size: var(--z-text-sm);
}
:host([variant='primary']) button {
  background: var(--z-accent);
  border-color: var(--z-accent);
  color: var(--z-on-accent);
}
:host([variant='primary']) button:hover {
  background: var(--z-accent-hover);
  border-color: var(--z-accent-hover);
}
:host([variant='primary']) button:active {
  background: var(--z-accent-pressed);
  border-color: var(--z-accent-pressed);
}
:host([variant='ghost']) button {
  background: transparent;
  border-color: transparent;
}
:host([variant='ghost']) button:hover {
  background: var(--z-hover);
}
:host([variant='danger']) button {
  color: var(--z-danger);
  border-color: var(--z-danger);
}
button:disabled,
button[aria-disabled='true'] {
  cursor: not-allowed;
}
button:disabled {
  opacity: 0.55;
}
::slotted(svg) {
  inline-size: 1.25em;
  block-size: 1.25em;
}
@media (forced-colors: active) {
  button {
    border-color: ButtonText;
  }
  button:disabled {
    color: GrayText;
    border-color: GrayText;
  }
}
`;

/**
 * `<zilo-button>`: a native `<button>` in a shadow root. The slot is its label.
 *
 * - `variant`: `secondary` (default), `primary`, `ghost` or `danger`; `size`: `md` or `sm`.
 * - `disabled`: native disabled (not focusable). `busy`: `aria-busy` plus `aria-disabled`, so it
 *   stays focusable and announces its new label (accessibility.md §5).
 * - `label`: the accessible name for icon-only buttons.
 * - Focus is delegated to the inner button; `click` events are retargeted to the host and are
 *   suppressed while disabled or busy.
 *
 * Parts: `button`.
 */
export class ZiloButton extends ZiloElement {
  static readonly tagName = 'zilo-button';
  static readonly observedAttributes = ['disabled', 'busy', 'label'];
  static override readonly upgradedProperties = [
    'theme',
    'variant',
    'size',
    'disabled',
    'busy',
    'label',
  ];

  readonly #button: HTMLButtonElement;

  constructor() {
    super(css, { delegatesFocus: true });
    this.#button = document.createElement('button');
    this.#button.type = 'button';
    this.#button.setAttribute('part', 'button');
    this.#button.append(document.createElement('slot'));
    this.root.append(this.#button);
    // Capture on the host runs before listeners the page adds to it.
    this.addEventListener('click', this.#guardClick, { capture: true });
    this.#sync();
  }

  get variant(): ZiloButtonVariant {
    return readEnum(this, 'variant', variants, 'secondary');
  }
  set variant(value: ZiloButtonVariant) {
    this.setAttribute('variant', value);
  }

  get size(): ZiloButtonSize {
    return readEnum(this, 'size', sizes, 'md');
  }
  set size(value: ZiloButtonSize) {
    this.setAttribute('size', value);
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(value: boolean) {
    this.toggleAttribute('disabled', value);
  }

  get busy(): boolean {
    return this.hasAttribute('busy');
  }
  set busy(value: boolean) {
    this.toggleAttribute('busy', value);
  }

  get label(): string | null {
    return this.getAttribute('label');
  }
  set label(value: string | null) {
    writeAttr(this, 'label', value);
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  override focus(options?: FocusOptions): void {
    this.#button.focus(options);
  }

  #sync(): void {
    this.#button.disabled = this.disabled;
    writeAttr(this.#button, 'aria-busy', this.busy ? 'true' : null);
    writeAttr(this.#button, 'aria-disabled', this.busy && !this.disabled ? 'true' : null);
    writeAttr(this.#button, 'aria-label', this.label);
  }

  readonly #guardClick = (event: Event): void => {
    if (this.disabled || this.busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}

/** Registers `<zilo-button>`; safe to call repeatedly. */
export function defineZiloButton(registry?: CustomElementRegistry): void {
  defineOnce(ZiloButton.tagName, ZiloButton, registry);
}

declare global {
  interface HTMLElementTagNameMap {
    'zilo-button': ZiloButton;
  }
}
