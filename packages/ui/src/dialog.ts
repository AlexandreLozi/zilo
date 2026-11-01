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
  /* A host modal may lock pointer-events on body or an ancestor; the topmost dialog stays usable. */
  pointer-events: auto;
}
dialog::backdrop {
  pointer-events: auto;
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
  pointer-events: auto;
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

/** Open dialogs, topmost last. Only the topmost one guards focus and takes Escape. */
const openStack: ZiloDialog[] = [];

/** Escape keydowns the topmost dialog claimed in the window capture phase (see `#onWindowKeydown`). */
const claimedEscapes = new WeakSet<Event>();

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
 *   `returnFocus` property; else the nearest enclosing (host) dialog; else focus is released to the
 *   page.
 * - Escape, the close button and a click on the backdrop (reason `outside`) fire the cancelable
 *   `zilo-cancel`; unless it is prevented, the dialog closes and fires `zilo-close` with the reason.
 *   `close()` closes with reason `api`.
 * - Host modals (Radix and similar, see the README's integration contract): only the topmost dialog
 *   reacts to Escape and outside clicks. Escape is claimed (`preventDefault()`) in the window capture
 *   phase, before a host's document capture listener, and Tab and Escape that the dialog handles do
 *   not propagate past it. Return focus falls back to the enclosing host dialog.
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
  readonly #footerSlot: HTMLSlotElement;
  readonly #polite: HTMLDivElement;
  readonly #assertive: HTMLDivElement;
  readonly #scrim: HTMLDivElement;

  #isOpen = false;
  /** Set once connectedCallback ran; upgrades call attributeChangedCallback before it. */
  #connected = false;
  #opener: Element | null = null;
  #inerted: HTMLElement[] = [];
  /** The current pointer press started on the backdrop (outside the dialog box). */
  #pressedOutside = false;
  readonly #resize =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          this.#syncScrollable();
        })
      : null;

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
    this.#footerSlot = footerSlot;
    footerSlot.addEventListener('slotchange', () => {
      this.#syncFooter();
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
    // Outside click: the backdrop's hits target the <dialog> itself, outside its box. Press and
    // release must both land outside, so a drag that ends on the backdrop does not close.
    this.#dialog.addEventListener('pointerdown', (event) => {
      this.#pressedOutside = this.#isBackdropHit(event);
    });
    this.#dialog.addEventListener('click', (event) => {
      const outside = this.#pressedOutside && this.#isBackdropHit(event);
      this.#pressedOutside = false;
      if (outside && openStack.at(-1) === this) this.#requestClose('outside');
    });
    this.#scrim.addEventListener('click', () => {
      if (openStack.at(-1) === this) this.#requestClose('outside');
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
    this.#connected = true;
    // Wait a microtask so slotted children parsed with this element are upgraded first.
    queueMicrotask(() => {
      if (this.open && !this.#isOpen && this.isConnected) this.#openNow();
    });
  }

  disconnectedCallback(): void {
    this.#connected = false;
    if (this.#isOpen) this.#teardown();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'open') {
      if (this.open && !this.#isOpen && this.#connected) this.#openNow();
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

  #syncFooter(): void {
    this.#footer.classList.toggle('has-content', this.#footerSlot.assignedNodes().length > 0);
  }

  #openNow(): void {
    this.#isOpen = true;
    // slotchange is async; settle slot-dependent layout before choosing initial focus.
    this.#syncFooter();
    this.#syncDescription();
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
    // Same listener and options on the same window register once, however many dialogs are open.
    this.ownerDocument.defaultView?.addEventListener('keydown', ZiloDialog.#onWindowKeydown, true);
    this.ownerDocument.addEventListener('focusin', this.#onDocumentFocusIn);
    this.#syncScrollable();
    this.#resize?.observe(this.#body);
    this.#focusInitial();
    this.emit('zilo-open', null);
  }

  #focusInitial(): void {
    const candidates: (HTMLElement | null | undefined)[] = [
      this.initialFocus,
      this.querySelector<HTMLElement>('[autofocus]'),
      ...this.#contentTabStops(),
      this.hideClose ? null : this.#close,
      this.#heading,
    ];
    for (const el of candidates) {
      if (el == null || !canReceiveFocus(el)) continue;
      el.focus();
      const active = deepActiveElement(this.ownerDocument);
      if (active !== null && containsComposed(el, active)) return;
    }
  }

  /** A body that scrolls must be reachable by keyboard (WCAG 2.1.1); it becomes a tab stop. */
  #syncScrollable(): void {
    const scrolls = this.#body.scrollHeight > this.#body.clientHeight + 1;
    writeAttr(this.#body, 'tabindex', scrolls ? '0' : null);
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
    this.#resize?.disconnect();
    const index = openStack.indexOf(this);
    if (index !== -1) openStack.splice(index, 1);
    const view = this.ownerDocument.defaultView;
    if (view && !openStack.some((d) => d.ownerDocument.defaultView === view)) {
      view.removeEventListener('keydown', ZiloDialog.#onWindowKeydown, true);
    }
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
      // Inside a host modal, focus goes back to that modal, so its own trap keeps working.
      const host = enclosingDialog(this);
      const target = host === null ? null : focusTargetIn(host);
      if (target) target.focus();
      else {
        const active = deepActiveElement(this.ownerDocument);
        if (active instanceof HTMLElement && this.#containsDeep(active)) active.blur();
      }
    }
  }

  /** True for a pointer event on the backdrop: it targets the <dialog> outside its own box. */
  #isBackdropHit(event: MouseEvent): boolean {
    if (event.target !== this.#dialog) return false;
    const box = this.#dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }

  /**
   * Window capture phase: runs before any document-level capture listener, which is where host
   * modals such as Radix listen for Escape. While a Zilo dialog is open it is the topmost layer, so it
   * claims Escape with `preventDefault()` (Radix and similar libraries then leave their own dialog
   * open). The dialog itself still decides in its own keydown handler, so content inside it can keep
   * Escape by stopping propagation. Escape aimed outside the dialog (nothing focused) closes it here.
   */
  static readonly #onWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    const top = openStack.at(-1);
    const target = event.target;
    if (!top || !(target instanceof Node)) return;
    // Only keys aimed at the top dialog's document (one listener serves each window).
    if ((target.ownerDocument ?? target) !== top.ownerDocument) return;
    event.preventDefault();
    claimedEscapes.add(event);
    if (!containsComposed(top, target)) top.#requestClose('escape');
  };

  /** Fallback modality: mark every branch of the page outside this dialog `inert`. */
  #inertOutside(): void {
    this.#inerted = inertSiblingsOutside(this);
  }

  #containsDeep(el: Element): boolean {
    return containsComposed(this, el);
  }

  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (!this.#isOpen || openStack.at(-1) !== this) return;
    if (event.defaultPrevented && !claimedEscapes.has(event)) return;
    if (event.key === 'Escape') {
      if (event.isComposing) return;
      // Cancelling keydown stops the browser's own close request, so Escape is handled once; not
      // propagating keeps it from host modals' bubble-phase handlers.
      event.preventDefault();
      event.stopPropagation();
      this.#requestClose('escape');
      return;
    }
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    // The dialog owns Tab while open: an enclosing host focus trap must not move focus again.
    event.stopPropagation();
    this.#moveFocus(event.shiftKey ? -1 : 1);
  };

  /** Focuses the next tab stop in `step` direction, wrapping, skipping any stop that refuses focus. */
  #moveFocus(step: 1 | -1): void {
    const stops = tabbableElements(this.#dialog);
    const active = deepActiveElement(this.ownerDocument);
    const index = stops.findIndex((el) => el === active);
    const start = index === -1 ? (step === 1 ? -1 : stops.length) : index;
    for (let i = 1; i <= stops.length; i++) {
      const stop = stops[(((start + step * i) % stops.length) + stops.length) % stops.length];
      if (!stop || stop === active) continue;
      stop.focus();
      if (deepActiveElement(this.ownerDocument) === stop) return;
    }
    if (index === -1) this.#heading.focus();
  }

  /** Pulls focus back if it escapes (fallback mode, or a host script calling `focus()`). */
  readonly #onDocumentFocusIn = (event: FocusEvent): void => {
    if (openStack.at(-1) !== this) return;
    const target = event.composedPath()[0];
    if (target instanceof Element && this.#containsDeep(target)) return;
    const first = this.#contentTabStops()[0] ?? this.#heading;
    first.focus();
  };
}

/** True when `node` is `ancestor` or inside it, crossing shadow boundaries. */
function containsComposed(ancestor: Node, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === ancestor) return true;
    const root = current.getRootNode();
    current = current.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

/** The nearest composed ancestor of `el` that is a dialog (`<dialog>` or `role="dialog"`). */
function enclosingDialog(el: Element): HTMLElement | null {
  let node: Node | null = el;
  for (;;) {
    const root: Node = node.getRootNode();
    node =
      node.parentNode instanceof Element
        ? node.parentNode
        : root instanceof ShadowRoot
          ? root.host
          : null;
    if (!(node instanceof HTMLElement)) return null;
    const role = node.getAttribute('role');
    if (node instanceof HTMLDialogElement || role === 'dialog' || role === 'alertdialog')
      return node;
  }
}

/** Where focus goes in a host dialog: the dialog itself if it is focusable, else its first stop. */
function focusTargetIn(dialog: HTMLElement): HTMLElement | null {
  if (dialog.hasAttribute('tabindex') && canReceiveFocus(dialog)) return dialog;
  return tabbableElements(dialog).find((el) => canReceiveFocus(el)) ?? null;
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
