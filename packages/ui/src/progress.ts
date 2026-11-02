import { ZiloElement, defineOnce, writeAttr } from './base.js';

const progressCss = `
:host {
  display: block;
}
.track {
  position: relative;
  block-size: 0.375rem;
  border-radius: var(--z-radius-pill);
  background: var(--z-surface-sunken);
  box-shadow: inset 0 0 0 1px var(--z-border-strong);
  overflow: hidden;
}
.bar {
  block-size: 100%;
  inline-size: var(--_value, 0%);
  border-radius: inherit;
  background: var(--z-accent);
  transition: inline-size var(--z-duration-base) var(--z-ease-standard);
}
:host(:not([value])) .bar {
  inline-size: 40%;
  animation: slide 1.4s var(--z-ease-standard) infinite;
}
@keyframes slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  :host(:not([value])) .bar {
    inline-size: 100%;
    animation: pulse 2.4s ease-in-out infinite;
  }
}
@media (forced-colors: active) {
  .bar { background: Highlight; }
  .track { box-shadow: inset 0 0 0 1px CanvasText; }
}
`;

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `<zilo-progress>`: a progress bar with `role="progressbar"`.
 *
 * - `value` and `max` (default 100). Without `value` it is indeterminate and `aria-valuenow` is
 *   omitted, as accessibility.md §4 requires when the total is unknown.
 * - `label` is the accessible name (for example "Scan progress"); `value-text` sets
 *   `aria-valuetext` ("Scanning page 3…").
 * - Reduced motion turns the indeterminate slide into a full-width slow pulse.
 *
 * Parts: `track`, `bar`.
 */
export class ZiloProgress extends ZiloElement {
  static readonly tagName = 'zilo-progress';
  static readonly observedAttributes = ['value', 'max', 'label', 'value-text'];
  static override readonly upgradedProperties = ['theme', 'value', 'max', 'label', 'valueText'];

  readonly #track: HTMLDivElement;
  readonly #bar: HTMLDivElement;

  constructor() {
    super(progressCss);
    this.#track = document.createElement('div');
    this.#track.className = 'track';
    this.#track.setAttribute('part', 'track');
    this.#track.setAttribute('role', 'progressbar');
    this.#track.setAttribute('aria-valuemin', '0');
    this.#bar = document.createElement('div');
    this.#bar.className = 'bar';
    this.#bar.setAttribute('part', 'bar');
    this.#track.append(this.#bar);
    this.root.append(this.#track);
    this.#sync();
  }

  /** The current value, or `null` when indeterminate. */
  get value(): number | null {
    return parseNumber(this.getAttribute('value'));
  }
  set value(value: number | null) {
    writeAttr(this, 'value', value === null ? null : String(value));
  }

  get max(): number {
    const max = parseNumber(this.getAttribute('max'));
    return max !== null && max > 0 ? max : 100;
  }
  set max(value: number) {
    this.setAttribute('max', String(value));
  }

  get label(): string | null {
    return this.getAttribute('label');
  }
  set label(value: string | null) {
    writeAttr(this, 'label', value);
  }

  get valueText(): string | null {
    return this.getAttribute('value-text');
  }
  set valueText(value: string | null) {
    writeAttr(this, 'value-text', value);
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    const { value, max } = this;
    const clamped = value === null ? null : Math.min(Math.max(value, 0), max);
    writeAttr(this.#track, 'aria-valuemax', String(max));
    writeAttr(this.#track, 'aria-valuenow', clamped === null ? null : String(clamped));
    writeAttr(this.#track, 'aria-label', this.label ?? 'Progress');
    writeAttr(this.#track, 'aria-valuetext', this.valueText);
    this.#bar.style.setProperty(
      '--_value',
      clamped === null ? null : `${String((clamped / max) * 100)}%`,
    );
  }
}

const spinnerCss = `
:host {
  display: inline-flex;
  vertical-align: middle;
}
.spinner {
  display: inline-flex;
  align-items: center;
  gap: var(--z-space-2);
}
svg {
  inline-size: var(--zilo-spinner-size, 1.25rem);
  block-size: var(--zilo-spinner-size, 1.25rem);
  color: var(--z-accent);
  animation: spin 0.9s linear infinite;
}
circle {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 42 100;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  svg { animation: pulse 2s ease-in-out infinite; }
}
@media (forced-colors: active) {
  svg { color: CanvasText; }
}
`;

const svgNs = 'http://www.w3.org/2000/svg';

/**
 * `<zilo-spinner>`: an indeterminate busy indicator (`role="progressbar"` with no value).
 *
 * - `label` is the accessible name (default "Loading"). With `visible-label` the label is also shown
 *   as text next to the spinner ("Looking for scanners…").
 * - Reduced motion makes it pulse instead of spin.
 *
 * Parts: `spinner`, `label`. Custom property: `--zilo-spinner-size`.
 */
export class ZiloSpinner extends ZiloElement {
  static readonly tagName = 'zilo-spinner';
  static readonly observedAttributes = ['label', 'visible-label'];
  static override readonly upgradedProperties = ['theme', 'label', 'visibleLabel'];

  readonly #wrapper: HTMLSpanElement;
  readonly #text: HTMLSpanElement;

  constructor() {
    super(spinnerCss);
    this.#wrapper = document.createElement('span');
    this.#wrapper.setAttribute('role', 'progressbar');
    this.#wrapper.className = 'spinner';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('part', 'spinner');
    const circle = document.createElementNS(svgNs, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '9');
    svg.append(circle);
    this.#text = document.createElement('span');
    this.#text.setAttribute('part', 'label');
    this.#wrapper.append(svg, this.#text);
    this.root.append(this.#wrapper);
    this.#sync();
  }

  get label(): string {
    return this.getAttribute('label') ?? 'Loading';
  }
  set label(value: string) {
    this.setAttribute('label', value);
  }

  get visibleLabel(): boolean {
    return this.hasAttribute('visible-label');
  }
  set visibleLabel(value: boolean) {
    this.toggleAttribute('visible-label', value);
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    this.#text.textContent = this.label;
    this.#text.className = this.visibleLabel ? '' : 'visually-hidden';
    writeAttr(this.#wrapper, 'aria-label', this.label);
  }
}

/** Registers `<zilo-progress>` and `<zilo-spinner>`; safe to call repeatedly. */
export function defineZiloProgress(registry?: CustomElementRegistry): void {
  defineOnce(ZiloProgress.tagName, ZiloProgress, registry);
  defineOnce(ZiloSpinner.tagName, ZiloSpinner, registry);
}

declare global {
  interface HTMLElementTagNameMap {
    'zilo-progress': ZiloProgress;
    'zilo-spinner': ZiloSpinner;
  }
}
