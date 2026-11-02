import { expect, test, type Page } from '@playwright/test';
import { stateUrl } from '../src/states.js';

/**
 * Describes the deeply focused element: `#id` for light DOM, `#host>part|tag` inside a shadow root
 * (so `#dialog-save>button` is the inner button of `<zilo-button id="dialog-save">`).
 */
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

async function openWithKeyboard(page: Page): Promise<void> {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).focus();
  expect(await focused(page)).toBe('#open-dialog>button');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Rename scanner' })).toBeVisible();
}

const cycle = [
  '#scanner-name',
  '#dialog-cancel>button',
  '#dialog-save>button',
  '#dialog>close-button',
];

test('initial focus goes to the first field in the dialog', async ({ page }) => {
  await openWithKeyboard(page);
  expect(await focused(page)).toBe('#scanner-name');
});

test('Tab cycles through the dialog and wraps from last to first', async ({ page }) => {
  await openWithKeyboard(page);
  const seen: string[] = [];
  for (let i = 0; i < cycle.length * 2; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focused(page));
  }
  const expected = [...cycle.slice(1), ...cycle, cycle[0] ?? ''];
  expect(seen).toEqual(expected);
});

test('Shift+Tab cycles backwards and wraps from first to last', async ({ page }) => {
  await openWithKeyboard(page);
  const seen: string[] = [];
  for (let i = 0; i < cycle.length; i++) {
    await page.keyboard.press('Shift+Tab');
    seen.push(await focused(page));
  }
  expect(seen).toEqual([...cycle].reverse());
});

test('focus never reaches the page while the dialog is open', async ({ page }) => {
  await openWithKeyboard(page);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(cycle).toContain(await focused(page));
  }
});

test('Escape closes the dialog and returns focus to the trigger', async ({ page }) => {
  await openWithKeyboard(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-last-close', 'escape');
  expect(await focused(page)).toBe('#open-dialog>button');
});

test('the close button closes the dialog and returns focus', async ({ page }) => {
  await openWithKeyboard(page);
  await page.keyboard.press('Shift+Tab');
  expect(await focused(page)).toBe('#dialog>close-button');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-last-close', 'close-button');
  expect(await focused(page)).toBe('#open-dialog>button');
});

test('a footer action closes the dialog and returns focus', async ({ page }) => {
  await openWithKeyboard(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await focused(page)).toBe('#open-dialog>button');
});

test('the page behind does not scroll while open', async ({ page }) => {
  await openWithKeyboard(page);
  const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
  expect(overflow).toBe('hidden');
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
  expect(after).not.toBe('hidden');
});

test('the alert dialog focuses its safe action', async ({ page }) => {
  await page.goto(stateUrl('dialog-alert', 'dark'));
  await expect(page.getByRole('alertdialog', { name: 'Discard 6 pages?' })).toBeVisible();
  expect(await focused(page)).toBe('#dialog-cancel>button');
});

test('a nested button inherits the dark theme from its dialog', async ({ page }) => {
  await page.goto(stateUrl('dialog-open', 'dark'));
  const bg = await page
    .locator('#dialog-cancel')
    .evaluate(
      (el) => getComputedStyle(el.shadowRoot?.querySelector('button') ?? el).backgroundColor,
    );
  expect(bg).toBe('rgb(26, 28, 32)');
});

test('theme="auto" follows the system colour scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(stateUrl('dialog-open', 'light'));
  await page.locator('#dialog').evaluate((el) => {
    el.setAttribute('theme', 'auto');
  });
  const bg = await page
    .locator('#dialog')
    .evaluate(
      (el) => getComputedStyle(el.shadowRoot?.querySelector('dialog') ?? el).backgroundColor,
    );
  expect(bg).toBe('rgb(26, 28, 32)');
});
