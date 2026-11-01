/**
 * `<zilo-placeholder>`: a stand-in element that proves the Web Components pipeline works end to end.
 * It renders its `label` attribute (or a default) inside an open shadow root.
 */
export class ZiloPlaceholder extends HTMLElement {
  static readonly tagName = 'zilo-placeholder';
  static readonly observedAttributes = ['label'];

  readonly #text: HTMLSpanElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    this.#text = document.createElement('span');
    this.#text.setAttribute('part', 'label');
    root.append(this.#text);
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #render(): void {
    this.#text.textContent = this.getAttribute('label') ?? 'Zilo';
  }
}

/** Registers the element once; safe to call repeatedly. */
export function defineZiloPlaceholder(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(ZiloPlaceholder.tagName)) {
    registry.define(ZiloPlaceholder.tagName, ZiloPlaceholder);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'zilo-placeholder': ZiloPlaceholder;
  }
}
