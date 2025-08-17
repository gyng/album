import { test, expect } from '@playwright/test';

test.describe('Slideshow Alignment - Simple Test', () => {
  
  test('alignment button appears and cycles correctly', async ({ page }) => {
    // Navigate to slideshow
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for slideshow to load
    await page.waitForTimeout(10000);
    
    // Find the alignment button
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Check initial state (should be "Center")
    await expect(alignmentButton).toContainText('📍 Center');
    console.log('✓ Initial state is Center');
    
    // Click to cycle to "Right"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Right');
    console.log('✓ Successfully cycled to Right');
    
    // Click to cycle to "Left"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Left');
    console.log('✓ Successfully cycled to Left');
    
    // Click to cycle back to "Center"
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText('📍 Center');
    console.log('✓ Successfully cycled back to Center');
  });

  test('alignment button active state works correctly', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    await page.waitForTimeout(10000);
    
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    
    // Center should not be active (not highlighted)
    let classes = await alignmentButton.getAttribute('class');
    expect(classes).not.toContain('active');
    console.log('✓ Center alignment button is not active (correct)');
    
    // Click to Right - should become active
    await alignmentButton.click();
    await page.waitForTimeout(500);
    classes = await alignmentButton.getAttribute('class');
    expect(classes).toContain('active');
    console.log('✓ Right alignment button is active (correct)');
    
    // Click to Left - should remain active
    await alignmentButton.click();
    await page.waitForTimeout(500);
    classes = await alignmentButton.getAttribute('class');
    expect(classes).toContain('active');
    console.log('✓ Left alignment button is active (correct)');
    
    // Click back to Center - should not be active
    await alignmentButton.click();
    await page.waitForTimeout(500);
    classes = await alignmentButton.getAttribute('class');
    expect(classes).not.toContain('active');
    console.log('✓ Center alignment button is not active (correct)');
  });
});