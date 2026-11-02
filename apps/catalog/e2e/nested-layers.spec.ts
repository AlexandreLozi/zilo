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
