/**
 * Layer ownership: which open layer a key press or pointer press belongs to, so that a Zilo dialog
 * acts only when it is the topmost layer (README, "Integration contract").
 *
 * A layer is an open `<dialog>`, a shown popover, or an `[aria-modal="true"]`, `role="dialog"` or
 * `role="alertdialog"` element. A dialog records the layers already open when it opens; any other
 * open layer is newer than it.
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

/** True for an open layer (see the module comment). A closed `<dialog>` is not one. */
export function isOpenLayer(el: Element): boolean {
  if (el instanceof HTMLDialogElement) return el.open;
  if (isShownPopover(el)) return true;
  return hasDialogRole(el) && isRendered(el);
}

/**
 * True for a layer that takes Escape and pointer input even when focus is not in it: a modal
 * `<dialog>` or a light-dismiss popover anywhere, or a rendered `role="dialog"` or `aria-modal`
 * element for which `isInside()` (inside the dialog asking) is true. A non-modal `<dialog>` or a
 * manual popover is one only while it holds focus.
 */
export function isTopmostCandidate(el: Element, isInside: () => boolean): boolean {
  if (el instanceof HTMLDialogElement) return el.open && matchesSafe(el, ':modal');
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

/** The open layers in `doc`, open shadow roots included. */
export function openLayers(doc: Document): Set<Element> {
  const layers = new Set<Element>();
  for (const el of deepElements(doc)) if (isOpenLayer(el)) layers.add(el);
  return layers;
}

/** The first element of `doc` (open shadow roots included) that satisfies `test`. */
export function findDeep(doc: Document, test: (el: Element) => boolean): Element | null {
  for (const el of deepElements(doc)) if (test(el)) return el;
  return null;
}
