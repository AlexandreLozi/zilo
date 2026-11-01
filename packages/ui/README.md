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
- Tab stops use the effective disabled state (a `disabled` `<fieldset>` disables its controls,
  except in its first `<legend>`), and `display: contents` wrappers are walked through.
- Initial focus: `initialFocus`, else a slotted `[autofocus]`, else the first tab stop of the body
  or footer, else the close button. Return focus: the opener, else `returnFocus`, else the
  enclosing host dialog (see below).
- Escape, the close button and a click on the backdrop fire `zilo-cancel` (`detail.reason`:
  `escape`, `close-button`, `outside`); call `preventDefault()` to keep the dialog open (for example
  to confirm a discard first). Then `zilo-close` fires. Only the topmost dialog reacts.
- The page does not scroll while a dialog is open; the dialog body scrolls.
- `announce(message, 'polite' | 'assertive')` writes to live regions that exist from construction.
- Slots: `heading`, `description`, default (body), `footer`.

## Inside a host app's modal (Radix and similar)

A Zilo dialog can be opened from inside a host's own modal, such as a Radix `Dialog`, with no
workarounds in the host. The catalog's `host-modal-radix` state is the reference fixture, tested in
Chromium, Firefox and WebKit (`apps/catalog/e2e/host-modal.spec.ts`).

How Zilo coordinates with the host modal:

- **Stacking:** `showModal()` puts the dialog in the top layer, above any z-index, portal,
  `transform` or `overflow: hidden` of the host. The rest of the page, the host modal included,
  is inert while it is open.
- **Escape:** while a Zilo dialog is open, it claims Escape in the _window capture_ phase with
  `preventDefault()`. That runs before document capture listeners such as Radix's, which leave
  their dialog open when the key is already prevented. The dialog then closes in its own handler and
  stops propagation, so bubble-phase host handlers (MUI, React Aria and similar) don't see the key.
- **Outside click:** a click on the Zilo backdrop closes the Zilo dialog (`reason: 'outside'`). The
  press lands on the `<zilo-dialog>` element, which is inside the host's content, so the host does
  not treat it as outside its own modal. The next outside click belongs to the host.
- **Focus:** Tab and Shift+Tab are handled by the Zilo dialog and do not propagate, so an
  enclosing trap never moves focus a second time. Focus returns to the opener inside the host. If the
  opener is gone, it goes to the nearest enclosing `<dialog>` or `role="dialog"` element (focused
  directly when it has `tabindex`, else its first tab stop), so the host's trap keeps working.
- **Pointer events:** the dialog and its backdrop declare `pointer-events: auto`, so a host lock on
  `body` (Radix sets `body.style.pointerEvents = 'none'`) or on any ancestor does not lock it out.

The host **must**:

- render `<zilo-dialog>` (or `<ZiloDialog>`) as a DOM descendant of its modal's content element.
  Don't portal it out to `body`: the host's focus trap and `aria-hidden` handling only spare their
  own content;
- leave Escape and outside-click handling to the libraries. Don't stop Escape in a listener that
  runs before the window capture phase, and don't open other host modals or popovers from inside a
  Zilo dialog unless they render inside it.

The host **must not** (none of these are needed):

- reset `body.style.pointerEvents` or other `body` styles;
- block `onPointerDownOutside`, `onInteractOutside` or `onEscapeKeyDown`;
- raise z-indexes to place the Zilo dialog.

Content inside a Zilo dialog that wants Escape for itself (for example a custom listbox) must stop
its propagation in a native listener on that content, or in React's `onKeyDownCapture`. Calling only
`preventDefault()` is not enough, because the dialog has already claimed the key. Known limit:
Radix layers nested _inside_ a Zilo dialog don't get Escape, so Escape closes the Zilo dialog.

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
