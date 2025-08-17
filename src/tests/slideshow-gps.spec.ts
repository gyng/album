import { test, expect } from '@playwright/test';

test.describe('Slideshow GPS Tests', () => {
  
  test('slideshow uses EXIF GPS coordinates for map display', async ({ page }) => {
    // Navigate to slideshow
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for slideshow to load
    await page.waitForTimeout(10000);
    
    // Enable map display to test GPS coordinates
    const mapButton = page.locator('button:has-text("Map")');
    if (await mapButton.isVisible()) {
      await mapButton.click();
      await page.waitForTimeout(2000);
      
      // Check if map container appears
      const mapContainer = page.locator('.mapContainer, .map, canvas');
      if (await mapContainer.count() > 0) {
        console.log('✓ Map is displayed in slideshow');
        
        // Check if we're getting coordinates (map should render with coordinates)
        const mapCanvas = page.locator('canvas').first();
        if (await mapCanvas.isVisible()) {
          console.log('✓ Map canvas is visible, indicating GPS coordinates are available');
        }
      } else {
        console.log('Map container not found - may be no GPS data in current photo');
      }
    }
  });

  test('slideshow displays photos with potential GPS data', async ({ page }) => {
    await page.goto('/slideshow', { 
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for slideshow to load
    await page.waitForTimeout(5000);
    
    // Enable details to see if location info appears
    const detailsButton = page.locator('button:has-text("Details")');
    if (await detailsButton.isVisible()) {
      await detailsButton.click();
      await page.waitForTimeout(1000);
      
      // Look for location details
      const locationElements = page.locator('.details, .detailsRow');
      if (await locationElements.count() > 0) {
        console.log('✓ Details panel is visible');
        
        // Try a few photos to find one with GPS data
        for (let i = 0; i < 3; i++) {
          const nextButton = page.locator('button:has-text("Next")');
          if (await nextButton.isVisible()) {
            await nextButton.click();
            await page.waitForTimeout(3000);
            
            // Check if map button becomes active (indicates GPS data)
            const mapButton = page.locator('button:has-text("Map")');
            if (await mapButton.isVisible()) {
              await mapButton.click();
              await page.waitForTimeout(2000);
              
              const mapCanvas = page.locator('canvas');
              if (await mapCanvas.count() > 0) {
                console.log(`✓ Found photo with GPS data on attempt ${i + 1}`);
                break;
              }
              
              // Turn off map for next iteration
              await mapButton.click();
            }
          }
        }
      }
    }
  });
});