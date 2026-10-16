import { test, expect } from '@playwright/test';

test.describe('TableMasters — End-to-End Test', () => {
  const BASE_URL = 'http://localhost:5173/acme-bistro';
  const UNIQUE_ITEM_NAME = `Special Chef Biryani ${Date.now().toString().slice(-4)}`;
  const UNIQUE_ITEM_PRICE = '350';

  test('Admin creates menu item', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('domcontentloaded');

    await page.click('button:has-text("Menu Management")');
    await page.click('button:has-text("Add Item")');
    await expect(page.locator('.bg-slate-900.border.border-slate-800.rounded-2xl.p-6.shadow-2xl')).toBeVisible();

    await page.fill('input[name="name"]', UNIQUE_ITEM_NAME);
    await page.fill('input[name="price"]', UNIQUE_ITEM_PRICE);

    const categorySelect = page.locator('select[name="category"]');
    if (await categorySelect.isVisible()) {
      await categorySelect.selectOption({ index: 0 });
    }

    await page.click('button:has-text("Save item")');
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.requestSubmit();
    });
    await page.waitForTimeout(2000);

    await expect(page.locator(`text=${UNIQUE_ITEM_NAME}`)).toBeVisible({ timeout: 5000 });
    console.log(`✅ Item created: ${UNIQUE_ITEM_NAME}`);
  });

  test('Kitchen page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/kitchen`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/kitchen.png', fullPage: true });

    const kitchenHeader = page.locator('h1, h2').first();
    await expect(kitchenHeader).toBeVisible({ timeout: 5000 });
    console.log('✅ Kitchen page loads successfully');
  });
});
