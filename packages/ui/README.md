# @zilo/ui

Zilo Web Components: framework-agnostic custom elements with **no runtime dependencies**. React
apps use [`@zilo/react`](../react/README.md); any other app uses the elements directly.

```ts
import '@zilo/ui'; // registers every element (or call defineZiloElements(registry))
```

## Why no Lit

The foundation is five small elements whose rendering is static after construction. Plain
`HTMLElement` subclasses with a shared base (`ZiloElement`) cover it: shadow root, shared
constructable stylesheets, attribute/property reflection, typed events. Lit would add a dependency, a
licence entry and bundle weight for templating we don't need yet. T22 (scan dialog) may revisit this
if dynamic lists make hand-written DOM updates costly; the decision would be recorded then.

## Elements

| Element           | Purpose                | Key attributes / properties                                                                                                              | Events                                                |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `<zilo-dialog>`   | Modal dialog primitive | `open`, `heading`, `description`, `alert`, `hide-close`, `close-label`; `initialFocus`, `returnFocus`; `show()`, `close()`, `announce()` | `zilo-open`, `zilo-cancel` (cancelable), `zilo-close` |
| `<zilo-button>`   | Button                 | `variant` (`secondary` · `primary` · `ghost` · `danger`), `size` (`md` · `sm`), `disabled`, `busy`, `label`                              | native `click`                                        |
| `<zilo-banner>`   | Inline message / alert | `variant` (`info` · `success` · `warning` · `danger`), `live` (`off` · `polite` · `assertive`), `dismissible`, `dismiss-label`           | `zilo-dismiss` (cancelable)                           |
| `<zilo-progress>` | Progress bar           | `value` (absent = indeterminate), `max`, `label`, `value-text`                                                                           | —                                                     |
| `<zilo-spinner>`  | Busy indicator         | `label`, `visible-label`                                                                                                                 | —                                                     |

Every element also takes `theme`. Events are `CustomEvent`s typed through `HTMLElementEventMap`
(`ZiloEventDetailMap`); they do not bubble, so listen on the element itself.

### Dialog behaviour (docs/design/accessibility.md §1–§4)

- Native `<dialog>` + `showModal()` in the shadow root: top layer, inert page, `aria-modal="true"`,
  `aria-labelledby` the heading, `aria-describedby` the description (when present), and
  `role="alertdialog"` with `alert`. Without `showModal()` a fallback marks the rest of the page
  `inert`.
- Tab and Shift+Tab wrap through the dialog's tab stops in flattened-tree order, including slotted
  content and nested Zilo elements; one stop per radio group.
- Initial focus: `initialFocus`, else a slotted `[autofocus]`, else the first tab stop of the body
  or footer, else the close button. Return focus: the opener, else `returnFocus`.
- Escape and the close button fire `zilo-cancel` (`detail.reason`); call `preventDefault()` to keep
  the dialog open (for example to confirm a discard first). Then `zilo-close` fires.
- The page does not scroll while a dialog is open; the dialog body scrolls.
- `announce(message, 'polite' | 'assertive')` writes to live regions that exist from construction.
- Slots: `heading`, `description`, default (body), `footer`.

## Theming API

Contract: [docs/design/tokens.md](../../docs/design/tokens.md).

1. **Theme:** `theme="light" | "dark" | "auto"`. `auto` follows `prefers-color-scheme`. With no
   attribute, an element inherits the palette of the nearest Zilo ancestor that has one (so a button
   inside a dark dialog is dark), else behaves as `auto`.
2. **Custom properties** (the host sets them on the element or any ancestor; Zilo never declares
   them, so the host always wins):
   - Colour: `--zilo-color-{bg, surface-sunken, surface-raised, text, text-muted, border,
border-strong, accent, on-accent, focus, danger, danger-subtle, warning, warning-subtle,
success, success-subtle, info, info-subtle, scrim}`. Hover, pressed and subtle states derive
     from the accent. If the accent is light, also set `--zilo-color-on-accent` and keep 4.5:1.
   - Type: `--zilo-font-sans`, `--zilo-font-mono`. Shape: `--zilo-radius-{sm, md, lg}`.
     Stacking: `--zilo-z-index`. Size: `--zilo-dialog-width`, `--zilo-spinner-size`.
3. **Parts** for structural styling: dialog `dialog, header, heading, close-button, description,
body, footer`; button `button`; banner `banner, icon, title, content, actions, dismiss`; progress
   `track, bar`; spinner `spinner, label`.

```css
.my-app zilo-dialog {
  --zilo-color-accent: #5b3cc4;
  --zilo-radius-lg: 4px;
}
zilo-dialog::part(footer) {
  justify-content: space-between;
}
```

Reduced motion drops movement (the dialog fades, spinners pulse). Forced-colours mode maps accent,
focus and borders to system colours.
