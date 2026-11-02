import { expect, test } from '@playwright/test';
import { stateUrl } from '../src/states.js';

test('an older native dialog in an open shadow root becomes newer after close and reopen', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((zilo) => {
    const host = document.createElement('div');
    host.id = 'layer-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<dialog id="child"><button id="child-action">Child action</button></dialog>';
    zilo.append(host);
    root.querySelector('dialog')!.showModal();
    (zilo as HTMLElement & { show(): void }).show();
  });
  await page.locator('#child').evaluate(async (child: HTMLDialogElement) => {
    await new Promise<void>((resolve) => {
      child.addEventListener('close', () => resolve(), { once: true });
      child.close();
    });
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#child')).not.toHaveAttribute('open');
});

test('an older native dialog closed while detached becomes newer when reinserted and reopened', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate(async (zilo) => {
    const child = document.createElement('dialog');
    child.id = 'child';
    child.innerHTML = '<button id="child-action">Child action</button>';
    zilo.append(child);
    child.showModal();
    (zilo as HTMLElement & { show(): void }).show();
    child.remove();
    await new Promise<void>((resolve) => {
      child.addEventListener('close', () => resolve(), { once: true });
      child.close();
    });
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#child')).not.toHaveAttribute('open');
});

test('an older popover reopened in the same task becomes newer despite coalesced toggle events', async ({
  page,
}) => {
  await page.goto(stateUrl('dialog-trigger', 'light'));
  await page.locator('#dialog').evaluate((zilo) => {
    const popover = document.createElement('div');
    popover.id = 'child';
    popover.popover = 'auto';
    popover.textContent = 'Suggestions';
    zilo.append(popover);
    popover.showPopover();
    (zilo as HTMLElement & { show(): void }).show();
    popover.hidePopover();
    popover.showPopover();
  });
  await expect(page.locator('#child')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#child')).toBeHidden();
});

test('the documented host Escape prevention must still let the native child dismiss', async ({
  page,
}) => {
  // Reproduce the README host callback's operation on the same native keydown in document capture.
  // Register before Radix so its host listener sees the cancellation, just as when its own
  // onEscapeKeyDown callback calls preventDefault(). No fixture or library code is changed.
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
    child.innerHTML = '<button id="child-action">Child action</button>';
    zilo.append(child);
    child.showModal();
  });
  await expect(page.locator('#child-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Scan documents' })).toBeVisible();
  await expect(page.locator('#zilo')).toHaveAttribute('open', '');
  await expect(page.locator('#child')).not.toHaveAttribute('open');
});
