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

function isHiddenOrInert(el: Element): boolean {
  if (el instanceof HTMLElement && (el.hidden || el.inert)) return true;
  if (typeof el.checkVisibility === 'function') {
    return !el.checkVisibility({ visibilityProperty: true });
  }
  return false;
}

function isDisabled(el: Element): boolean {
  return 'disabled' in el && (el as { disabled: unknown }).disabled === true;
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
  const scope = radio.form ?? radio.getRootNode();
  if (!(scope instanceof Document || scope instanceof ShadowRoot || scope instanceof HTMLElement)) {
    return true;
  }
  const group = [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (r) => r.name === radio.name && !r.disabled,
  );
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
    if (isHiddenOrInert(node) && !(node instanceof HTMLSlotElement)) return;
    if (isTabStop(node)) result.push(node as HTMLElement);
    for (const child of childrenInFlatTree(node)) visit(child);
  };
  for (const child of childrenInFlatTree(container)) visit(child);
  return result;
}

/** True when `el` is still in a document and can take focus. */
export function canReceiveFocus(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && !isDisabled(el) && !isHiddenOrInert(el);
}
