# Design tokens

Source: [`design/prototypes/assets/tokens.css`](../../design/prototypes/assets/tokens.css). Specimen:
[`design/prototypes/tokens.html`](../../design/prototypes/tokens.html). T15 copies the file into `packages/ui` as the
foundation; the values here are the contract.

## 1. Branding

- Neutral Zilo identity: the word "Zilo" set in the system UI font at weight 700, with a small square mark in the
  accent colour. There is no logo artwork in v1.
- The accent is a deep teal (`#0e6f68` light, `#4fd1c1` dark), chosen to be calm and clearly distinct.
- **No Dynamsoft look, assets or trademarks** (D-002 clean-room): no copied layouts, icons, colours, wording or
  screenshots from Dynamic Web TWAIN. The icons are drawn here as 24 px stroke glyphs in `proto.js`. No browser or OS
  logos are used.

## 2. Three layers

| Layer | Prefix | Who sets it | Example |
|---|---|---|---|
| Private defaults | `--_name` | Zilo only; switched by theme | `--_accent: #0e6f68` |
| Public overrides | `--zilo-*` | **The host app**. Zilo never declares these, so a host value always wins. | `--zilo-color-accent` |
| Resolved | `--z-*` | Zilo; what component CSS reads | `--z-accent: var(--zilo-color-accent, var(--_accent))` |

- **Theme selection:** the `theme` attribute on the component (`light`, `dark`, or `auto`, the default, which follows
  `prefers-color-scheme`). In the prototypes it is `data-zilo-theme` on `.zilo`.
- **Inheritance:** custom properties inherit through shadow DOM, so a host styles `zilo-scan-dialog { --zilo-… }` or any
  ancestor. To vary by theme, the host scopes its own selectors (for example `.app-dark zilo-scan-dialog { … }`).
- **Derived colours:** hover, pressed and the subtle accent tint are derived with `color-mix(in srgb, …)` from the
  resolved accent, text and background. A host that overrides only the accent therefore gets consistent states.
- **Host responsibility:** if the host's accent is light, it must also set `--zilo-color-on-accent` and keep 4.5:1. The
  T15 catalog page runs the contrast check on the demo override.

## 3. Colour

| Resolved token | Host override | Light | Dark | Use |
|---|---|---|---|---|
| `--z-bg` | `--zilo-color-bg` | `#ffffff` | `#1a1c20` | Dialog surface |
| `--z-surface-sunken` | `--zilo-color-surface-sunken` | `#f3f4f6` | `#121417` | Page grid, segmented track, origin box |
| `--z-surface-raised` | `--zilo-color-surface-raised` | `#ffffff` | `#23262b` | Menus, popovers |
| `--z-text` | `--zilo-color-text` | `#1a1d21` | `#e9ebee` | Body text |
| `--z-text-muted` | `--zilo-color-text-muted` | `#565e69` | `#a4acb6` | Secondary text |
| `--z-border` | `--zilo-color-border` | `#dde0e5` | `#33383f` | Decorative dividers only |
| `--z-border-strong` | `--zilo-color-border-strong` | `#7d8590` | `#7a838e` | Control boundaries (WCAG 1.4.11) |
| `--z-accent` | `--zilo-color-accent` | `#0e6f68` | `#4fd1c1` | Primary buttons, selection |
| `--z-on-accent` | `--zilo-color-on-accent` | `#ffffff` | `#062a26` | Text on accent |
| `--z-focus` | `--zilo-color-focus` | `#2156d1` | `#8db3ff` | Focus ring, separate from accent |
| `--z-danger` / `-subtle` | `--zilo-color-danger(-subtle)` | `#b42318` / `#fdeceb` | `#ff8f84` / `#3a1f1d` | Errors |
| `--z-warning` / `-subtle` | `--zilo-color-warning(-subtle)` | `#8a5300` / `#fff4dc` | `#f2bb55` / `#35290f` | Warnings |
| `--z-success` / `-subtle` | `--zilo-color-success(-subtle)` | `#1b7a3a` / `#e7f6ec` | `#6fd38f` / `#16301f` | Success |
| `--z-info` / `-subtle` | `--zilo-color-info(-subtle)` | `#2156d1` / `#eaf0fd` | `#8db3ff` / `#1b2640` | Information |
| `--z-scrim` | `--zilo-color-scrim` | `rgb(16 19 23 / .48)` | `rgb(0 0 0 / .62)` | Modal backdrop |
| `--z-accent-hover`, `-pressed`, `-subtle`, `--z-hover`, `--z-pressed` | — (derived) | | | Interaction states |

**Contrast (measured by `check/run.sh`, WCAG 2.2 AA):** every text pair is at least 4.5:1, and control boundaries and
the focus ring are at least 3:1 against the surfaces they sit on. Lowest pairs: light `--z-border-strong` on sunken
3.39:1, and dark `--z-border-strong` on bg 4.44:1. The focus ring has a 2 px offset, so it is measured against the
surface, not the accent fill.

**Forced colours:** under `forced-colors: active`, accent, focus and borders map to `Highlight`, `HighlightText` and
`CanvasText`. Icons use `currentColor`. No information is carried by background colour alone.

## 4. Typography

- **Families:** `--z-font-sans` is the system UI stack (system-ui, Segoe UI Variable, SF via -apple-system, Roboto,
  Noto Sans, Ubuntu, Cantarell). `--z-font-mono` (ui-monospace, SF Mono, Cascadia Mono, …) is used for driver
  badges, origins and error codes. Hosts can override both. No web fonts are loaded.
- **Scale (rem, so browser font settings apply):**

| Token | Size | Use |
|---|---|---|
| `--z-text-2xl` | 1.375rem / 22px | Empty-state headline |
| `--z-text-xl` | 1.125rem / 18px | Dialog title |
| `--z-text-lg` | 1rem / 16px | Origin text, page-empty headline |
| `--z-text-md` | 0.875rem / 14px | Body, controls |
| `--z-text-sm` | 0.8125rem / 13px | Secondary text |
| `--z-text-xs` | 0.75rem / 12px | Badges, codes |

- **Line height:** 1.45 normal, 1.25 tight (titles). **Weights:** 400, 500 (controls), 600 (titles).
- Text must reflow at 200% zoom with no loss (WCAG 1.4.4). Nothing has a fixed height in px except icons and the
  progress bar.

## 5. Spacing, size, radius, elevation

- **Spacing:** a 4 px grid, `--z-space-1…10` = 4, 8, 12, 16, 20, 24, 32, 40 px (in rem).
- **Controls:** `--z-control-height` 36 px; `--z-control-height-sm` 28 px for thumbnail icon buttons. Both are above the
  WCAG 2.5.8 24 px minimum target.
- **Radius:** `--z-radius-sm` 4 px (badges), `--z-radius-md` 6 px (controls, cards), `--z-radius-lg` 10 px (dialogs),
  `--z-radius-pill`. Hosts may override `--zilo-radius-sm|md|lg`.
- **Elevation:** `--z-shadow-1` (cards, selected segment), `--z-shadow-2` (toast, popovers), `--z-shadow-3` (dialogs,
  menus). Shadows are tinted by `--_shadow-color` per theme.
- **Stacking:** `--z-z-dialog`, overridable via `--zilo-z-index`. The default is very high, because hosts often have
  sticky headers.

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--z-duration-instant` | 80 ms | Press feedback |
| `--z-duration-fast` | 140 ms | Hover, colour |
| `--z-duration-base` | 200 ms | Dialog enter, thumbnail rotate, progress width |
| `--z-duration-slow` | 320 ms | Page card arrival |
| `--z-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Movement within the dialog |
| `--z-ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Appearing |
| `--z-ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` | Leaving |

- **Reduced motion** (`prefers-reduced-motion: reduce`): durations become 0. The dialog fades instead of rising. Page
  cards appear without moving. The indeterminate progress bar becomes a full-width slow opacity pulse. Spinners pulse
  instead of spinning. Skeleton shimmer stops.
- No motion is needed to understand a state: every animated state also has text.
