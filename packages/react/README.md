# @zilo/react

The first-class React (TSX) wrapper for the [`@zilo/ui`](../ui/README.md) Web Components (OD-8).
React 19 is a peer dependency. Importing this package registers the custom elements.

```tsx
import { ZiloButton, ZiloDialog } from '@zilo/react';

function DiscardDialog({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <ZiloDialog
      open={open}
      heading="Discard 6 pages?"
      alert
      onCancel={(event) => {
        // Escape or the close button. Call event.preventDefault() to keep the dialog open.
      }}
      onClose={() => {
        onDone();
      }}
    >
      <p>The scanned pages will be lost.</p>
      <ZiloButton slot="footer" autoFocus onClick={onDone}>
        Keep pages
      </ZiloButton>
      <ZiloButton slot="footer" variant="danger" onClick={onDone}>
        Discard
      </ZiloButton>
    </ZiloDialog>
  );
}
```

- **Components:** `ZiloDialog`, `ZiloButton`, `ZiloBanner`, `ZiloProgress`, `ZiloSpinner`.
- **Typed props** are assigned to the element as properties (booleans and element references such
  as `initialFocus` work). Omitting a prop resets it to the element default. Other props (`id`,
  `className`, `slot`, `aria-*`, `data-*`, `onClick`, …) pass through to the element.
- **Events** map to callbacks with typed `CustomEvent`s: `ZiloDialog` `onOpen`, `onCancel`,
  `onClose` (`event.detail.reason` is `escape`, `close-button` or `api`); `ZiloBanner` `onDismiss`.
- **Refs** are forwarded to the custom element (`ZiloDialogElement`, `ZiloButtonElement`, …), so
  `ref.current.announce('Page 3 scanned')` works.
- `ZiloDialog` is controlled through `open`: set your state to `false` in `onClose`.
- `createZiloComponent` builds a wrapper for a new element in the same way.
