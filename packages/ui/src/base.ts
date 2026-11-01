import { baseCss, tokensCss } from './tokens.js';

/** The `theme` attribute values. Absent means: inherit a themed Zilo ancestor, else `auto`. */
export type ZiloTheme = 'light' | 'dark' | 'auto';

const themes: readonly ZiloTheme[] = ['light', 'dark', 'auto'];

const sheetCache = new Map<string, CSSStyleSheet>();

function supportsAdoptedSheets(): boolean {
  return (
    typeof CSSStyleSheet === 'function' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in ShadowRoot.prototype
  );
}

/** Applies `cssTexts` to `root`, sharing constructable stylesheets between instances when possible. */
export function adoptStyles(root: ShadowRoot, cssTexts: readonly string[]): void {
  if (supportsAdoptedSheets()) {
    root.adoptedStyleSheets = cssTexts.map((text) => {
      let sheet = sheetCache.get(text);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        sheetCache.set(text, sheet);
      }
      return sheet;
    });
    return;
  }
  for (const text of cssTexts) {
    const style = document.createElement('style');
    style.textContent = text;
    root.prepend(style);
  }
}

/** Reads an enumerated attribute, falling back when it is missing or invalid. */
export function readEnum<T extends string>(
  el: Element,
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = el.getAttribute(name);
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Sets or removes an attribute; `null` removes it. */
export function writeAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * Base class for every Zilo element: an open shadow root with the token and base stylesheets, the
 * reflected `theme` attribute, typed event dispatch and the lazy-property upgrade pattern.
 */
export abstract class ZiloElement extends HTMLElement {
  protected readonly root: ShadowRoot;

  constructor(css: string, init: Partial<ShadowRootInit> = {}) {
    super();
    this.root = this.attachShadow({ mode: 'open', ...init });
    adoptStyles(this.root, [tokensCss, baseCss, css]);
  }

  /** `light`, `dark` or `auto`; `null` when unset (inherits a themed Zilo ancestor, else `auto`). */
  get theme(): ZiloTheme | null {
    const value = this.getAttribute('theme');
    return value !== null && (themes as readonly string[]).includes(value)
      ? (value as ZiloTheme)
      : null;
  }

  set theme(value: ZiloTheme | null) {
    writeAttr(this, 'theme', value);
  }

  connectedCallback(): void {
    // A property set before the element was defined shadows the accessor; replay it.
    for (const name of (this.constructor as typeof ZiloElement).upgradedProperties) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value: unknown = (this as Record<string, unknown>)[name];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (this as Record<string, unknown>)[name];
        (this as Record<string, unknown>)[name] = value;
      }
    }
  }

  /** Property names to replay when the element upgrades. */
  static readonly upgradedProperties: readonly string[] = ['theme'];

  /**
   * Dispatches a typed, non-bubbling `CustomEvent` on the element. Returns `false` when a listener
   * called `preventDefault()` on a cancelable event.
   */
  protected emit<K extends keyof ZiloEventDetailMap>(
    type: K,
    detail: ZiloEventDetailMap[K],
    cancelable = false,
  ): boolean {
    return this.dispatchEvent(new CustomEvent(type, { detail, cancelable }));
  }
}

/** Why a dialog closed or wants to close. */
export type ZiloDialogCloseReason = 'escape' | 'close-button' | 'outside' | 'api';

/** Detail of `zilo-cancel` (cancelable) and `zilo-close`. */
export interface ZiloDialogCloseDetail {
  readonly reason: ZiloDialogCloseReason;
}

/** Event name to `detail` type for every Zilo `CustomEvent`. */
export interface ZiloEventDetailMap {
  /** A dialog opened. */
  'zilo-open': null;
  /** A dialog is about to close by user action; cancelable. */
  'zilo-cancel': ZiloDialogCloseDetail;
  /** A dialog closed. */
  'zilo-close': ZiloDialogCloseDetail;
  /** A banner's dismiss button was pressed; cancelable. */
  'zilo-dismiss': null;
}

/** A typed Zilo event. */
export type ZiloEvent<K extends keyof ZiloEventDetailMap> = CustomEvent<ZiloEventDetailMap[K]>;

declare global {
  interface HTMLElementEventMap {
    'zilo-open': ZiloEvent<'zilo-open'>;
    'zilo-cancel': ZiloEvent<'zilo-cancel'>;
    'zilo-close': ZiloEvent<'zilo-close'>;
    'zilo-dismiss': ZiloEvent<'zilo-dismiss'>;
  }
}

/** Registers `ctor` as `tagName` once; safe to call repeatedly. */
export function defineOnce(
  tagName: string,
  ctor: CustomElementConstructor,
  registry: CustomElementRegistry = customElements,
): void {
  if (!registry.get(tagName)) registry.define(tagName, ctor);
}
