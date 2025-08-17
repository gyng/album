import { test, expect } from "@playwright/test";

test.describe("EXIF Debug Tests", () => {
  test("inspect EXIF GPS data format in slideshow", async ({ page }) => {
    // Listen to console messages to capture our debug logs
    const messages: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.type() === "log" &&
        (msg.text().includes("Raw EXIF string") ||
          msg.text().includes("All EXIF keys") ||
          msg.text().includes("GPS EXIF data") ||
          msg.text().includes("Parsed coordinates") ||
          msg.text().includes("Converted coordinates"))
      ) {
        messages.push(msg.text());
      }
    });

    // Navigate to slideshow
    await page.goto("/slideshow", {
      timeout: 90000,
      waitUntil: "domcontentloaded",
    });

    // Wait for slideshow to load and get a photo
    await page.waitForTimeout(10000);

    // Try clicking Next a few times to get different photos and see their EXIF data
    for (let i = 0; i < 3; i++) {
      const nextButton = page.locator('button:has-text("Next")');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(3000);
      }
    }

    // Output all collected messages
    console.log("=== EXIF Debug Messages ===");
    messages.forEach((msg) => console.log(msg));

    // The test should pass if we got some debug output
    expect(messages.length).toBeGreaterThan(0);
  });
});
