// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ZiloDialog } from './index.js';

afterEach(cleanup);

it('applies returnFocus before closing in the same controlled update', () => {
  const view = (open: boolean, withOpener: boolean, returnFocus: HTMLElement | null) => (
    <>
      {withOpener ? <button id="opener">Opener</button> : null}
      <button id="target">Target</button>
      <ZiloDialog open={open} heading="Fixture" returnFocus={returnFocus}>
        <button>Inside</button>
      </ZiloDialog>
    </>
  );
  const { rerender } = render(view(false, true, null));
  document.querySelector<HTMLElement>('#opener')?.focus();
  rerender(view(true, true, null));
  const target = document.querySelector<HTMLElement>('#target');
  if (!target) throw new Error('fixture');
  // The opener goes away in the same update that closes and sets the fallback.
  rerender(view(false, false, target));
  expect(document.activeElement).toBe(target);
});

it('fires onOpen once per opening, including the initial one', () => {
  const onOpen = vi.fn();
  const { rerender } = render(<ZiloDialog open heading="Fixture" onOpen={onOpen} />);
  rerender(<ZiloDialog open={false} heading="Fixture" onOpen={onOpen} />);
  rerender(<ZiloDialog open heading="Fixture" onOpen={onOpen} />);
  expect(onOpen).toHaveBeenCalledTimes(2);
});
