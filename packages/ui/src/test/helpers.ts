/** Dispatches a keydown on the deepest focused element, the way a real key press would. */
export function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  let target: Element | null = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

/** The deepest focused element. */
export function focused(): Element | null {
  let target: Element | null = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  return target;
}
