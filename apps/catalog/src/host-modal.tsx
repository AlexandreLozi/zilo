import * as Dialog from '@radix-ui/react-dialog';
import { ZiloButton, ZiloDialog, type ZiloDialogCloseReason } from '@zilo/react';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogStateId, CatalogTheme } from './states.js';

/**
 * Host-modal fixture: a React app whose own modal is a Radix `Dialog`, opening a `<zilo-dialog>`
 * from inside it. The host follows the integration contract in `packages/ui/README.md` and has no
 * workarounds: no `body.style` resets, no `onPointerDownOutside` / `onEscapeKeyDown` blocking. Its
 * content is made deliberately hostile to stacking (huge z-index, `transform`, `overflow: hidden`).
 *
 * The body records what happened for the E2E suite: `data-host-dismiss` (why Radix closed:
 * `escape`, `outside` or `close`), `data-zilo-close` (the Zilo dialog's close reason) and
 * `data-zilo-action` (a footer action ran).
 *
 * With `nested`, the Zilo dialog's content also opens a second Radix `Dialog` (`data-inner-dismiss`
 * records why it closed). It is portaled into a container inside the Zilo dialog, as the README's
 * integration contract requires of layers opened from inside one.
 */
type RecordKey = 'hostDismiss' | 'ziloClose' | 'ziloAction' | 'innerDismiss';

function record(key: RecordKey, value: string): void {
  document.body.dataset[key] = value;
}

function HostModal({
  theme,
  nested,
}: {
  readonly theme: CatalogTheme;
  readonly nested: boolean;
}): React.JSX.Element {
  const [hostOpen, setHostOpen] = useState(false);
  const [ziloOpen, setZiloOpen] = useState(false);
  // What Radix is about to dismiss for; its handlers run before onOpenChange(false).
  const dismissCause = useRef('close');

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
            {nested ? <InnerSettings /> : null}
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

/** A Radix dialog opened from inside the Zilo dialog, portaled into a container inside it. */
function InnerSettings(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [layers, setLayers] = useState<HTMLDivElement | null>(null);
  const dismissCause = useRef('close');
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) record('innerDismiss', dismissCause.current);
        dismissCause.current = 'close';
        setOpen(next);
      }}
    >
      <p>
        <Dialog.Trigger className="host-button" id="open-inner">
          Scanner settings
        </Dialog.Trigger>
      </p>
      {/* The host's portal container for layers opened from inside the Zilo dialog. */}
      <div id="zilo-layers" ref={setLayers} />
      {layers ? (
        <Dialog.Portal container={layers}>
          <Dialog.Content
            className="inner-content"
            onEscapeKeyDown={(event) => {
              if (!event.defaultPrevented) dismissCause.current = 'escape';
            }}
            onPointerDownOutside={() => {
              dismissCause.current = 'outside';
            }}
          >
            <Dialog.Title className="host-title">Scanner settings</Dialog.Title>
            <Dialog.Description>A Radix Dialog opened inside the Zilo dialog.</Dialog.Description>
            <label className="host-field">
              Resolution
              <input id="inner-dpi" defaultValue="300 dpi" />
            </label>
            <div className="host-actions">
              <Dialog.Close className="host-button" id="inner-close">
                Done
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}

/** Renders the fixture for `state` into `root`; resolves once React has committed it. */
export function mountHostModal(
  root: HTMLElement,
  theme: CatalogTheme,
  state: CatalogStateId,
): Promise<void> {
  return new Promise((resolve) => {
    const Ready = (): null => {
      useEffect(resolve, []);
      return null;
    };
    createRoot(root).render(
      <StrictMode>
        <HostModal theme={theme} nested={state === 'host-modal-nested'} />
        <Ready />
      </StrictMode>,
    );
  });
}
