import type { CatalogStateId } from './states.js';

const refreshIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>';

const dialogBody = `
  <p>Give this scanner a name that is easy to recognise.</p>
  <label for="scanner-name">Name</label>
  <input id="scanner-name" name="scanner-name" value="Canon DR-C225 II" />
  <zilo-button slot="footer" id="dialog-cancel">Cancel</zilo-button>
  <zilo-button slot="footer" id="dialog-save" variant="primary">Save</zilo-button>`;

const longBody = Array.from(
  { length: 24 },
  (_, i) =>
    `<p>Paragraph ${String(i + 1)}. The page behind the dialog does not scroll; this body scrolls inside the dialog instead.</p>`,
).join('');

/** Static, trusted markup for each catalog state. */
export const specimens: Readonly<Record<CatalogStateId, string>> = {
  'button-secondary': '<zilo-button>Refresh</zilo-button>',
  'button-primary': '<zilo-button variant="primary">Scan</zilo-button>',
  'button-ghost': '<zilo-button variant="ghost">Keyboard shortcuts</zilo-button>',
  'button-danger': '<zilo-button variant="danger">Discard pages</zilo-button>',
  'button-small': '<zilo-button size="sm">Rotate</zilo-button>',
  'button-disabled': '<zilo-button variant="primary" disabled>Scan</zilo-button>',
  'button-busy': '<zilo-button variant="primary" busy>Scanning…</zilo-button>',
  'button-icon': `<zilo-button variant="ghost" label="Refresh">${refreshIcon}</zilo-button>`,
  'button-host-override': `
    <div class="host-override">
      <zilo-button variant="primary">Scan</zilo-button>
      <zilo-button>Cancel</zilo-button>
    </div>`,
  'banner-info': `
    <zilo-banner variant="info">
      <span slot="title">No physical scanners found</span>
      The Zilo Virtual Scanner is selected so you can try a test scan.
    </zilo-banner>`,
  'banner-success': `
    <zilo-banner variant="success">
      <span slot="title">Scan finished</span>
      6 pages scanned.
    </zilo-banner>`,
  'banner-warning': `
    <zilo-banner variant="warning">
      <span slot="title">Settings adjusted</span>
      The scanner used 300 dpi because 250 dpi is not supported.
    </zilo-banner>`,
  'banner-danger': `
    <zilo-banner variant="danger">
      <span slot="title">The scanner is not responding</span>
      Check that it is switched on and connected, then try again.
      <zilo-button slot="actions" size="sm" variant="primary">Try again</zilo-button>
      <zilo-button slot="actions" size="sm">Copy details</zilo-button>
    </zilo-banner>`,
  'banner-dismissible': `
    <zilo-banner variant="info" dismissible>
      <span slot="title">Tip</span>
      Press R to rotate the focused page.
    </zilo-banner>`,
  'progress-determinate':
    '<zilo-progress label="Scan progress" value="3" max="6" value-text="Scanning page 3 of 6"></zilo-progress>',
  'progress-indeterminate':
    '<zilo-progress label="Scan progress" value-text="Scanning page 3…"></zilo-progress>',
  'spinner-default': '<zilo-spinner label="Loading settings"></zilo-spinner>',
  'spinner-visible-label':
    '<zilo-spinner label="Looking for scanners…" visible-label></zilo-spinner>',
  'dialog-trigger': `
    <p><label for="page-search">Page search</label> <input id="page-search" /></p>
    <zilo-button id="open-dialog" variant="primary">Open dialog</zilo-button>
    <zilo-dialog id="dialog" heading="Rename scanner">${dialogBody}</zilo-dialog>`,
  'dialog-open': `<zilo-dialog id="dialog" heading="Rename scanner" open>${dialogBody}</zilo-dialog>`,
  'dialog-description': `
    <zilo-dialog id="dialog" heading="Allow this site to scan?" description="example.com wants to use your scanners." open>
      <zilo-button slot="footer" id="dialog-cancel">Deny</zilo-button>
      <zilo-button slot="footer" id="dialog-save" variant="primary">Allow</zilo-button>
    </zilo-dialog>`,
  'dialog-alert': `
    <zilo-dialog id="dialog" heading="Discard 6 pages?" alert open>
      <span slot="description">The scanned pages have not been saved and will be lost.</span>
      <zilo-button slot="footer" id="dialog-cancel" autofocus>Keep pages</zilo-button>
      <zilo-button slot="footer" id="dialog-save" variant="danger">Discard</zilo-button>
    </zilo-dialog>`,
  'dialog-scroll': `
    <zilo-dialog id="dialog" heading="Keyboard shortcuts" open>
      ${longBody}
      <zilo-button slot="footer" id="dialog-cancel" variant="primary">Done</zilo-button>
    </zilo-dialog>`,
  // Rendered by React into this element (host-modal.tsx).
  'host-modal-radix': '<div id="host-modal-root"></div>',
};
