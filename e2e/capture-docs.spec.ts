import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('Customer documentation screenshots', () => {
  test('01 customer menu', async ({ page }) => {
    await page.goto('/acme-bistro/menu?table=4');
    await expect(page.locator('h1')).toContainText('Acme Bistro');
    await page.screenshot({ path: 'docs/screenshots/01-customer-menu.png', fullPage: true });
  });

  test('02 cart drawer open', async ({ page }) => {
    await page.goto('/acme-bistro/menu?table=4');
    await page.waitForTimeout(1000); // allow menu to render
    const addButtons = page.locator('button:has-text("Add to Cart")');
    await addButtons.first().click();
    await page.waitForTimeout(500); // allow cart drawer to open
    await page.screenshot({ path: 'docs/screenshots/02-cart-drawer.png', fullPage: true });
  });

  test('03 kitchen display', async ({ page }) => {
    await page.goto('/acme-bistro/kitchen');
    await expect(page.locator('h1')).toContainText('Kitchen Display');
    await page.screenshot({ path: 'docs/screenshots/03-kitchen-display.png', fullPage: true });
  });

  test('04 admin dashboard live monitor', async ({ page }) => {
    await page.goto('/acme-bistro/admin');
    await page.waitForTimeout(1000);
    await expect(page.locator('h1')).toContainText('Lobby Admin');
    await page.screenshot({ path: 'docs/screenshots/04-admin-dashboard.png', fullPage: true });
  });

  test('05 menu management tab', async ({ page }) => {
    await page.goto('/acme-bistro/admin');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Menu items/i }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'docs/screenshots/05-menu-management.png', fullPage: true });
  });

  test('06 tables & QR generator tab', async ({ page }) => {
    await page.goto('/acme-bistro/admin');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Tables & QR/i }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'docs/screenshots/06-qr-generator.png', fullPage: true });
  });
});
