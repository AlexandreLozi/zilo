import { expect, test } from '@playwright/test';
import { stateUrl } from '../src/states.js';

test('Zilo does not override a host intentionally keeping its separate native modal open', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await page.evaluate(() => {
    const modal = document.createElement('dialog');
    modal.id = 'host-native';
    modal.innerHTML = '<section><button id="host-action">Host action</button></section>';
    document.body.append(modal);
    // A host-level policy deliberately cancels Escape, not a Radix parent-dismiss workaround.
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && modal.open) event.preventDefault();
      },
      true,
    );
    modal.showModal();
  });
  await expect(page.locator('#host-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#host-native')).toHaveAttribute('open', '');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
});

test('host cancellation must not dismiss an older native child beneath reopened Zilo', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'older-child';
    child.innerHTML = '<section><button id="older-action" autofocus>Act</button></section>';
    zilo.append(child);
    child.showModal();
    (zilo as HTMLElement & { show(): void }).show();
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') event.preventDefault();
      },
      true,
    );
  });
  await expect(page.locator('#older-action')).toBeFocused();
  await page.keyboard.press('Escape');
  // Native default was cancelled: neither the topmost Zilo nor the older child should close.
  await expect(page.locator('#older-child')).toHaveAttribute('open', '');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
});
