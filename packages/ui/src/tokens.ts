/**
 * Zilo design tokens as CSS custom properties (contract: docs/design/tokens.md).
 *
 * Three layers, as in the T05 prototype `tokens.css`:
 * 1. Private defaults `--_name`: Zilo's values, switched by theme. Hosts never set them.
 * 2. Public overrides `--zilo-*`: the host app's theming API. Zilo only reads them, so a host value
 *    always wins.
 * 3. Resolved tokens `--z-*`: what component CSS reads, `var(--zilo-*, var(--_*))`.
 *
 * The prototype's single `:host` rule is extended with a theme context (`--_zilo-ctx-*`): a component
 * with an explicit `theme` attribute exports its palette, and a nested Zilo component without one
 * (for example a `<zilo-button>` inside a dark `<zilo-dialog>`) inherits it instead of falling back
 * to the system preference.
 */

/** A palette entry name; each becomes the private default `--_<name>`. */
export type PaletteKey =
  | 'bg'
  | 'surface-sunken'
  | 'surface-raised'
  | 'text'
  | 'text-muted'
  | 'border'
  | 'border-strong'
  | 'accent'
  | 'on-accent'
  | 'focus'
  | 'danger'
  | 'danger-subtle'
  | 'warning'
  | 'warning-subtle'
  | 'success'
  | 'success-subtle'
  | 'info'
  | 'info-subtle'
  | 'scrim'
  | 'shadow-color'
  | 'page-paper';

export type Palette = Readonly<Record<PaletteKey, string>>;

/** Light palette (tokens.md §3). */
export const lightPalette: Palette = {
  bg: '#ffffff',
  'surface-sunken': '#f3f4f6',
  'surface-raised': '#ffffff',
  text: '#1a1d21',
  'text-muted': '#565e69',
  border: '#dde0e5',
  'border-strong': '#7d8590',
  accent: '#0e6f68',
  'on-accent': '#ffffff',
  focus: '#2156d1',
  danger: '#b42318',
  'danger-subtle': '#fdeceb',
  warning: '#8a5300',
  'warning-subtle': '#fff4dc',
  success: '#1b7a3a',
  'success-subtle': '#e7f6ec',
  info: '#2156d1',
  'info-subtle': '#eaf0fd',
  scrim: 'rgb(16 19 23 / 0.48)',
  'shadow-color': '220 20% 10%',
  'page-paper': '#ffffff',
};

/** Dark palette (tokens.md §3). */
export const darkPalette: Palette = {
  bg: '#1a1c20',
  'surface-sunken': '#121417',
  'surface-raised': '#23262b',
  text: '#e9ebee',
  'text-muted': '#a4acb6',
  border: '#33383f',
  'border-strong': '#7a838e',
  accent: '#4fd1c1',
  'on-accent': '#062a26',
  focus: '#8db3ff',
  danger: '#ff8f84',
  'danger-subtle': '#3a1f1d',
  warning: '#f2bb55',
  'warning-subtle': '#35290f',
  success: '#6fd38f',
  'success-subtle': '#16301f',
  info: '#8db3ff',
  'info-subtle': '#1b2640',
  scrim: 'rgb(0 0 0 / 0.62)',
  'shadow-color': '220 40% 2%',
  'page-paper': '#f6f6f4',
};

const paletteKeys = Object.keys(lightPalette) as PaletteKey[];

/** Palette keys that hosts may override as `--zilo-color-<key>`. */
const overridable: readonly PaletteKey[] = paletteKeys.filter(
  (key) => key !== 'shadow-color' && key !== 'page-paper',
);

/** The public colour overrides a host may set, for documentation and tests. */
export const publicColorProperties: readonly string[] = overridable.map(
  (key) => `--zilo-color-${key}`,
);

function declarations(palette: Palette, scheme: 'light' | 'dark', mode: 'own' | 'context'): string {
  const lines: string[] = [];
  if (mode === 'context') {
    lines.push(`color-scheme: var(--_zilo-ctx-color-scheme, ${scheme});`);
    for (const key of paletteKeys) {
      lines.push(`--_${key}: var(--_zilo-ctx-${key}, ${palette[key]});`);
    }
  } else {
    lines.push(`color-scheme: ${scheme};`, `--_zilo-ctx-color-scheme: ${scheme};`);
    for (const key of paletteKeys) {
      lines.push(`--_${key}: ${palette[key]};`, `--_zilo-ctx-${key}: ${palette[key]};`);
    }
  }
  return lines.join('\n  ');
}

const resolved = `
  --z-bg: var(--zilo-color-bg, var(--_bg));
  --z-surface-sunken: var(--zilo-color-surface-sunken, var(--_surface-sunken));
  --z-surface-raised: var(--zilo-color-surface-raised, var(--_surface-raised));
  --z-text: var(--zilo-color-text, var(--_text));
  --z-text-muted: var(--zilo-color-text-muted, var(--_text-muted));
  --z-border: var(--zilo-color-border, var(--_border));
  --z-border-strong: var(--zilo-color-border-strong, var(--_border-strong));
  --z-accent: var(--zilo-color-accent, var(--_accent));
  --z-on-accent: var(--zilo-color-on-accent, var(--_on-accent));
  --z-accent-hover: color-mix(in srgb, var(--z-accent) 86%, var(--z-text));
  --z-accent-pressed: color-mix(in srgb, var(--z-accent) 74%, var(--z-text));
  --z-accent-subtle: color-mix(in srgb, var(--z-accent) 10%, var(--z-bg));
  --z-hover: color-mix(in srgb, var(--z-text) 6%, transparent);
  --z-pressed: color-mix(in srgb, var(--z-text) 11%, transparent);
  --z-focus: var(--zilo-color-focus, var(--_focus));
  --z-danger: var(--zilo-color-danger, var(--_danger));
  --z-danger-subtle: var(--zilo-color-danger-subtle, var(--_danger-subtle));
  --z-warning: var(--zilo-color-warning, var(--_warning));
  --z-warning-subtle: var(--zilo-color-warning-subtle, var(--_warning-subtle));
  --z-success: var(--zilo-color-success, var(--_success));
  --z-success-subtle: var(--zilo-color-success-subtle, var(--_success-subtle));
  --z-info: var(--zilo-color-info, var(--_info));
  --z-info-subtle: var(--zilo-color-info-subtle, var(--_info-subtle));
  --z-scrim: var(--zilo-color-scrim, var(--_scrim));
  --z-page-paper: var(--_page-paper);

  --z-font-sans: var(--zilo-font-sans, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI",
    Roboto, "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif);
  --z-font-mono: var(--zilo-font-mono, ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono",
    "Liberation Mono", Menlo, Consolas, monospace);
  --z-text-xs: 0.75rem;
  --z-text-sm: 0.8125rem;
  --z-text-md: 0.875rem;
  --z-text-lg: 1rem;
  --z-text-xl: 1.125rem;
  --z-text-2xl: 1.375rem;
  --z-leading-tight: 1.25;
  --z-leading-normal: 1.45;
  --z-weight-regular: 400;
  --z-weight-medium: 500;
  --z-weight-semibold: 600;

  --z-space-0: 0;
  --z-space-1: 0.25rem;
  --z-space-2: 0.5rem;
  --z-space-3: 0.75rem;
  --z-space-4: 1rem;
  --z-space-5: 1.25rem;
  --z-space-6: 1.5rem;
  --z-space-8: 2rem;
  --z-space-10: 2.5rem;
  --z-control-height: 2.25rem;
  --z-control-height-sm: 1.75rem;

  --z-radius-sm: var(--zilo-radius-sm, 4px);
  --z-radius-md: var(--zilo-radius-md, 6px);
  --z-radius-lg: var(--zilo-radius-lg, 10px);
  --z-radius-pill: 999px;

  --z-shadow-1: 0 1px 2px hsl(var(--_shadow-color) / 0.1), 0 1px 1px hsl(var(--_shadow-color) / 0.06);
  --z-shadow-2: 0 4px 12px hsl(var(--_shadow-color) / 0.12), 0 1px 3px hsl(var(--_shadow-color) / 0.08);
  --z-shadow-3: 0 16px 48px hsl(var(--_shadow-color) / 0.22), 0 4px 12px hsl(var(--_shadow-color) / 0.1);
  --z-z-dialog: var(--zilo-z-index, 2147483000);

  --z-duration-instant: 80ms;
  --z-duration-fast: 140ms;
  --z-duration-base: 200ms;
  --z-duration-slow: 320ms;
  --z-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --z-ease-enter: cubic-bezier(0.05, 0.7, 0.1, 1);
  --z-ease-exit: cubic-bezier(0.3, 0, 1, 1);`;

/**
 * The token stylesheet for a component's shadow root. The theme comes from the host's `theme`
 * attribute (`light`, `dark` or `auto`); with no attribute the component inherits the nearest themed
 * Zilo ancestor's palette, else follows `prefers-color-scheme`.
 */
export const tokensCss = `
:host {
  ${declarations(lightPalette, 'light', 'context')}
  ${resolved}
}
@media (prefers-color-scheme: dark) {
  :host {
  ${declarations(darkPalette, 'dark', 'context')}
  }
  :host([theme='auto']) {
  ${declarations(darkPalette, 'dark', 'own')}
  }
}
@media not (prefers-color-scheme: dark) {
  :host([theme='auto']) {
  ${declarations(lightPalette, 'light', 'own')}
  }
}
:host([theme='light']) {
  ${declarations(lightPalette, 'light', 'own')}
}
:host([theme='dark']) {
  ${declarations(darkPalette, 'dark', 'own')}
}
@media (forced-colors: active) {
  :host {
    --z-accent: Highlight;
    --z-on-accent: HighlightText;
    --z-focus: Highlight;
    --z-border: CanvasText;
    --z-border-strong: CanvasText;
  }
}
@media (prefers-reduced-motion: reduce) {
  :host {
    --z-duration-fast: 0ms;
    --z-duration-base: 0ms;
    --z-duration-slow: 0ms;
  }
}
`;

/** Shared base rules: box sizing, the hidden attribute, focus ring and visually hidden text. */
export const baseCss = `
:host {
  font-family: var(--z-font-sans);
  font-size: var(--z-text-md);
  line-height: var(--z-leading-normal);
  color: var(--z-text);
}
:host([hidden]) {
  display: none !important;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
:focus-visible {
  outline: 2px solid var(--z-focus);
  outline-offset: 2px;
}
.visually-hidden {
  position: absolute !important;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
svg {
  flex: none;
}
`;
