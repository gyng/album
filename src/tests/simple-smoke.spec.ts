import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  
  // Just verify page loads without errors
  await expect(page.locator('body')).toBeVisible();
  
  console.log('Page title:', await page.title());
  console.log('Page URL:', page.url());
});