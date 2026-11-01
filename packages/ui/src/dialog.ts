import { ZiloElement, defineOnce, writeAttr, type ZiloDialogCloseReason } from './base.js';
import { canReceiveFocus, deepActiveElement, tabbableElements } from './focus.js';
import { createIcon } from './icons.js';
import { lockScroll, unlockScroll } from './scroll-lock.js';

const css = `
:host {
  display: contents;
}
dialog {
  inline-size: min(var(--zilo-dialog-width, 32rem), calc(100vw - 2 * var(--z-space-4)));
  max-block-size: calc(100dvh - 2 * var(--z-space-4));
  margin: auto;
  padding: 0;
  border: 1px solid var(--z-border);
  border-radius: var(--z-radius-lg);
  background: var(--z-bg);
  color: var(--z-text);
  box-shadow: var(--z-shadow-3);
  font-family: var(--z-font-sans);
  font-size: var(--z-text-md);
  line-height: var(--z-leading-normal);
  overflow: hidden;
  z-index: var(--z-z-dialog);
}
dialog[open] {
  display: flex;
  flex-direction: column;
  animation: rise var(--z-duration-base) var(--z-ease-enter);
}
dialog::backdrop {
  background: var(--z-scrim, rgb(16 19 23 / 0.48));
}
dialog.fallback {
  position: fixed;
  inset: 0;
  block-size: fit-content;
}
.fallback-scrim {
  position: fixed;
  inset: 0;
  background: var(--z-scrim);
  z-index: var(--z-z-dialog);
}
.fallback-scrim:not(.shown) {
  display: none;
}
header {
  display: flex;
  align-items: flex-start;
  gap: var(--z-space-3);
  padding: var(--z-space-4) var(--z-space-5) var(--z-space-2);
}
h2 {
  flex: 1;
  margin: 0;
  font-size: var(--z-text-xl);
  font-weight: var(--z-weight-semibold);
  line-height: var(--z-leading-tight);
}
h2:focus {
  outline: none;
}
.close {
  display: inline-grid;
  place-items: center;
  inline-size: var(--z-control-height);
  block-size: var(--z-control-height);
  margin: calc(-1 * var(--z-space-1)) calc(-1 * var(--z-space-2)) 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--z-radius-md);
  background: transparent;
  color: var(--z-text);
  cursor: pointer;
}
.close:hover {
  background: var(--z-hover);
}
.close svg {
  inline-size: 1.25rem;
  block-size: 1.25rem;
}
.body {
  flex: 1;
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--z-space-2) var(--z-space-5) var(--z-space-4);
}
.description:not(.has-content) {
  display: none;
}
.description {
  margin: 0 0 var(--z-space-3);
  color: var(--z-text-muted);
}
footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--z-space-2);
  padding: var(--z-space-3) var(--z-space-5);
  border-block-start: 1px solid var(--z-border);
}
footer:not(.has-content) {
  display: none;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(0.5rem) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  dialog[open] {
    animation-name: fade;
  }
}
@media (max-width: 40rem) {
  dialog {
    inline-size: 100vw;
    max-inline-size: 100vw;
    block-size: 100dvh;
    max-block-size: 100dvh;
    border-radius: 0;
  }
}
@media (forced-colors: active) {
  dialog { border-color: CanvasText; }
}
`;

let instance = 0;

/** Open dialogs, topmost last. Only the topmost one guards focus. */
const openStack: ZiloDialog[] = [];

/**
 * `<zilo-dialog>`: the modal dialog primitive (accessibility.md §1–§4).
 *
 * - A native `<dialog>` opened with `showModal()` inside the shadow root: top layer, inert page and
 *   `role="dialog"` (`role="alertdialog"` with the `alert` attribute), `aria-modal="true"`,
 *   `aria-labelledby` the visible heading, `aria-describedby` the description when there is one.
 *   Browsers without `showModal()` get a fallback that marks the page's other branches `inert`.
 * - Focus trap: Tab and Shift+Tab move through the dialog's tab stops in flattened-tree order (slotted
 *   content and nested shadow roots included) and wrap at both ends.
 * - Initial focus: the `initialFocus` property, else a slotted `[autofocus]` element, else the first
 *   tab stop in the body or footer, else the close button, else the heading.
 * - Return focus: the element focused before opening, if it is still focusable; else the
 *   `returnFocus` property; else focus is released to the page.
 * - Escape and the close button fire the cancelable `zilo-cancel`; unless it is prevented, the
 *   dialog closes and fires `zilo-close` with the reason. `close()` closes with reason `api`.
 * - The page behind does not scroll while open; the body scrolls inside the dialog.
 * - Two empty visually hidden live regions (polite and assertive) exist from construction, inside
 *   the dialog, for `announce()`.
 *
 * Attributes: `open`, `heading`, `description`, `alert`, `hide-close`, `close-label`, `theme`.
 * Slots: `heading`, `description`, default (body), `footer`.
 * Parts: `dialog`, `header`, `heading`, `close-button`, `description`, `body`, `footer`.
 * Custom property: `--zilo-dialog-width` (default 32rem).
 */
export class ZiloDialog extends ZiloElement {
  static readonly tagName = 'zilo-dialog';
  static readonly observedAttributes = [
    'open',
    'heading',
    'description',
    'alert',
    'hide-close',
    'close-label',
  ];
  static override readonly upgradedProperties = [
    'theme',
    'open',
    'heading',
    'description',
    'alert',
    'hideClose',
    'closeLabel',
    'initialFocus',
    'returnFocus',
  ];

  /** Element to focus when the dialog opens. Overrides `[autofocus]`. */
  initialFocus: HTMLElement | null = null;
  /** Element to focus on close when the opener is gone. */
  returnFocus: HTMLElement | null = null;

  readonly #dialog: HTMLDialogElement;
  readonly #heading: HTMLHeadingElement;
  readonly #headingText: HTMLSpanElement;
  readonly #description: HTMLDivElement;
  readonly #descriptionText: HTMLSpanElement;
  readonly #descriptionSlot: HTMLSlotElement;
  readonly #close: HTMLButtonElement;
  readonly #body: HTMLDivElement;
  readonly #footer: HTMLElement;
  readonly #polite: HTMLDivElement;
  readonly #assertive: HTMLDivElement;
  readonly #scrim: HTMLDivElement;

  #isOpen = false;
  #opener: Element | null = null;
  #inerted: HTMLElement[] = [];

  constructor() {
    super(css);
    const id = `zilo-dialog-${String(++instance)}`;

    this.#dialog = document.createElement('dialog');
    this.#dialog.setAttribute('part', 'dialog');
    this.#dialog.setAttribute('aria-modal', 'true');
    this.#dialog.setAttribute('aria-labelledby', `${id}-heading`);

    const header = document.createElement('header');
    header.setAttribute('part', 'header');
    this.#heading = document.createElement('h2');
    this.#heading.id = `${id}-heading`;
    this.#heading.tabIndex = -1;
    this.#heading.setAttribute('part', 'heading');
    const headingSlot = document.createElement('slot');
    headingSlot.name = 'heading';
    this.#headingText = document.createElement('span');
    headingSlot.append(this.#headingText);
    this.#heading.append(headingSlot);

    this.#close = document.createElement('button');
    this.#close.type = 'button';
    this.#close.className = 'close';
    this.#close.setAttribute('part', 'close-button');
    this.#close.append(createIcon('close'));
    this.#close.addEventListener('click', () => {
      this.#requestClose('close-button');
    });
    header.append(this.#heading, this.#close);

    this.#body = document.createElement('div');
    this.#body.className = 'body';
    this.#body.setAttribute('part', 'body');
    this.#description = document.createElement('div');
    this.#description.id = `${id}-description`;
    this.#description.className = 'description';
    this.#description.setAttribute('part', 'description');
    this.#descriptionSlot = document.createElement('slot');
    this.#descriptionSlot.name = 'description';
    this.#descriptionText = document.createElement('span');
    this.#descriptionSlot.append(this.#descriptionText);
    this.#description.append(this.#descriptionSlot);
    this.#body.append(this.#description, document.createElement('slot'));

    this.#footer = document.createElement('footer');
    this.#footer.setAttribute('part', 'footer');
    const footerSlot = document.createElement('slot');
    footerSlot.name = 'footer';
    this.#footer.append(footerSlot);

    this.#polite = this.#liveRegion('polite');
    this.#assertive = this.#liveRegion('assertive');

    this.#dialog.append(header, this.#body, this.#footer, this.#polite, this.#assertive);
    this.#scrim = document.createElement('div');
    this.#scrim.className = 'fallback-scrim';
    this.root.append(this.#scrim, this.#dialog);

    this.#descriptionSlot.addEventListener('slotchange', () => {
      this.#syncDescription();
    });
    footerSlot.addEventListener('slotchange', () => {
      this.#footer.classList.toggle('has-content', footerSlot.assignedNodes().length > 0);
    });
    // On the host: keydowns from slotted content and from the shadow tree both reach it.
    this.addEventListener('keydown', this.#onKeydown);
    // Backups for close requests the keydown handler did not see (e.g. a platform gesture).
    this.#dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.#requestClose('escape');
    });
    this.#dialog.addEventListener('close', () => {
      if (this.#isOpen) this.#finishClose('api');
    });
    this.#sync();
  }

  get open(): boolean {
    return this.hasAttribute('open');
  }
  set open(value: boolean) {
    this.toggleAttribute('open', value);
  }

  get heading(): string | null {
    return this.getAttribute('heading');
  }
  set heading(value: string | null) {
    writeAttr(this, 'heading', value);
  }

  get description(): string | null {
    return this.getAttribute('description');
  }
  set description(value: string | null) {
    writeAttr(this, 'description', value);
  }

  /** Confirmation dialogs use `role="alertdialog"`. */
  get alert(): boolean {
    return this.hasAttribute('alert');
  }
  set alert(value: boolean) {
    this.toggleAttribute('alert', value);
  }

  get hideClose(): boolean {
    return this.hasAttribute('hide-close');
  }
  set hideClose(value: boolean) {
    this.toggleAttribute('hide-close', value);
  }

  get closeLabel(): string {
    return this.getAttribute('close-label') ?? 'Close';
  }
  set closeLabel(value: string) {
    this.setAttribute('close-label', value);
  }

  /** Opens the dialog. */
  show(): void {
    this.open = true;
  }

  /** Closes the dialog without a cancel event; `zilo-close` reports `reason`. */
  close(reason: ZiloDialogCloseReason = 'api'): void {
    if (!this.#isOpen) {
      this.open = false;
      return;
    }
    this.#finishClose(reason);
  }

  /** Announces `message` through the dialog's live region. */
  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    const region = politeness === 'assertive' ? this.#assertive : this.#polite;
    region.textContent = '';
    // A separate task makes repeated identical messages announce again.
    setTimeout(() => {
      region.textContent = message;
    }, 50);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.open && !this.#isOpen) this.#openNow();
  }

  disconnectedCallback(): void {
    if (this.#isOpen) this.#teardown();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'open') {
      if (this.open && !this.#isOpen && this.isConnected) this.#openNow();
      else if (!this.open && this.#isOpen) this.#finishClose('api');
      return;
    }
    this.#sync();
  }

  #liveRegion(politeness: 'polite' | 'assertive'): HTMLDivElement {
    const region = document.createElement('div');
    region.className = 'visually-hidden';
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    return region;
  }

  #sync(): void {
    writeAttr(this.#dialog, 'role', this.alert ? 'alertdialog' : null);
    this.#headingText.textContent = this.heading ?? '';
    this.#descriptionText.textContent = this.description ?? '';
    this.#close.hidden = this.hideClose;
    this.#close.setAttribute('aria-label', this.closeLabel);
    this.#syncDescription();
  }

  #syncDescription(): void {
    const has = this.#descriptionSlot.assignedNodes().length > 0 || (this.description ?? '') !== '';
    this.#description.classList.toggle('has-content', has);
    writeAttr(this.#dialog, 'aria-describedby', has ? this.#description.id : null);
  }

  #openNow(): void {
    this.#isOpen = true;
    this.#opener = deepActiveElement(this.ownerDocument);
    lockScroll(this.ownerDocument);
    if (typeof this.#dialog.showModal === 'function') {
      this.#dialog.showModal();
    } else {
      this.#dialog.classList.add('fallback');
      this.#dialog.setAttribute('open', '');
      this.#scrim.classList.add('shown');
      this.#inertOutside();
    }
    openStack.push(this);
    this.ownerDocument.addEventListener('focusin', this.#onDocumentFocusIn);
    this.#focusInitial();
    this.emit('zilo-open', null);
  }

  #focusInitial(): void {
    const autofocus = this.querySelector<HTMLElement>('[autofocus]');
    const candidates: (HTMLElement | null | undefined)[] = [
      this.initialFocus,
      autofocus,
      this.#contentTabStops()[0],
      this.hideClose ? null : this.#close,
    ];
    const target = candidates.find((el): el is HTMLElement => el != null && canReceiveFocus(el));
    (target ?? this.#heading).focus();
  }

  #contentTabStops(): HTMLElement[] {
    return [...tabbableElements(this.#body), ...tabbableElements(this.#footer)];
  }

  #requestClose(reason: ZiloDialogCloseReason): void {
    if (!this.#isOpen) return;
    if (this.emit('zilo-cancel', { reason }, true)) this.#finishClose(reason);
  }

  #finishClose(reason: ZiloDialogCloseReason): void {
    this.#teardown();
    this.removeAttribute('open');
    this.#restoreFocus();
    this.emit('zilo-close', { reason });
  }

  #teardown(): void {
    this.#isOpen = false;
    const index = openStack.indexOf(this);
    if (index !== -1) openStack.splice(index, 1);
    this.ownerDocument.removeEventListener('focusin', this.#onDocumentFocusIn);
    if (this.#dialog.classList.contains('fallback')) {
      this.#dialog.classList.remove('fallback');
      this.#dialog.removeAttribute('open');
      this.#scrim.classList.remove('shown');
      for (const el of this.#inerted) el.inert = false;
      this.#inerted = [];
    } else if (this.#dialog.open) {
      this.#dialog.close();
    }
    unlockScroll(this.ownerDocument);
  }

  #restoreFocus(): void {
    const opener = this.#opener;
    this.#opener = null;
    if (canReceiveFocus(opener)) opener.focus();
    else if (canReceiveFocus(this.returnFocus)) this.returnFocus.focus();
    else {
      const active = deepActiveElement(this.ownerDocument);
      if (active instanceof HTMLElement && this.#containsDeep(active)) active.blur();
    }
  }

  /** Fallback modality: mark every branch of the page outside this dialog `inert`. */
  #inertOutside(): void {
    this.#inerted = inertSiblingsOutside(this);
  }

  #containsDeep(el: Element): boolean {
    let node: Node | null = el;
    while (node) {
      if (node === this) return true;
      const root = node.getRootNode();
      node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return false;
  }

  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (!this.#isOpen || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      // Cancelling keydown stops the browser's own close request, so Escape is handled once.
      event.preventDefault();
      event.stopPropagation();
      this.#requestClose('escape');
      return;
    }
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const stops = tabbableElements(this.#dialog);
    event.preventDefault();
    if (stops.length === 0) {
      this.#heading.focus();
      return;
    }
    const active = deepActiveElement(this.ownerDocument);
    const index = stops.findIndex((el) => el === active);
    const step = event.shiftKey ? -1 : 1;
    const next =
      index === -1
        ? event.shiftKey
          ? stops.length - 1
          : 0
        : (index + step + stops.length) % stops.length;
    stops[next]?.focus();
  };

  /** Pulls focus back if it escapes (fallback mode, or a host script calling `focus()`). */
  readonly #onDocumentFocusIn = (event: FocusEvent): void => {
    if (openStack.at(-1) !== this) return;
    const target = event.composedPath()[0];
    if (target instanceof Element && this.#containsDeep(target)) return;
    const first = this.#contentTabStops()[0] ?? this.#heading;
    first.focus();
  };
}

/** Marks every sibling of `el` and of each composed ancestor `inert`; returns what it changed. */
function inertSiblingsOutside(el: Element): HTMLElement[] {
  const changed: HTMLElement[] = [];
  let node = el;
  for (;;) {
    const root = node.getRootNode();
    const parent = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    if (parent === null) break;
    const siblings = node.parentElement ? [...parent.children] : [...(root as ShadowRoot).children];
    for (const sibling of siblings) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    node = parent;
  }
  return changed;
}

/** Registers `<zilo-dialog>`; safe to call repeatedly. */
export function defineZiloDialog(registry?: CustomElementRegistry): void {
  defineOnce(ZiloDialog.tagName, ZiloDialog, registry);
}

declare global {
  interface HTMLElementTagNameMap {
    'zilo-dialog': ZiloDialog;
  }
}
