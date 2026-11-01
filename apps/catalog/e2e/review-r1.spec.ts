import { expect, test } from '@playwright/test';
import { stateUrl } from '../src/states.js';

test('Tab reaches visible descendants of display:contents wrappers', async ({ page }) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((dialog) => {
    dialog.innerHTML = `
      <button id="before">Before</button>
      <div style="display:contents"><button id="inside">Inside</button></div>
      <button id="after">After</button>`;
  });
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.locator('#before')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inside')).toBeFocused();
});

test('Tab skips controls disabled by their fieldset', async ({ page }) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((dialog) => {
    dialog.innerHTML = `
      <button id="before">Before</button>
      <fieldset disabled><legend>Settings</legend><input aria-label="Disabled setting" /></fieldset>
      <button id="after">After</button>`;
  });
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.locator('#before')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#after')).toBeFocused();
});
