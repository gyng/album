import { defineConfig, devices } from "@playwright/test";

const port = 3001;
const baseURL = `http://localhost:${port}`;

/**
 * Playwright config for the README screenshot capture only.
 * Serves the public/ directory with a simple static server —
 * no Next.js build needed since iframes point at production.
 *
 * Used by: npm run screenshot
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "screenshot.spec.ts",
  timeout: 120 * 1000,
  use: {
    baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"]],
  webServer: {
    command: `npx serve public -l ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 15 * 1000,
  },
});
