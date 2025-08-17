import { test, expect } from '@playwright/test';

test.describe('Basic Navigation', () => {
  test('can access map page directly', async ({ page }) => {
    await page.goto('/map');
    await expect(page).toHaveTitle('Map');
    console.log('Map page loaded successfully');
  });

  test('can access slideshow page directly', async ({ page }) => {
    await page.goto('/slideshow');
    await expect(page).toHaveTitle('Slideshow');
    console.log('Slideshow page loaded successfully');
  });

  test('homepage loads without timeout', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Snapshots');
    
    // Just check if we can see the main heading without waiting for all content
    await expect(page.locator('h1')).toContainText('Snapshots');
    console.log('Homepage loaded successfully');
  });

  test('can navigate from homepage to map using link href', async ({ page }) => {
    await page.goto('/');
    
    // Find the link by href and click it
    const mapLink = page.locator('a[href="/map"]');
    await expect(mapLink).toBeVisible();
    
    await mapLink.click();
    await page.waitForURL('/map', { timeout: 15000 });
    await expect(page).toHaveTitle('Map');
  });

  test('can navigate from homepage to slideshow using link href', async ({ page }) => {
    await page.goto('/');
    
    // Find the link by href and click it
    const slideshowLink = page.locator('a[href="/slideshow"]');
    await expect(slideshowLink).toBeVisible();
    
    await slideshowLink.click();
    await page.waitForURL('/slideshow', { timeout: 15000 });
    await expect(page).toHaveTitle('Slideshow');
  });
});