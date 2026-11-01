import { expect, test } from '@playwright/test';

test('demo loads and renders a Zilo button', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Zilo demo' })).toBeVisible();
  const button = page.getByRole('button', { name: /^Zilo SDK v\d+\.\d+\.\d+/ });
  await expect(button).toBeVisible();
  expect(errors).toEqual([]);
});
