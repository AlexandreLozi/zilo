import { expect, test } from '@playwright/test';

test('demo loads and renders the placeholder component', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Zilo demo' })).toBeVisible();
  const placeholder = page.locator('zilo-placeholder');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveText(/^Zilo SDK v\d+\.\d+\.\d+/);
  expect(errors).toEqual([]);
});
