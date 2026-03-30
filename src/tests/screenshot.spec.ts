import { test } from "@playwright/test";
import path from "path";

/**
 * Captures a README screenshot from the screenshot.html fixture.
 *
 * Fully automated:  npm run screenshot    (from src/)
 * With dev server:  PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test ./tests/screenshot.spec.ts --project=chromium
 *
 * Output: ../screenshot.png (repo root)
 */
test("capture README screenshot", async ({ page }) => {
  // Fixed viewport so the screenshot dimensions stay consistent
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/screenshot.html", { waitUntil: "domcontentloaded" });

  // Wait for all four iframes to finish loading
  const iframes = page.locator("iframe");
  for (let i = 0; i < 4; i++) {
    const frame = iframes.nth(i);
    await frame.waitFor({ state: "visible" });
    const contentFrame = frame.contentFrame();
    await contentFrame.locator("body").waitFor({ state: "visible" });
  }

  // Give content (map tiles, images) a moment to render
  await page.waitForTimeout(5000);

  const out = path.resolve(__dirname, "../../screenshot.png");
  await page.screenshot({ path: out, type: "png" });
  // eslint-disable-next-line no-console
  console.log(`Screenshot saved to ${out}`);
});
