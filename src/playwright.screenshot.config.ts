import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the README screenshot capture only.
 *
 * No web server and no Next.js build: the spec builds its own page with
 * `setContent` and the iframes load the deployed site directly. It used to
 * serve `public/`, which is why the fixture lived there — and why the deployed
 * site answered /screenshot.html.
 *
 * Used by: npm run screenshot
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "screenshot.spec.ts",
  timeout: 120 * 1000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"]],
});
