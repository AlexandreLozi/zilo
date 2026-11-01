/**
 * Focus helpers that see through shadow roots and slots (the flattened tree), so the dialog's focus
 * trap works with slotted light DOM and with nested Zilo elements.
 */

/** The focused element, descending into open shadow roots. */
export function deepActiveElement(doc: Document = document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * True when `el` and its whole flattened-tree subtree are out of reach: `hidden`, `inert`, not
 * rendered (`display: none`, or inside `content-visibility: hidden`). A `display: contents` element
 * has no box of its own, so `checkVisibility()` is false for it, but its children can be rendered;
 * it does not prune its subtree.
 */
function prunesSubtree(el: Element): boolean {
  if (el instanceof HTMLElement && (el.hidden || el.inert)) return true;
  if (typeof el.checkVisibility !== 'function' || el.checkVisibility()) return false;
  return getComputedStyle(el).display !== 'contents';
}

/** True when `el` itself is rendered and visible (a `display: contents` element is not). */
function isRendered(el: Element): boolean {
  if (el instanceof HTMLElement && (el.hidden || el.inert)) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true });
  }
  return true;
}

/** Elements a `disabled` `<fieldset>` disables (HTML "disabled" form controls). */
function isFieldsetDisableable(el: Element): boolean {
  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLFieldSetElement
  ) {
    return true;
  }
  // Form-associated custom elements are disabled by their fieldset too.
  return (el.constructor as { formAssociated?: unknown }).formAssociated === true;
}

/**
 * The effective disabled state: the element's own `disabled`, or a `disabled` ancestor
 * `<fieldset>` unless the element is inside that fieldset's first `<legend>` child.
 */
function isDisabled(el: Element): boolean {
  if ('disabled' in el && (el as { disabled: unknown }).disabled === true) return true;
  if (!isFieldsetDisableable(el)) return false;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (!(parent instanceof HTMLFieldSetElement) || !parent.disabled) continue;
    const legend = [...parent.children].find((child) => child instanceof HTMLLegendElement);
    if (!legend?.contains(el)) return true;
  }
  return false;
}

function isTabStop(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  if (el.tabIndex < 0 || isDisabled(el)) return false;
  // A shadow host that delegates focus is not itself a stop; its shadow content is.
  if (el.shadowRoot?.delegatesFocus === true) return false;
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '') {
    return isRadioGroupStop(el);
  }
  return true;
}

/** One Tab stop per named radio group: the checked radio, else the first enabled one. */
function isRadioGroupStop(radio: HTMLInputElement): boolean {
  if (radio.checked) return true;
  const scope: Node = radio.form ?? radio.getRootNode();
  if (!('querySelectorAll' in scope)) return true;
  const group = [
    ...(scope as ParentNode).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ].filter((r) => r.name === radio.name && !isDisabled(r));
  if (group.some((r) => r.checked)) return false;
  return group[0] === radio;
}

function childrenInFlatTree(node: Element | ShadowRoot): Element[] {
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedElements({ flatten: true });
    return assigned.length > 0 ? assigned : [...node.children];
  }
  if (node instanceof Element && node.shadowRoot) return [...node.shadowRoot.children];
  return [...node.children];
}

/** Tab stops inside `container`, in flattened-tree order. */
export function tabbableElements(container: Element | ShadowRoot): HTMLElement[] {
  const result: HTMLElement[] = [];
  const visit = (node: Element): void => {
    if (prunesSubtree(node)) return;
    if (isRendered(node) && isTabStop(node)) result.push(node as HTMLElement);
    for (const child of childrenInFlatTree(node)) visit(child);
  };
  for (const child of childrenInFlatTree(container)) visit(child);
  return result;
}

/** True when `el` is still in a document and can take focus. */
export function canReceiveFocus(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && !isDisabled(el) && isRendered(el);
}
