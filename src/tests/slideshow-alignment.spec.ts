import { test, expect } from '@playwright/test';

test.describe('Slideshow Details Alignment Tests', () => {
  
  test('alignment button cycles through left, center, right options', async ({ page }) => {
    // Navigate to slideshow
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for slideshow to load
    await page.waitForTimeout(10000);
    
    // Enable details to see the alignment in action
    const detailsButton = page.locator('button:has-text("Details")');
    if (await detailsButton.isVisible()) {
      await detailsButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Find the alignment button (should show "📍 Center" initially)
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Check initial state (should be "Center")
    await expect(alignmentButton).toContainText('📍 Center');
    
    // Click to cycle to "Right"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Right');
    
    // Click to cycle to "Left"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Left');
    
    // Click to cycle back to "Center"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Center');
    
    console.log('✓ Alignment button cycles correctly through all options');
  });

  test('details pane position changes with alignment', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    // Enable details
    const detailsButton = page.locator('button:has-text("Details")');
    if (await detailsButton.isVisible()) {
      await detailsButton.click();
      await page.waitForTimeout(1000);
    }
    
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Test center alignment (default)
    await expect(alignmentButton).toContainText('📍 Center');
    let bottomBar = page.locator('.bottomBar').first();
    let classes = await bottomBar.getAttribute('class');
    expect(classes).toContain('alignCenter');
    console.log('✓ Center alignment applied correctly');
    
    // Test right alignment
    await alignmentButton.click();
    await page.waitForTimeout(500);
    classes = await bottomBar.getAttribute('class');
    expect(classes).toContain('alignRight');
    console.log('✓ Right alignment applied correctly');
    
    // Test left alignment
    await alignmentButton.click();
    await page.waitForTimeout(500);
    classes = await bottomBar.getAttribute('class');
    expect(classes).toContain('alignLeft');
    console.log('✓ Left alignment applied correctly');
  });

  test('alignment preference persists across page reloads', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Set to right alignment
    await alignmentButton.click(); // Center -> Right
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Right');
    
    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);
    
    // Check that alignment persisted
    const newAlignmentButton = page.locator('button:has-text("📍")');
    await expect(newAlignmentButton).toBeVisible();
    await expect(newAlignmentButton).toContainText('📍 Right');
    
    console.log('✓ Alignment preference persists across page reloads');
  });

  test('alignment works with map and clock enabled', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    // Enable all bottom bar elements
    const detailsButton = page.locator('button:has-text("Details")');
    const mapButton = page.locator('button:has-text("Map")');
    const clockButton = page.locator('button:has-text("🕰️")');
    const alignmentButton = page.locator('button:has-text("📍")');
    
    if (await detailsButton.isVisible()) await detailsButton.click();
    if (await mapButton.isVisible()) await mapButton.click();
    if (await clockButton.isVisible()) await clockButton.click();
    await page.waitForTimeout(2000);
    
    // Test alignment with all elements visible
    await alignmentButton.click(); // Center -> Right
    await page.waitForTimeout(500);
    
    const bottomBars = page.locator('.bottomBar');
    const count = await bottomBars.count();
    
    // Should have 2 bottom bars (for blend mode effect)
    expect(count).toBe(2);
    
    // Both should have right alignment
    for (let i = 0; i < count; i++) {
      const classes = await bottomBars.nth(i).getAttribute('class');
      expect(classes).toContain('alignRight');
    }
    
    console.log('✓ Alignment works correctly with map and clock enabled');
  });
});