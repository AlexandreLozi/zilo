// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ZiloBanner,
  ZiloButton,
  ZiloDialog,
  ZiloProgress,
  ZiloSpinner,
  type ZiloButtonElement,
  type ZiloDialogCloseReason,
  type ZiloDialogElement,
} from './index.js';

function shadow(el: Element | null, selector: string): HTMLElement {
  const found = el?.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

function pressEscape(): void {
  let target: Element | null = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  (target ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe('<ZiloButton>', () => {
  it('forwards its ref, sets typed props as properties and maps onClick', () => {
    const ref = createRef<ZiloButtonElement>();
    const onClick = vi.fn();
    const { rerender } = render(
      <ZiloButton ref={ref} variant="primary" busy onClick={onClick} theme="dark">
        Scan
      </ZiloButton>,
    );
    const el = ref.current;
    expect(el?.tagName).toBe('ZILO-BUTTON');
    expect(el?.variant).toBe('primary');
    expect(el?.busy).toBe(true);
    expect(el?.getAttribute('theme')).toBe('dark');
    expect(screen.getByText('Scan')).toBeTruthy();

    // happy-dom does not retarget shadow-origin events for React's root listener, so click the
    // host; the catalog e2e covers real clicks in Chromium, Firefox and WebKit.
    if (!el) throw new Error('no ref');
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <ZiloButton ref={ref} variant="primary" onClick={onClick}>
        Scan
      </ZiloButton>,
    );
    expect(el.busy).toBe(false);
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('passes DOM attributes through', () => {
    render(
      <ZiloButton id="go" className="wide" data-testid="go-btn" label="Refresh">
        ⟳
      </ZiloButton>,
    );
    const el = screen.getByTestId('go-btn');
    expect(el.id).toBe('go');
    expect(el.getAttribute('class')).toBe('wide');
    expect(shadow(el, 'button').getAttribute('aria-label')).toBe('Refresh');
  });
});

describe('<ZiloDialog>', () => {
  function Harness(props: {
    onCancel?: (reason: ZiloDialogCloseReason) => boolean;
    onClosed?: (reason: ZiloDialogCloseReason) => void;
    dialogRef?: React.Ref<ZiloDialogElement>;
  }): React.ReactElement {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setOpen(true);
          }}
        >
          Open
        </button>
        <ZiloDialog
          ref={props.dialogRef}
          open={open}
          heading="Discard pages?"
          alert
          onCancel={(event) => {
            if (props.onCancel && !props.onCancel(event.detail.reason)) event.preventDefault();
          }}
          onClose={(event) => {
            setOpen(false);
            props.onClosed?.(event.detail.reason);
          }}
        >
          <p>6 pages will be lost.</p>
          <button slot="footer" autoFocus>
            Keep pages
          </button>
        </ZiloDialog>
      </>
    );
  }

  it('opens from state, focuses [autofocus], closes on Escape and returns focus', () => {
    const ref = createRef<ZiloDialogElement>();
    const onClosed = vi.fn();
    render(<Harness dialogRef={ref} onClosed={onClosed} />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);

    const el = ref.current;
    expect(el?.open).toBe(true);
    expect(el?.heading).toBe('Discard pages?');
    expect(shadow(el ?? null, 'dialog').getAttribute('role')).toBe('alertdialog');
    expect(document.activeElement?.textContent).toBe('Keep pages');

    pressEscape();
    expect(onClosed).toHaveBeenCalledWith('escape');
    expect(el?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the dialog open when onCancel prevents it', () => {
    const ref = createRef<ZiloDialogElement>();
    const onClosed = vi.fn();
    render(<Harness dialogRef={ref} onCancel={() => false} onClosed={onClosed} />);
    fireEvent.click(screen.getByText('Open'));
    pressEscape();
    expect(ref.current?.open).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();
  });
});

describe('<ZiloBanner>, <ZiloProgress>, <ZiloSpinner>', () => {
  it('renders an alert banner with slots and maps onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <ZiloBanner variant="danger" dismissible onDismiss={onDismiss} data-testid="banner">
        <span slot="title">Scanner disconnected</span>
        Reconnect it and try again.
      </ZiloBanner>,
    );
    const el = screen.getByTestId('banner');
    expect(shadow(el, '[part="banner"]').getAttribute('role')).toBe('alert');
    shadow(el, '[part="dismiss"]').click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(el.hidden).toBe(true);
  });

  it('drives progress and spinner properties', () => {
    const { rerender } = render(<ZiloProgress data-testid="p" label="Scan progress" />);
    const bar = shadow(screen.getByTestId('p'), '[role="progressbar"]');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    rerender(<ZiloProgress data-testid="p" label="Scan progress" value={3} max={6} />);
    expect(bar.getAttribute('aria-valuenow')).toBe('3');

    render(<ZiloSpinner data-testid="s" label="Looking for scanners…" visibleLabel />);
    expect(shadow(screen.getByTestId('s'), '[part="label"]').textContent).toBe(
      'Looking for scanners…',
    );
  });
});
