import { expect, test, type Page } from '@playwright/test';
import { stateUrl } from '../src/states.js';

/**
 * Layer ownership (packages/ui/README.md, integration contract): a layer opened after a Zilo dialog
 * (inside it, or above it in the top layer) owns the keys and pointer presses aimed at it, and the
 * Zilo dialog stays out of the way. With real keyboard and pointer input:
 * - host-modal-nested: Radix host dialog > Zilo dialog > Radix dialog portaled into a container
 *   inside the Zilo dialog (apps/catalog/src/host-modal.tsx);
 * - dialog-trigger: a Zilo dialog with a native popover or modal `<dialog>` opened inside it.
 */

const host = (page: Page) => page.getByRole('dialog', { name: 'Scan documents' });
const zilo = (page: Page) => page.getByRole('dialog', { name: 'Choose a scanner' });
const inner = (page: Page) => page.getByRole('dialog', { name: 'Scanner settings' });
const body = (page: Page) => page.locator('body');

/** `#id` of the deeply focused element; `#host>part|tag` inside a shadow root. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return 'none';
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) {
      return `#${root.host.id}>${el.getAttribute('part') ?? el.tagName.toLowerCase()}`;
    }
    return el.id ? `#${el.id}` : el.tagName.toLowerCase();
  });
}

/**
 * Counts Tab keydowns that reach the window (bubble phase). A Zilo dialog stops the Tab presses it
 * handles there, so this tells whether it took a Tab even when focus lands in the same place.
 */
async function countTabsAtWindow(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as Window & { tabsAtWindow?: number };
    w.tabsAtWindow = 0;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') w.tabsAtWindow = (w.tabsAtWindow ?? 0) + 1;
    });
  });
  return () =>
    page.evaluate(() => (window as Window & { tabsAtWindow?: number }).tabsAtWindow ?? 0);
}

/**
 * Radix arms a layer's outside-press listener (`pointerdown` on the document) in a `setTimeout(0)`
 * after each render that changes whether the layer takes outside presses, and removes the old one
 * first. When the inner layer closes, its listener is removed; the host re-renders (its pointer
 * events come back), removes its own and adds a new one a few tasks later. A press inside the host
 * in that gap (the one on the Zilo backdrop) still runs the host's `onPointerDownCapture`, which marks
 * the press as inside its React tree, but not the document listener that clears the mark: the host
 * then takes its next outside press for an inside one and stays open. That made the host's outside
 * click flaky under load. This records, in the page, the document's `pointerdown` listeners and
 * whether the last change added one: once the host's new listener is added after both removals, the
 * host is armed again.
 */
async function recordOutsidePressListeners(page: Page): Promise<() => Promise<boolean>> {
  await page.addInitScript(() => {
    const active = new Set<unknown>();
    let lastWasAdd = false;
    const add = Document.prototype.addEventListener;
    const remove = Document.prototype.removeEventListener;
    Document.prototype.addEventListener = function (
      this: Document,
      ...args: Parameters<Document['addEventListener']>
    ): void {
      if (args[0] === 'pointerdown') {
        active.add(args[1]);
        lastWasAdd = true;
      }
      add.apply(this, args);
    };
    Document.prototype.removeEventListener = function (
      this: Document,
      ...args: Parameters<Document['removeEventListener']>
    ): void {
      if (args[0] === 'pointerdown' && active.delete(args[1])) lastWasAdd = false;
      remove.apply(this, args);
    };
    (window as Window & { outsidePressArmed?: () => boolean }).outsidePressArmed = () =>
      lastWasAdd && active.size === 1;
  });
  return () =>
    page.evaluate(() =>
      Boolean((window as Window & { outsidePressArmed?: () => boolean }).outsidePressArmed?.()),
    );
}

/** Opens the host, the Zilo dialog inside it and the Radix dialog inside that, by keyboard. */
async function openThree(page: Page): Promise<void> {
  await page.goto(stateUrl('host-modal-nested', 'light'));
  await expect(page.locator('[data-state="host-modal-nested"]')).toBeAttached();
  await page.getByRole('button', { name: 'Scan documents' }).click();
  await expect(host(page)).toBeVisible();
  await page.getByRole('button', { name: 'Choose scanner' }).click();
  await expect(zilo(page)).toBeVisible();
  await expect.poll(() => focused(page)).toBe('#zilo-name');
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('#open-inner');
  await page.keyboard.press('Enter');
  await expect(inner(page)).toBeVisible();
  await expect.poll(() => focused(page)).toBe('#inner-dpi');
  // Radix registers a layer a few tasks after it mounts: it renders once more, with
  // pointer-events auto (from none), and then moves its Escape listener to the new highest layer.
  // Until then the outer host's listener is still the one armed, Zilo or not.
  await expect(inner(page)).toHaveCSS('pointer-events', 'auto');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
        });
      }),
  );
  // The inner layer really is inside the Zilo dialog, through the host's portal container.
  expect(
    await page.evaluate(() =>
      Boolean(document.querySelector('#zilo #zilo-layers [role="dialog"] #inner-dpi')),
    ),
  ).toBe(true);
}

test('Escape closes a Radix dialog inside the Zilo dialog first, then Zilo, then the host', async ({
  page,
}) => {
  await openThree(page);

  await page.keyboard.press('Escape');
  await expect(inner(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-inner-dismiss', 'escape');
  await expect(zilo(page)).toBeVisible();
  await expect(host(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-zilo-close', /.*/);
  // Radix returns focus to its trigger, inside the Zilo dialog.
  await expect.poll(() => focused(page)).toBe('#open-inner');

  await page.keyboard.press('Escape');
  await expect(zilo(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-zilo-close', 'escape');
  await expect(host(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-host-dismiss', /.*/);
  await expect.poll(() => focused(page)).toBe('#open-zilo');

  await page.keyboard.press('Escape');
  await expect(host(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-host-dismiss', 'escape');
});

test('Tab inside the Radix dialog is its own: the Zilo trap does not take it', async ({ page }) => {
  await openThree(page);
  const tabsAtWindow = await countTabsAtWindow(page);
  const forward: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    forward.push(await focused(page));
  }
  expect(forward).toEqual(['#inner-close', '#inner-dpi', '#inner-close', '#inner-dpi']);
  await page.keyboard.press('Shift+Tab');
  expect(await focused(page)).toBe('#inner-close');
  await page.keyboard.press('Shift+Tab');
  expect(await focused(page)).toBe('#inner-dpi');
  // None of the six was handled (and stopped) by the Zilo dialog.
  expect(await tabsAtWindow()).toBe(6);
  await expect(zilo(page)).toBeVisible();
});

test('outside clicks close the Radix dialog, then Zilo, then the host', async ({ page }) => {
  const hostArmed = await recordOutsidePressListeners(page);
  await openThree(page);

  // On the Zilo backdrop: outside the inner layer, which closes; the Zilo dialog stays. Radix arms
  // its outside-press listener a few tasks after opening, and an earlier press does nothing at all
  // (the Zilo dialog ignores it too, the inner layer being open), so press until it is armed.
  await expect(async () => {
    await page.mouse.click(4, 4);
    await expect(inner(page)).toBeHidden({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(body(page)).toHaveAttribute('data-inner-dismiss', 'outside');
  await expect(zilo(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-zilo-close', /.*/);

  // The host's outside-press listener, re-armed after the inner layer closed (see above), sees the
  // next press as inside the host, so the one after it counts as outside.
  await expect.poll(hostArmed).toBe(true);
  await page.mouse.click(4, 4);
  await expect(zilo(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-zilo-close', 'outside');
  await expect(host(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-host-dismiss', /.*/);

  await page.mouse.click(4, 4);
  await expect(host(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-host-dismiss', 'outside');
});

test('r1 regression: once the inner layer has closed, the host capture listener sees a claimed Escape', async ({
  page,
}) => {
  await openThree(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(inner(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-inner-dismiss', 'close');
  // Zilo is the topmost layer again: it claims Escape before Radix's document capture listener.
  await page.keyboard.press('Escape');
  await expect(zilo(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-zilo-close', 'escape');
  await expect(host(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-host-dismiss', /.*/);
});

test('Escape closes a native popover opened inside the Zilo dialog, focus staying on Zilo content', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const before = await focused(page);
  await page.locator('#dialog').evaluate((zilo) => {
    const popover = document.createElement('div');
    popover.id = 'popover';
    popover.popover = 'auto';
    popover.textContent = 'Suggestions';
    zilo.append(popover);
    popover.showPopover();
  });
  await expect(page.locator('#popover')).toBeVisible();
  expect(await focused(page)).toBe(before);

  await page.keyboard.press('Escape');
  await expect(page.locator('#popover')).toBeHidden();
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');

  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
});

test('a native modal opened inside the Zilo dialog keeps Tab and its backdrop', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await page.locator('#dialog').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'native-child';
    child.setAttribute('aria-label', 'Child modal');
    child.innerHTML = '<button id="child-a">A</button> <button id="child-b">B</button>';
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-a')).toBeFocused();
  const tabsAtWindow = await countTabsAtWindow(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('#child-b')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#child-a')).toBeFocused();
  expect(await tabsAtWindow()).toBe(2);

  // A press on the child's backdrop is not on the Zilo backdrop.
  await page.mouse.click(4, 4);
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(body(page)).not.toHaveAttribute('data-last-close', /.*/);
});

test('documented limit: under a Radix host, a native modal inside Zilo does not protect the host', async ({
  page,
}) => {
  // packages/ui/README.md, "What the host must do": Zilo leaves an Escape aimed at a newer layer
  // alone, so Radix's document capture listener sees it unclaimed, exactly as without Zilo.
  await page.goto(stateUrl('host-modal-radix', 'light'));
  await expect(page.locator('[data-state="host-modal-radix"]')).toBeAttached();
  await page.getByRole('button', { name: 'Scan documents' }).click();
  await page.getByRole('button', { name: 'Choose scanner' }).click();
  await expect(zilo(page)).toBeVisible();
  await page.locator('#zilo').evaluate((el) => {
    const child = document.createElement('dialog');
    child.id = 'native-child';
    child.setAttribute('aria-label', 'Child modal');
    child.innerHTML = '<button id="child-action">Child action</button>';
    el.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(host(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-host-dismiss', 'escape');
  await expect(body(page)).not.toHaveAttribute('data-zilo-close', /.*/);
});

/** Opens the Zilo dialog of the `dialog-trigger` state by pointer, as a user would. */
async function openZilo(page: Page): Promise<void> {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
}

type ClosedChildWindow = Window & { closedChild?: HTMLDialogElement };

/**
 * Appends to the Zilo dialog an element (`#closed-host`) whose closed shadow root holds a modal
 * `<dialog>` with one button, and opens it. With `handlesEscape`, the closed root has the README's
 * listener for a layer Zilo can't see. The page keeps the `<dialog>` as `window.closedChild`.
 */
async function openClosedRootModal(page: Page, handlesEscape: boolean): Promise<void> {
  await page.locator('#dialog').evaluate((zilo, handles) => {
    const host = document.createElement('div');
    host.id = 'closed-host';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<dialog aria-label="Child modal"><button>Child action</button></dialog>';
    const dialog = root.querySelector('dialog');
    if (!dialog) throw new Error('fixture');
    if (handles) {
      // packages/ui/README.md, "A layer inside a closed shadow root", word for word.
      root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dialog.open) {
          event.stopPropagation();
          dialog.close();
        }
      });
    }
    zilo.append(host);
    dialog.showModal();
    (window as ClosedChildWindow).closedChild = dialog;
  }, handlesEscape);
  // Focus is inside the closed root; from outside it, the host stands in for it.
  await expect(page.locator('#closed-host')).toBeFocused();
}

const closedChildOpen = (page: Page) =>
  page.evaluate(() => Boolean((window as ClosedChildWindow).closedChild?.open));

test('a native modal in a closed shadow root closes itself on Escape with the README listener', async ({
  page,
}) => {
  await openZilo(page);
  await openClosedRootModal(page, true);
  await page.keyboard.press('Escape');
  await expect.poll(() => closedChildOpen(page)).toBe(false);
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(body(page)).not.toHaveAttribute('data-last-close', /.*/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
});

test('documented limit: Zilo cannot see a layer in a closed shadow root and takes its Escape', async ({
  page,
}) => {
  // packages/ui/README.md, "What the host must do": the key is aimed at the closed root's host,
  // which is Zilo content, and nothing open is visible inside the root.
  await openZilo(page);
  await openClosedRootModal(page, false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
  expect(await closedChildOpen(page)).toBe(true);
});

test('a closed shadow root whose host is marked role="dialog" is a newer layer', async ({
  page,
}) => {
  await openZilo(page);
  await page.locator('#dialog').evaluate((zilo) => {
    // A component that renders its content in a closed root and marks its host as the dialog.
    const picker = document.createElement('div');
    picker.id = 'picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Picker');
    const root = picker.attachShadow({ mode: 'closed' });
    root.innerHTML = '<button>Pick</button>';
    // Like Radix, it cancels the Escape it handles (a native dialog under it must not close too).
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      picker.dataset['escapePrevented'] = String(event.defaultPrevented);
      event.preventDefault();
      picker.hidden = true;
    });
    zilo.append(picker);
    root.querySelector('button')?.focus();
  });
  await expect(page.locator('#picker')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#picker')).toHaveAttribute('data-escape-prevented', 'false');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
});

/** Appends a modal `<dialog id="native-child">` with `#child-action` to the Zilo dialog, opens it. */
async function openNativeChild(page: Page): Promise<void> {
  await page.locator('#dialog').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'native-child';
    child.setAttribute('aria-label', 'Child modal');
    child.innerHTML = '<button id="child-action">Child action</button>';
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
}

/**
 * Closes and reopens the Zilo dialog: it opens above any layer still open. Clears the recorded
 * close reason (`api`) of the close.
 */
async function reopenZilo(page: Page): Promise<void> {
  await page.locator('#dialog').evaluate((zilo) => {
    const dialog = zilo as HTMLElement & { close(): void; show(): void };
    dialog.close();
    delete document.body.dataset['lastClose'];
    dialog.show();
  });
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
}

test('a Zilo dialog reopened while its native child stays open is above the child', async ({
  page,
}) => {
  await openZilo(page);
  await openNativeChild(page);
  await reopenZilo(page);
  await expect(page.locator('#native-child')).toHaveAttribute('open', '');
  // Initial focus is on Zilo's own content, not in the child below it.
  await expect(page.locator('#scanner-name')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
  await expect(page.locator('#native-child')).toHaveAttribute('open', '');

  // The child is the topmost layer: Escape is the browser's again.
  await page.keyboard.press('Escape');
  await expect(page.locator('#native-child')).not.toHaveAttribute('open');
});

test('a Zilo dialog closed and reopened in one task stays open when that close event arrives', async ({
  page,
}) => {
  await openZilo(page);
  await page.locator('#dialog').evaluate(async (zilo) => {
    const dialog = zilo as HTMLElement & { close(): void; show(): void };
    const native = zilo.shadowRoot?.querySelector('dialog');
    if (!native) throw new Error('fixture');
    const closed = new Promise((resolve) => {
      native.addEventListener('close', resolve, { once: true });
    });
    dialog.close();
    dialog.show();
    // The browser fires the native close event in a later task, after the reopening.
    await closed;
  });
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#scanner-name')).toBeFocused();
  await expect(body(page)).toHaveAttribute('data-last-close', 'api');
});

test('a child reopened after its reopened Zilo dialog is above it again', async ({ page }) => {
  await openZilo(page);
  await openNativeChild(page);
  await reopenZilo(page);
  await page.locator('#native-child').evaluate((child: HTMLDialogElement) => {
    child.close();
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#native-child')).not.toHaveAttribute('open');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(body(page)).not.toHaveAttribute('data-last-close', /.*/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
});

test('under a host that ignores the Escape, content in the native child that stops it keeps the child open', async ({
  page,
}) => {
  // As in review-r3.spec.ts: the host's callback cancels the Escape before Radix sees it.
  await page.addInitScript(() => {
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && document.querySelector<HTMLDialogElement>('#child')?.open) {
          event.preventDefault();
        }
      },
      true,
    );
  });
  await page.goto(stateUrl('host-modal-radix', 'light'));
  await page.getByRole('button', { name: 'Scan documents' }).click();
  await page.getByRole('button', { name: 'Choose scanner' }).click();
  await page.locator('#zilo').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'child';
    child.innerHTML = '<input id="child-search" aria-label="Search" />';
    // Content that keeps Escape for itself (say, to clear a search) stops it (README).
    child.querySelector('input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopPropagation();
    });
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#child')).toHaveAttribute('open', '');
  await expect(host(page)).toBeVisible();
  await expect(page.locator('#zilo')).toHaveAttribute('open', '');
  await expect(body(page)).not.toHaveAttribute('data-host-dismiss', /.*/);
});

test('with its initial focus in an older native child, Escape still closes the Zilo dialog above it', async ({
  page,
}) => {
  // packages/ui/README.md: Zilo takes the focused child for newer and leaves Escape to the browser,
  // which closes the topmost layer, the Zilo dialog, through its `cancel` event.
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'native-child';
    child.setAttribute('aria-label', 'Child modal');
    child.innerHTML = '<button id="child-action" autofocus>Child action</button>';
    zilo.append(child);
    child.showModal();
    (zilo as HTMLElement & { show(): void }).show();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toHaveAttribute('open');
  await expect(body(page)).toHaveAttribute('data-last-close', 'escape');
  await expect(page.locator('#native-child')).toHaveAttribute('open', '');
});
