import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const reuseExistingServer = !process.env.CI;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["list"], ["html", { open: "never" }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    /* Navigation timeout — map/slideshow pages are heavy in CI */
    navigationTimeout: process.env.CI ? 60 * 1000 : 15 * 1000,
    /* Take screenshot on failure */
    screenshot: "only-on-failure",
    /* Record video on failure */
    video: "retain-on-failure",
  },

  /* Increase timeout due to slow initial page load */
  timeout: process.env.CI ? 90 * 1000 : 15 * 1000,
  expect: {
    timeout: process.env.CI ? 45 * 1000 : 5 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    // Run all browsers in CI, but only chromium locally for faster dev loop
    ...(process.env.CI
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
          },
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
          },
        ]
      : []),

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /*
   * Managed server path for normal e2e runs.
   * Use PLAYWRIGHT_SKIP_WEBSERVER=1 only when you intentionally want to point
   * Playwright at an already-running server that you know is serving fresh code.
   */
  webServer: skipWebServer
    ? undefined
    : {
        command: "npm start",
        url: baseURL,
        reuseExistingServer,
        timeout: 120 * 1000,
      },
});
