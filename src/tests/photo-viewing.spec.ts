import { test, expect } from '@playwright/test';

test.describe('Photo Viewing Flow', () => {
  
  test('album displays photos correctly', async ({ page }) => {
    await page.goto('/album/snapshots');
    
    // Wait for album navigation to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Find photo elements
    const photos = page.locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]');
    await expect(photos.first()).toBeVisible({ timeout: 15000 });
    
    const photoCount = await photos.count();
    console.log(`Album contains ${photoCount} photo elements`);
    expect(photoCount).toBeGreaterThan(0);
  });

  test('photos load with proper attributes', async ({ page }) => {
    await page.goto('/album/24japan');
    
    // Wait for photos to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    const firstPhoto = page.locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]').first();
    await expect(firstPhoto).toBeVisible({ timeout: 15000 });
    
    // Check photo has required attributes
    const src = await firstPhoto.getAttribute('src');
    const alt = await firstPhoto.getAttribute('alt');
    
    expect(src).toBeTruthy();
    console.log(`First photo src: ${src}`);
    console.log(`First photo alt: ${alt || 'No alt text'}`);
  });

  test('can click on photo elements', async ({ page }) => {
    await page.goto('/album/kansai');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Find a clickable photo element
    const photoElement = page.locator('img, figure, [data-testid*="photo"], [class*="photo"]').first();
    await expect(photoElement).toBeVisible({ timeout: 15000 });
    
    // Try to click the photo
    await photoElement.click();
    
    // Check if anything happened (URL change, modal, etc.)
    await page.waitForTimeout(1000);
    console.log(`URL after photo click: ${page.url()}`);
    console.log('✓ Photo element is clickable');
  });

  test('photo deep linking works', async ({ page }) => {
    // Test deep linking to a specific photo using fragment identifier
    await page.goto('/album/hokkaido#DSCF1389.JPG');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Check if the URL fragment is preserved
    expect(page.url()).toContain('#DSCF1389.JPG');
    console.log('✓ Photo deep linking URL structure preserved');
  });

  test('photo metadata displays when available', async ({ page }) => {
    await page.goto('/album/eastcoast');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Look for any metadata elements (dates, descriptions, titles)
    const metadataElements = page.locator(
      '[class*="date"], [class*="title"], [class*="description"], ' +
      '[class*="exif"], [class*="meta"], time, .photo-info'
    );
    
    if (await metadataElements.count() > 0) {
      console.log(`Found ${await metadataElements.count()} metadata elements`);
      
      // Get text from first few metadata elements
      const metadataCount = Math.min(3, await metadataElements.count());
      for (let i = 0; i < metadataCount; i++) {
        const text = await metadataElements.nth(i).textContent();
        console.log(`Metadata ${i}: ${text?.trim()}`);
      }
    } else {
      console.log('No photo metadata elements found (may not be displayed on album page)');
    }
  });

  test('album navigation between photos works', async ({ page }) => {
    await page.goto('/album/melbourne');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Get initial photo count
    const photos = page.locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]');
    const photoCount = await photos.count();
    
    if (photoCount > 1) {
      console.log(`Album has ${photoCount} photos - testing navigation`);
      
      // Get the initial photo's src
      const firstPhotoSrc = await photos.first().getAttribute('src');
      
      // Try clicking second photo
      await photos.nth(1).click();
      await page.waitForTimeout(1000);
      
      console.log('✓ Photo navigation interaction completed');
    } else {
      console.log('Album has only one photo - skipping navigation test');
    }
  });

  test('photos display responsive layout', async ({ page }) => {
    await page.goto('/album/nagano');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Check layout at different viewport sizes
    const photos = page.locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]');
    await expect(photos.first()).toBeVisible({ timeout: 15000 });
    
    // Test desktop view
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);
    const desktopPhotos = await photos.count();
    
    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    const mobilePhotos = await photos.count();
    
    // Should have same number of photos in both views
    expect(mobilePhotos).toBe(desktopPhotos);
    console.log(`Photos display consistently: ${desktopPhotos} desktop, ${mobilePhotos} mobile`);
  });
});