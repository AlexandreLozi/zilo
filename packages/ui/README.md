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
  to confirm a discard first). Then `zilo-close` fires. Only the topmost dialog reacts, and only
  while no newer layer is open (see "Layers opened inside a Zilo dialog" below).
- The page does not scroll while a dialog is open; the dialog body scrolls.
- `announce(message, 'polite' | 'assertive')` writes to live regions that exist from construction.
- Slots: `heading`, `description`, default (body), `footer`.

## Inside a host app's modal (Radix and similar)

A Zilo dialog can be opened from inside a host's own modal, such as a Radix `Dialog`, with no
workarounds in the host. The catalog's `host-modal-radix` state is the reference fixture, tested in
Chromium, Firefox and WebKit (`apps/catalog/e2e/host-modal.spec.ts`). `host-modal-nested` adds a
second Radix `Dialog` opened inside the Zilo dialog (`apps/catalog/e2e/nested-layers.spec.ts`).

How Zilo coordinates with the host modal:

- **Stacking:** `showModal()` puts the dialog in the top layer, above any z-index, portal,
  `transform` or `overflow: hidden` of the host. The rest of the page, the host modal included,
  is inert while it is open.
- **Escape:** while a Zilo dialog is the topmost layer, it claims Escape in the _window capture_
  phase with `preventDefault()`. That runs before document capture listeners such as Radix's, which
  leave their dialog open when the key is already prevented. The dialog then closes in its own
  handler and stops propagation, so bubble-phase host handlers (MUI, React Aria and similar) don't
  see the key.
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
  runs before the window capture phase;
- render modals, popovers and menus opened from inside a Zilo dialog inside it: as its DOM
  descendants, or through a portal container placed inside it (see below).

The host **must not** (none of these are needed):

- reset `body.style.pointerEvents` or other `body` styles;
- block `onPointerDownOutside`, `onInteractOutside` or `onEscapeKeyDown`;
- raise z-indexes to place the Zilo dialog.

### Layers opened inside a Zilo dialog

A Zilo dialog claims a key or a pointer press only when it is the topmost layer and the event is
aimed at its own content. A **newer layer** is one above it: opened after it, inside it or above it
in the top layer. Zilo recognises:

- a `<dialog>`: a modal one (`showModal()`), or a non-modal one (`show()`) while it holds focus;
- a popover: an `auto` or `hint` one while it is shown, or a `manual` one while it holds focus;
- an element with `role="dialog"`, `role="alertdialog"` or `aria-modal="true"` inside the Zilo
  dialog (Radix, Headless UI, React Aria and similar dialogs and popovers render one), while it is
  rendered: an **ARIA layer**.

Zilo tells newer layers from older ones when each key or press arrives, from the live state of the
page (`open`, `:modal`, `:popover-open`, rendering), not from a record of what opened when:

- A layer around the focused element, or around the pressed one, is newer. Under the Zilo dialog's
  modal top layer everything outside it is inert, so focus and presses only reach a layer above it
  or nested inside it. A nested `<dialog>` or popover gets the focus when it opens after the Zilo
  dialog; if one that opened before holds the focus (the Zilo dialog's initial focus went there),
  Zilo leaves Escape to the browser, which closes the topmost layer: the Zilo dialog, through its
  `cancel` event.
- A shown `auto` or `hint` popover is newer, focused or not: `showModal()` hides every such popover
  that does not enclose the dialog, so one shown now was shown after it.
- A modal `<dialog>` that does not hold the focus counts only while nothing inside the Zilo dialog
  is focused: focus in the Zilo dialog means nothing modal is above it. With nothing focused and an
  older modal still open elsewhere, Zilo can't tell which is on top, so it leaves Escape to the
  browser, which closes the topmost one (for the Zilo dialog, through its `cancel` event).
- An enclosing host modal and the Zilo dialogs open below this one are never newer.
- An ARIA layer has no open or close event to read, so the Zilo dialog records the ARIA layers
  already rendered when it opens: they are its content (an inline region, say), not newer layers.
  The record can't go stale: it observes every root it scanned (the document and each open shadow
  root) and drops an element once it is removed, its `role`, `aria-modal`, `popover` or `hidden`
  attribute changes, or it is not rendered after any change; each key or press first applies the
  changes not yet delivered. So an ARIA layer that closes and opens again is newer. It stays content
  only if it was hidden and shown again within one task by other means (a class), or hidden by a
  style change that touched no attribute (a media query): mount a new element. Each opening of the
  Zilo dialog records afresh, so a layer still open when the Zilo dialog reopens is its content.

While a newer layer is open, or holds the focus or target of the event, the Zilo dialog does nothing
with it: no `preventDefault()`, no `stopPropagation()`, no close. So:

- **Escape** goes to the newer layer the normal way: a native `cancel` for `<dialog>` and popovers,
  or the library's own listener. Radix layers stack, so with Radix host > Zilo > Radix dialog the
  first Escape closes the inner Radix dialog, the second closes Zilo and the third the host. If a
  listener outside a native layer (a modal `<dialog>`, or an `auto` or `hint` popover) cancels that
  Escape, the browser won't dismiss the layer; the Zilo dialog then dismisses it as the browser
  would: a `cancel` event, then `close()` (`requestClose()` where supported), or `hidePopover()`.
  "Outside" means before the key reaches the layer, or the focused element for a popover that does
  not hold the focus. Content in the layer that keeps Escape for itself stops its propagation.
- **Tab** is the newer layer's (its own focus trap, or the browser's); the Zilo trap does not move
  it.
- **Pointer presses** on the Zilo backdrop are outside the newer layer, not the Zilo dialog: the
  newer layer may close on them; the Zilo dialog stays open. The next press is the Zilo dialog's.
- **Focus** that moves into a newer layer above the Zilo dialog is not pulled back.

For React portals, give the library a container inside the Zilo dialog's content, for example
Radix `<Dialog.Portal container={ref}>` with `<div ref={ref} />` as a child of `<ZiloDialog>`.

What the host must do for layers Zilo can't detect:

- A layer without one of the markers above (a plain `<div>` dropdown with its own Escape listener):
  give it `role="dialog"` (or the right popover semantics), or stop Escape in a native listener on
  that layer, or in React's `onKeyDownCapture`. Calling only `preventDefault()` is not enough: the
  Zilo dialog has already claimed the key. Content that wants Escape for itself (for example a
  custom listbox) does the same.
- A layer inside a closed shadow root: from outside, a key pressed inside the root is aimed at the
  root's host element. If that host is marked as a layer (`role="dialog"` or `aria-modal="true"`),
  it is one. Otherwise Zilo can't know that a `<dialog>` or popover inside the root is open: it
  claims Escape as aimed at its own content, so the browser does not close that layer, and closes
  itself. Have the layer close itself and stop the key, in a listener on its shadow root (pinned by
  tests in `nested-layers.spec.ts`):

  ```js
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.open) {
      event.stopPropagation();
      dialog.close();
    }
  });
  ```

- Under a host whose Escape listener runs in the document capture phase (Radix), a newer layer that
  is _not_ part of that library's layer stack (a native `<dialog>` or popover) does not protect the
  host: the host's listener sees an unclaimed Escape and closes the host, with the Zilo dialog and
  the layer inside it, as it would without Zilo (pinned by a test in `nested-layers.spec.ts`). Use a
  layer from the host's library (it stacks), or have the host ignore that Escape (for Radix:
  `onEscapeKeyDown={(e) => { if (layerOpen) e.preventDefault(); }}`). That cancels the browser's
  own dismissal of the native layer too; the Zilo dialog then dismisses the layer (see **Escape**
  above), so the layer closes while the host and the Zilo dialog stay open (pinned by
  `review-r3.spec.ts`).

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
