/**
 * Layer ownership: which open layer a key press or pointer press belongs to, so that a Zilo dialog
 * acts only when it is the topmost layer (README, "Integration contract").
 *
 * A layer is an open `<dialog>`, a shown popover, or an `[aria-modal="true"]`, `role="dialog"` or
 * `role="alertdialog"` element (an ARIA layer). Native layers are classified from their live state
 * when an event arrives, never from a history of opening and closing. ARIA layers have no open or
 * close lifecycle to read, so a dialog records the ones already open when it opens
 * (`AriaLayerSnapshot`).
 */

/** The parent of `node` in the composed tree: a shadow root's host stands in for the root. */
export function composedParent(node: Node): Node | null {
  if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
  return node.parentNode;
}

/** True when `node` is `ancestor` or inside it, crossing shadow boundaries. */
export function containsComposed(ancestor: Node, node: Node): boolean {
  for (let current: Node | null = node; current; current = composedParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * The parent of `node` in the flattened tree (the tree that renders): the slot it is assigned to,
 * else its composed parent. A `<dialog>` in a component's shadow root is the flattened-tree parent
 * of the light DOM content slotted into it.
 */
export function flatParent(node: Node): Node | null {
  if ((node instanceof Element || node instanceof Text) && node.assignedSlot) {
    return node.assignedSlot;
  }
  return composedParent(node);
}

/** True when `node` is `ancestor` or inside it in the flattened tree. */
export function containsFlat(ancestor: Node, node: Node): boolean {
  for (let current: Node | null = node; current; current = flatParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

function matchesSafe(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    // The selector is not supported here (an older engine or a test DOM).
    return false;
  }
}

function isShownPopover(el: Element): boolean {
  return el.hasAttribute('popover') && matchesSafe(el, ':popover-open');
}

/** An `auto` or `hint` popover: one that the browser closes on Escape. `manual` ones never do. */
function isLightDismissPopover(el: Element): boolean {
  const kind = (el.getAttribute('popover') ?? '').toLowerCase();
  return (kind === '' || kind === 'auto' || kind === 'hint') && isShownPopover(el);
}

function hasDialogRole(el: Element): boolean {
  const role = el.getAttribute('role');
  return el.getAttribute('aria-modal') === 'true' || role === 'dialog' || role === 'alertdialog';
}

function isRendered(el: Element): boolean {
  return typeof el.checkVisibility !== 'function' || el.checkVisibility();
}

/** True for a modal `<dialog>` (opened with `showModal()`). */
export function isModalDialog(el: Element): el is HTMLDialogElement {
  return el instanceof HTMLDialogElement && el.open && matchesSafe(el, ':modal');
}

/**
 * True for a native layer whose Escape dismissal is the browser's default action: a modal
 * `<dialog>` (unless `closedby="none"`) or a shown light-dismiss popover.
 */
export function isEscapeDismissedNatively(el: Element): boolean {
  if (el instanceof HTMLDialogElement) {
    return isModalDialog(el) && (el.getAttribute('closedby') ?? '').toLowerCase() !== 'none';
  }
  return el.hasAttribute('popover') && isLightDismissPopover(el);
}

/** Dismisses `layer` as the browser does on Escape: `cancel`, then close (a popover just hides). */
export function dismissNatively(layer: Element): void {
  if (layer instanceof HTMLDialogElement) {
    const dialog = layer as HTMLDialogElement & { requestClose?: () => void };
    if (typeof dialog.requestClose === 'function') dialog.requestClose();
    else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  } else if (layer instanceof HTMLElement && isShownPopover(layer)) {
    layer.hidePopover();
  }
}

/** An element whose only layer marker is its role or `aria-modal`: no native lifecycle. */
function isAriaOnly(el: Element): boolean {
  return !(el instanceof HTMLDialogElement) && !el.hasAttribute('popover') && hasDialogRole(el);
}

/** True for an open layer (see the module comment). A closed `<dialog>` is not one. */
export function isOpenLayer(el: Element): boolean {
  if (el instanceof HTMLDialogElement) return el.open;
  if (isShownPopover(el)) return true;
  return hasDialogRole(el) && isRendered(el);
}

/**
 * True for a layer that takes Escape and pointer input even when focus is not in it:
 * - a light-dismiss popover anywhere;
 * - with `modals`, a modal `<dialog>` anywhere (the caller passes `false` when it knows that no
 *   modal is above it);
 * - a rendered ARIA layer for which `isInside()` (inside the dialog asking) is true.
 * A non-modal `<dialog>` or a manual popover is one only while it holds focus.
 */
export function takesInputWithoutFocus(
  el: Element,
  modals: boolean,
  isInside: () => boolean,
): boolean {
  if (el instanceof HTMLDialogElement) return modals && isModalDialog(el);
  if (el.hasAttribute('popover')) return isLightDismissPopover(el);
  return hasDialogRole(el) && isRendered(el) && isInside();
}

/** Every element of `root`, descending into open shadow roots. */
function* deepElements(root: Document | ShadowRoot): Generator<Element> {
  for (const el of root.querySelectorAll('*')) {
    yield el;
    if (el.shadowRoot) yield* deepElements(el.shadowRoot);
  }
}

/** The first element of `doc` (open shadow roots included) that satisfies `test`. */
export function findDeep(doc: Document, test: (el: Element) => boolean): Element | null {
  for (const el of deepElements(doc)) if (test(el)) return el;
  return null;
}

/**
 * The native layers open in `doc` (open shadow roots included): every open `<dialog>`, modal or
 * not, and every shown popover. A dialog takes this record when it opens, before `showModal()`, and
 * uses it only to withhold its Escape recovery (see `ZiloDialog`): an element in it may have opened
 * before the dialog, even if it has closed and opened again since.
 */
export function openNativeLayers(doc: Document): WeakSet<Element> {
  const open = new WeakSet<Element>();
  for (const el of deepElements(doc)) {
    if ((el instanceof HTMLDialogElement && el.open) || isShownPopover(el)) open.add(el);
  }
  return open;
}

/** Changes to these attributes make an element a different kind of layer, or none. */
const MARKERS = new Set(['role', 'aria-modal', 'popover', 'hidden']);

/**
 * The ARIA layers open in a document (open shadow roots included) when a dialog opened: they are
 * that dialog's content, not newer layers. An entry stays only while the element stays open:
 * - the snapshot observes every root it scanned (the document and each open shadow root), and drops
 *   an element that is removed (or inside a removed subtree), whose role, `aria-modal`, `popover` or
 *   `hidden` attribute changes, or that is not open after any change in those roots;
 * - `has()` first applies the changes not yet delivered, then checks the element is still open.
 * So an element that closes and opens again is newer, unless it was hidden and shown in the same
 * task, or hidden by a style change that touched no attribute (a media query).
 */
export class AriaLayerSnapshot {
  readonly #layers = new Set<Element>();
  #observer: MutationObserver | null = null;

  constructor(doc: Document) {
    const roots: (Document | ShadowRoot)[] = [doc];
    for (const el of deepElements(doc)) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (isAriaOnly(el) && isOpenLayer(el)) this.#layers.add(el);
    }
    if (this.#layers.size === 0 || typeof MutationObserver !== 'function') return;
    this.#observer = new MutationObserver((records) => {
      this.#invalidate(records);
    });
    for (const root of roots) {
      this.#observer.observe(root, { subtree: true, childList: true, attributes: true });
    }
  }

  /** True when `el` was an open ARIA layer at the snapshot and has stayed open since. */
  has(el: Element): boolean {
    if (!this.#layers.has(el)) return false;
    this.#invalidate(this.#observer?.takeRecords() ?? []);
    return this.#layers.has(el);
  }

  /** Stops observing and forgets every entry. */
  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#layers.clear();
  }

  #invalidate(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const removed of record.removedNodes) {
          for (const el of this.#layers) if (containsComposed(removed, el)) this.#layers.delete(el);
        }
      } else if (record.target instanceof Element && MARKERS.has(record.attributeName ?? '')) {
        this.#layers.delete(record.target);
      }
    }
    for (const el of this.#layers) if (!el.isConnected || !isOpenLayer(el)) this.#layers.delete(el);
    if (this.#layers.size === 0) this.dispose();
  }
}
