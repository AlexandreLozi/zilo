import { expect, test } from '@playwright/test';
import { stateUrl } from '../src/states.js';

test('Escape belongs to a native modal opened inside Zilo, not the underlying Zilo dialog', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await page.locator('#dialog').evaluate((zilo) => {
    const child = document.createElement('dialog');
    child.id = 'native-child';
    child.setAttribute('aria-label', 'Child modal');
    child.innerHTML = '<button id="child-action">Child action</button>';
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#native-child')).not.toHaveAttribute('open');
});
