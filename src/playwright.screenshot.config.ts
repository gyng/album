import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const reuseExistingServer = !process.env.CI;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

/**
 * Playwright config for the README screenshot capture only.
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
  webServer: skipWebServer
    ? undefined
    : {
        command: "npm start",
        url: baseURL,
        reuseExistingServer,
        timeout: 120 * 1000,
      },
});
