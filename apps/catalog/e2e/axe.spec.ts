import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { catalogStates, catalogThemes, stateUrl } from '../src/states.js';

// WCAG 2.0, 2.1 and 2.2 A and AA, plus best practices (docs/design/accessibility.md §9).
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
  expect(summary).toEqual([]);
  // Guard against a silently empty scan.
  expect(results.passes.length).toBeGreaterThan(0);
}

test('catalog index has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Zilo component catalog' }),
  ).toBeVisible();
  await expectNoViolations(page);
});

for (const theme of catalogThemes) {
  for (const state of catalogStates) {
    test(`axe: ${state.id} (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(stateUrl(state.id, theme));
      await expect(page.locator(`[data-state="${state.id}"]`)).toBeAttached();
      if (state.component === 'Dialog' && state.id !== 'dialog-trigger') {
        await expect(
          page.getByRole(state.id === 'dialog-alert' ? 'alertdialog' : 'dialog'),
        ).toBeVisible();
      }
      await expectNoViolations(page);
      expect(errors).toEqual([]);
    });
  }
}
