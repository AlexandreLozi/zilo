import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { catalogThemes, stateUrl, type CatalogTheme } from '../src/states.js';

/**
 * A Zilo dialog opened from inside a host app's Radix Dialog (apps/catalog/src/host-modal.tsx), with
 * real pointer and keyboard input. Radix is the hard case: it traps focus with document listeners,
 * locks `body` with `pointer-events: none`, portals to `body` and listens for Escape in the document
 * capture phase. The host has no workarounds (see the contract in packages/ui/README.md).
 */

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

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

const host = (page: Page) => page.getByRole('dialog', { name: 'Scan documents' });
const zilo = (page: Page) => page.getByRole('dialog', { name: 'Choose a scanner' });

async function openHost(page: Page, theme: CatalogTheme = 'light'): Promise<void> {
  await page.goto(stateUrl('host-modal-radix', theme));
  await expect(page.locator('[data-state="host-modal-radix"]')).toBeAttached();
  await page.getByRole('button', { name: 'Scan documents' }).click();
  await expect(host(page)).toBeVisible();
}

/** Opens both with the keyboard: Tab to the host's "Choose scanner" button and press Enter. */
async function openBothWithKeyboard(page: Page): Promise<void> {
  await openHost(page);
  await expect.poll(() => focused(page)).toBe('#host-batch');
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('#open-zilo');
  await page.keyboard.press('Enter');
  await expect(zilo(page)).toBeVisible();
}

async function openBothWithPointer(page: Page, theme: CatalogTheme = 'light'): Promise<void> {
  await openHost(page, theme);
  await page.getByRole('button', { name: 'Choose scanner' }).click();
  await expect(zilo(page)).toBeVisible();
}

const ziloCycle = ['#zilo-name', '#zilo-cancel>button', '#zilo-use>button', '#zilo>close-button'];

test('focus hands off to the Zilo dialog and back to the host dialog', async ({ page }) => {
  await openBothWithKeyboard(page);
  await expect.poll(() => focused(page)).toBe('#zilo-name');

  // The Zilo trap owns Tab; the host's trap never moves focus, in either direction.
  const forward: string[] = [];
  for (let i = 0; i < ziloCycle.length * 2; i++) {
    await page.keyboard.press('Tab');
    forward.push(await focused(page));
  }
  expect(forward).toEqual([...ziloCycle.slice(1), ...ziloCycle, ziloCycle[0]]);
  const backward: string[] = [];
  for (let i = 0; i < ziloCycle.length; i++) {
    await page.keyboard.press('Shift+Tab');
    backward.push(await focused(page));
  }
  expect(backward).toEqual([...ziloCycle].reverse());

  // Closing returns focus to the opener inside the host, whose trap then works as before.
  await page.keyboard.press('Escape');
  await expect(zilo(page)).toBeHidden();
  await expect(host(page)).toBeVisible();
  await expect.poll(() => focused(page)).toBe('#open-zilo');
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('#host-close');
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('#host-batch');

  await page.keyboard.press('Escape');
  await expect(host(page)).toBeHidden();
  await expect.poll(() => focused(page)).toBe('#host-trigger');
});

test('the Zilo dialog is not locked out by the host pointer-events lock', async ({ page }) => {
  await openBothWithPointer(page);
  // Radix locks the page behind its modal through body.style.pointerEvents.
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe('none');

  // Real pointer input reaches the Zilo dialog's content (Playwright checks the hit target).
  await page.getByLabel('Scanner name').click();
  await expect.poll(() => focused(page)).toBe('#zilo-name');
  await page.keyboard.press('End');
  await page.keyboard.type(' (desk)');
  await expect(page.getByLabel('Scanner name')).toHaveValue('Canon DR-C225 II (desk)');
  await page.getByRole('button', { name: 'Use scanner' }).click();
  await expect(zilo(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-zilo-action', 'use');
  // A controlled close (React sets open=false) reports reason `api`.
  await expect(page.locator('body')).toHaveAttribute('data-zilo-close', 'api');
  await expect(host(page)).toBeVisible();
  await expect.poll(() => focused(page)).toBe('#open-zilo');
});

test('the Zilo dialog keeps its own pointer-events when its ancestors lose theirs', async ({
  page,
}) => {
  await openBothWithPointer(page);
  // A host that also locks its own modal content while ours is open: ours still takes pointers.
  await page.locator('.host-content').evaluate((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(zilo(page)).toBeHidden();
  await expect(host(page)).toBeVisible();
});

test('the Zilo dialog stacks above the host portal, z-index and transform', async ({ page }) => {
  await openBothWithPointer(page);
  const stacking = await page.evaluate(() => {
    const ziloEl = document.querySelector('#zilo');
    const native = ziloEl?.shadowRoot?.querySelector('dialog');
    const hostContent = document.querySelector<HTMLElement>('.host-content');
    if (!ziloEl || !native || !hostContent) throw new Error('fixture');
    // Make the host content more hostile still: scaled down, and narrower than our dialog. Neither
    // its transform nor its overflow: hidden may reach a top-layer dialog.
    hostContent.style.transform = 'translate(-50%, -50%) scale(0.5)';
    hostContent.style.inlineSize = '12rem';
    // Hit-test the centre of the Zilo dialog and of each host control under its backdrop.
    const box = native.getBoundingClientRect();
    const hit = (x: number, y: number): boolean => {
      const el = document.elementFromPoint(x, y);
      return el !== null && ziloEl.contains(el);
    };
    const hostOwn = [...hostContent.querySelectorAll('input, button')].filter(
      (el) => !ziloEl.contains(el),
    );
    const hostControls = hostOwn.map((el) => {
      const r = el.getBoundingClientRect();
      return hit(r.left + r.width / 2, r.top + r.height / 2);
    });
    return {
      modal: native.matches(':modal'),
      insideHostPortal: hostContent.contains(ziloEl),
      hostZIndex: getComputedStyle(hostContent).zIndex,
      centre: hit(box.left + box.width / 2, box.top + box.height / 2),
      hostControls,
      // 32rem at the 1280px viewport: neither scaled nor clipped to the 6rem-wide host box.
      width: Math.round(box.width),
      hostWidth: Math.round(hostContent.getBoundingClientRect().width),
    };
  });
  expect(stacking).toEqual({
    modal: true,
    insideHostPortal: true,
    hostZIndex: '2147483647',
    centre: true,
    hostControls: [true, true, true],
    width: 512,
    hostWidth: 96,
  });
  await expect(zilo(page)).toBeInViewport({ ratio: 1 });
});

test('Escape closes only the topmost dialog, despite the host capture listener', async ({
  page,
}) => {
  await openBothWithKeyboard(page);
  await page.keyboard.press('Escape');
  await expect(zilo(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-zilo-close', 'escape');
  // Radix's document capture-phase Escape listener saw the claimed key and did not dismiss.
  await expect(host(page)).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-host-dismiss', /.*/);

  await page.keyboard.press('Escape');
  await expect(host(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-host-dismiss', 'escape');
});

test('an outside click closes only the topmost dialog', async ({ page }) => {
  await openBothWithPointer(page);
  await page.mouse.click(4, 4);
  await expect(zilo(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-zilo-close', 'outside');
  await expect(host(page)).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-host-dismiss', /.*/);
  await expect.poll(() => focused(page)).toBe('#open-zilo');

  // Reopen, and click the backdrop right above the host's own Close button: only ours closes.
  await page.getByRole('button', { name: 'Choose scanner' }).click();
  await expect(zilo(page)).toBeVisible();
  const target = await page.evaluate(() => {
    const close = document.querySelector('#host-close')?.getBoundingClientRect();
    const ours = document.querySelector('#zilo')?.shadowRoot?.querySelector('dialog');
    if (!close || !ours) throw new Error('fixture');
    const box = ours.getBoundingClientRect();
    const x = close.right - 4;
    const y = close.top + close.height / 2;
    const outsideOurs = x < box.left || x > box.right || y < box.top || y > box.bottom;
    return { x, y, outsideOurs };
  });
  expect(target.outsideOurs).toBe(true);
  await page.mouse.click(target.x, target.y);
  await expect(zilo(page)).toBeHidden();
  await expect(host(page)).toBeVisible();
  await expect.poll(() => focused(page)).toBe('#open-zilo');

  // With ours closed, the next outside click is the host's.
  await page.mouse.click(4, 4);
  await expect(host(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-host-dismiss', 'outside');
});

test('a press inside the Zilo dialog that ends on its backdrop does not close it', async ({
  page,
}) => {
  await openBothWithPointer(page);
  const field = await page.getByLabel('Scanner name').boundingBox();
  if (!field) throw new Error('fixture');
  await page.mouse.move(field.x + 4, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 4 });
  await page.mouse.up();
  await expect(zilo(page)).toBeVisible();
  await expect(host(page)).toBeVisible();
});

test('nothing is left behind once both dialogs close', async ({ page }) => {
  await openBothWithPointer(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(host(page)).toBeHidden();
  const residue = await page.evaluate(() => ({
    bodyPointerEvents: document.body.style.pointerEvents,
    htmlOverflow: document.documentElement.style.overflow,
  }));
  expect(residue).toEqual({ bodyPointerEvents: '', htmlOverflow: '' });
});

for (const theme of catalogThemes) {
  test(`axe: host dialog, then both dialogs open (${theme})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const step of ['host', 'both'] as const) {
      if (step === 'host') await openHost(page, theme);
      else {
        await page.getByRole('button', { name: 'Choose scanner' }).click();
        await expect(zilo(page)).toBeVisible();
      }
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      const summary = results.violations.map((v) => ({
        step,
        id: v.id,
        targets: v.nodes.map((n) => n.target.join(' ')),
      }));
      expect(summary).toEqual([]);
      expect(results.passes.length).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}
