import * as Dialog from '@radix-ui/react-dialog';
import { ZiloButton, ZiloDialog, type ZiloDialogCloseReason } from '@zilo/react';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogTheme } from './states.js';

/**
 * Host-modal fixture: a React app whose own modal is a Radix `Dialog`, opening a `<zilo-dialog>`
 * from inside it. The host follows the integration contract in `packages/ui/README.md` and has no
 * workarounds: no `body.style` resets, no `onPointerDownOutside` / `onEscapeKeyDown` blocking. Its
 * content is made deliberately hostile to stacking (huge z-index, `transform`, `overflow: hidden`).
 *
 * The body records what happened for the E2E suite: `data-host-dismiss` (why Radix closed:
 * `escape`, `outside` or `close`), `data-zilo-close` (the Zilo dialog's close reason) and
 * `data-zilo-action` (a footer action ran).
 */
function HostModal({ theme }: { readonly theme: CatalogTheme }): React.JSX.Element {
  const [hostOpen, setHostOpen] = useState(false);
  const [ziloOpen, setZiloOpen] = useState(false);
  // What Radix is about to dismiss for; its handlers run before onOpenChange(false).
  const dismissCause = useRef('close');

  const record = (key: 'hostDismiss' | 'ziloClose' | 'ziloAction', value: string): void => {
    document.body.dataset[key] = value;
  };

  return (
    <Dialog.Root
      open={hostOpen}
      onOpenChange={(open) => {
        if (!open) record('hostDismiss', dismissCause.current);
        dismissCause.current = 'close';
        setHostOpen(open);
      }}
    >
      <Dialog.Trigger className="host-button" id="host-trigger">
        Scan documents
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="host-overlay" />
        <Dialog.Content
          className="host-content"
          onEscapeKeyDown={(event) => {
            // Radix calls this for every Escape, and dismisses unless it is already prevented.
            if (!event.defaultPrevented) dismissCause.current = 'escape';
          }}
          onPointerDownOutside={() => {
            dismissCause.current = 'outside';
          }}
        >
          <Dialog.Title className="host-title">Scan documents</Dialog.Title>
          <Dialog.Description>The host app's own modal (Radix Dialog).</Dialog.Description>
          <label className="host-field">
            Batch name
            <input id="host-batch" defaultValue="Invoices" />
          </label>
          <div className="host-actions">
            <button
              type="button"
              className="host-button"
              id="open-zilo"
              onClick={() => {
                setZiloOpen(true);
              }}
            >
              Choose scanner
            </button>
            <Dialog.Close className="host-button" id="host-close">
              Close
            </Dialog.Close>
          </div>
          <ZiloDialog
            id="zilo"
            theme={theme}
            open={ziloOpen}
            heading="Choose a scanner"
            onClose={(event) => {
              const reason: ZiloDialogCloseReason = event.detail.reason;
              record('ziloClose', reason);
              setZiloOpen(false);
            }}
          >
            <label htmlFor="zilo-name">Scanner name</label>
            <input id="zilo-name" defaultValue="Canon DR-C225 II" />
            <ZiloButton
              slot="footer"
              id="zilo-cancel"
              onClick={() => {
                setZiloOpen(false);
              }}
            >
              Cancel
            </ZiloButton>
            <ZiloButton
              slot="footer"
              id="zilo-use"
              variant="primary"
              onClick={() => {
                record('ziloAction', 'use');
                setZiloOpen(false);
              }}
            >
              Use scanner
            </ZiloButton>
          </ZiloDialog>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Renders the fixture into `root`; resolves once React has committed it. */
export function mountHostModal(root: HTMLElement, theme: CatalogTheme): Promise<void> {
  return new Promise((resolve) => {
    const Ready = (): null => {
      useEffect(resolve, []);
      return null;
    };
    createRoot(root).render(
      <StrictMode>
        <HostModal theme={theme} />
        <Ready />
      </StrictMode>,
    );
  });
}
