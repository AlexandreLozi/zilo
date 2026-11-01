// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ZiloDialog } from './index.js';

afterEach(cleanup);

it('reports the initial controlled open through onOpen', () => {
  const onOpen = vi.fn();
  render(
    <ZiloDialog open heading="Review fixture" onOpen={onOpen}>
      <button>First</button>
    </ZiloDialog>,
  );
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it('applies initialFocus before opening in the same controlled update', () => {
  const content = (
    <>
      <button>First</button>
      <button id="safe-action">Safe action</button>
    </>
  );
  const { rerender } = render(<ZiloDialog heading="Review fixture">{content}</ZiloDialog>);
  const safe = document.querySelector<HTMLElement>('#safe-action');
  if (!safe) throw new Error('Missing safe action');
  rerender(
    <ZiloDialog open heading="Review fixture" initialFocus={safe}>
      {content}
    </ZiloDialog>,
  );
  expect(document.activeElement).toBe(safe);
});
