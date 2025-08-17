import { test, expect } from '@playwright/test';

test.describe('Album Browsing Flow', () => {
  
  test('homepage displays album grid', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to load
    await expect(page).toHaveTitle('Snapshots');
    await expect(page.locator('h1')).toContainText('Snapshots');
    
    // Check that we have album links (we know from debug output they exist)
    const albumLinks = page.locator('a[href*="/album/"]');
    await expect(albumLinks.first()).toBeVisible({ timeout: 10000 });
    
    // Count how many albums are visible
    const albumCount = await albumLinks.count();
    console.log(`Found ${albumCount} albums on homepage`);
    expect(albumCount).toBeGreaterThan(0);
  });

  test('can navigate to specific album', async ({ page }) => {
    await page.goto('/');
    
    // Click on a specific album we know exists - use first() to handle multiple links
    const albumLink = page.locator('a[href="/album/24japan"]').first();
    await expect(albumLink).toBeVisible({ timeout: 10000 });
    
    await albumLink.click();
    await page.waitForURL('/album/24japan');
    
    // Verify we're on the album page
    // Look for album navigation elements
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a:has-text("Album map")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('a:has-text("Album slideshow")')).toBeVisible({ timeout: 5000 });
    
    console.log('✓ Successfully navigated to 24japan album');
  });

  test('album page displays photos', async ({ page }) => {
    await page.goto('/album/snapshots');
    
    // Wait for navigation to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Look for photo elements - they might be images or figure elements
    const photos = page.locator('img, figure, [data-testid*="photo"]');
    await expect(photos.first()).toBeVisible({ timeout: 15000 });
    
    const photoCount = await photos.count();
    console.log(`Found ${photoCount} photos in snapshots album`);
    expect(photoCount).toBeGreaterThan(0);
  });

  test('can navigate between albums using back button', async ({ page }) => {
    // Start on homepage
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Snapshots');
    
    // Go to an album - wait for albums to load first, then use first link
    const albumLinks = page.locator('a[href*="/album/"]');
    await expect(albumLinks.first()).toBeVisible({ timeout: 15000 });
    
    // Click the first available album link
    await Promise.all([
      page.waitForURL(/\/album\//, { timeout: 30000 }),
      albumLinks.first().click()
    ]);
    
    // Verify we're on an album page
    expect(page.url()).toMatch(/\/album\//);
    
    // Use browser back button
    await page.goBack();
    await page.waitForURL('/', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Snapshots');
    
    console.log('✓ Back navigation works correctly');
  });

  test('album map link works', async ({ page }) => {
    await page.goto('/album/24japan');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Click album map link
    const mapLink = page.locator('a:has-text("Album map")');
    await expect(mapLink).toBeVisible();
    
    await mapLink.click();
    
    // Should go to map with filter
    await page.waitForURL(/\/map\?filter_album=24japan/);
    await expect(page).toHaveTitle('Map');
    
    console.log('✓ Album map navigation works');
  });

  test('album slideshow link works', async ({ page }) => {
    await page.goto('/album/kansai');
    
    // Wait for album to load
    await expect(page.locator('a:has-text("← Albums")')).toBeVisible({ timeout: 10000 });
    
    // Click album slideshow link
    const slideshowLink = page.locator('a:has-text("Album slideshow")');
    await expect(slideshowLink).toBeVisible();
    
    await slideshowLink.click();
    
    // Should go to slideshow with filter
    await page.waitForURL(/\/slideshow\?filter=kansai/);
    
    // Slideshow may take time to load, just verify URL change
    console.log('✓ Album slideshow navigation works (URL redirect successful)');
  });
});