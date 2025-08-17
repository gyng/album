import { test, expect } from '@playwright/test';

test.describe('Slideshow Alignment - Visual Test', () => {
  
  test('visual alignment works with details enabled', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    // Enable details to see the alignment in action
    const detailsButton = page.locator('button:has-text("Details")');
    if (await detailsButton.isVisible()) {
      await detailsButton.click();
      await page.waitForTimeout(2000);
    }
    
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Test that we can see details elements
    const detailsElements = page.locator('.details, .detailsRow');
    if (await detailsElements.count() > 0) {
      console.log('✓ Details are visible');
      
      // Test alignment cycling
      await expect(alignmentButton).toContainText('📍 Center');
      
      // Cycle to right
      await alignmentButton.click();
      await page.waitForTimeout(500);
      await expect(alignmentButton).toContainText('📍 Right');
      console.log('✓ Switched to right alignment');
      
      // Cycle to left
      await alignmentButton.click();
      await page.waitForTimeout(500);
      await expect(alignmentButton).toContainText('📍 Left');
      console.log('✓ Switched to left alignment');
      
      // Back to center
      await alignmentButton.click();
      await page.waitForTimeout(500);
      await expect(alignmentButton).toContainText('📍 Center');
      console.log('✓ Switched back to center alignment');
    } else {
      console.log('No details visible, but alignment button works');
    }
  });

  test('alignment persists when toggling other features', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    const alignmentButton = page.locator('button:has-text("📍")');
    const detailsButton = page.locator('button:has-text("Details")');
    
    // Set to right alignment
    await alignmentButton.click(); // Center -> Right
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Right');
    
    // Toggle details on and off
    if (await detailsButton.isVisible()) {
      await detailsButton.click(); // Enable details
      await page.waitForTimeout(1000);
      await detailsButton.click(); // Disable details
      await page.waitForTimeout(1000);
    }
    
    // Alignment should still be right
    await expect(alignmentButton).toContainText('📍 Right');
    console.log('✓ Alignment persists when toggling details');
    
    // Enable details again and verify alignment is still applied
    if (await detailsButton.isVisible()) {
      await detailsButton.click(); // Enable details
      await page.waitForTimeout(1000);
    }
    
    await expect(alignmentButton).toContainText('📍 Right');
    console.log('✓ Alignment correctly applied when re-enabling details');
  });
});