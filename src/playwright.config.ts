import { defineConfig, devices } from "@playwright/test";

/*
 * The port the managed server listens on.
 *
 * Not 3000: that is where every other project's dev server lives, and on WSL a
 * Windows listener on the same port collides through localhost forwarding — a
 * conflict `ss` inside the distro cannot even see, so it surfaces as a bare
 * EADDRINUSE with nothing to point at and the whole suite refuses to start.
 * `PLAYWRIGHT_PORT` overrides it; `PLAYWRIGHT_BASE_URL` still wins outright,
 * for pointing at a server this config did not start.
 */
const configuredPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "", 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 43110;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
const recordLocalVideo = process.env.PLAYWRIGHT_VIDEO === "1";
const configuredWorkers = process.env.PLAYWRIGHT_WORKERS
  ? Number.parseInt(process.env.PLAYWRIGHT_WORKERS, 10)
  : null;
const workers =
  configuredWorkers && configuredWorkers > 0 ? configuredWorkers : process.env.CI ? 2 : 4;

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
  testIgnore: ["**/screenshot.spec.ts"],

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry for diagnostics, but never let a retry-pass hide a flaky CI test. */
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: !!process.env.CI,
  /* Keep CI parallelism conservative; override when profiling larger runners. */
  workers,
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
    /* CI retries failures, so successful first attempts need not record video. */
    video: process.env.CI ? "on-first-retry" : recordLocalVideo ? "retain-on-failure" : "off",
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
            use: {
              ...devices["Desktop Firefox"],
              launchOptions: {
                env: {
                  ...process.env,
                  LIBGL_ALWAYS_SOFTWARE: "1",
                  MOZ_WEBGL_FORCE_EGL: "1",
                },
                firefoxUserPrefs: {
                  // MapLibre 6 requires WebGL2. The headless Ubuntu runner has
                  // no native GL driver, so Firefox must permit the Mesa
                  // software context selected by the launch environment.
                  "webgl.forbid-software": false,
                  "webgl.force-enabled": true,
                },
              },
            },
            testMatch: "**/smoke.spec.ts",
          },
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
            testMatch: "**/smoke.spec.ts",
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
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: `next start -H 127.0.0.1 -p ${port}`,
          env: { NEXT_DIST_DIR: ".next-e2e" },
          port,
          reuseExistingServer: false,
          timeout: 120 * 1000,
        },
      }),
});
