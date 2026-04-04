import { test } from "@playwright/test";
import path from "path";

/**
 * Captures a README screenshot from the screenshot.html fixture,
 * loading iframes from the production site.
 *
 * Automated:  npm run screenshot    (from src/)
 *
 * Output: ../screenshot.png (repo root)
 */
test("capture README screenshot", async ({ page }) => {
  // Fixed viewport so the screenshot dimensions stay consistent
  await page.setViewportSize({ width: 3840, height: 2160 });

  // screenshot.html is a local static file; iframes point at production
  await page.goto("/screenshot.html", { waitUntil: "domcontentloaded" });

  // Wait for all four iframes to finish loading
  const iframes = page.locator("iframe");
  for (let i = 0; i < 4; i++) {
    const frame = iframes.nth(i);
    await frame.waitFor({ state: "visible" });
    const contentFrame = frame.contentFrame();
    await contentFrame.locator("body").waitFor({ state: "visible" });
  }

  // Open the details pane for DSCF8612.JPG in the album iframe (top-right, index 1)
  const albumFrame = iframes.nth(1).contentFrame();
  const photoAnchor = albumFrame.locator("#DSCF8612\\.JPG");
  await photoAnchor.waitFor({ state: "attached", timeout: 15000 });
  await photoAnchor.locator("details summary").click();
  await photoAnchor.scrollIntoViewIfNeeded();

  // Give content (map tiles, images, details map) a moment to render
  await page.waitForTimeout(5000);

  const out = path.resolve(__dirname, "../../screenshot.jpg");
  await page.screenshot({ path: out, type: "jpeg", quality: 85 });
  console.log(`Screenshot saved to ${out}`);
});
