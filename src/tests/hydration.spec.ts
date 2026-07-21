import { expect, test } from "@playwright/test";

test.use({ locale: "fr-FR", timezoneId: "America/New_York" });

const routes = [
  "/?theme=bling",
  "/album/test-simple#DSCF0506-2.jpg",
  "/benchmark",
  "/design",
  "/explore",
  "/guess?seed=shared-challenge&rounds=3&timer=15",
  "/map?filter_album=test-simple&from=2019-11-01&to=2019-11-30",
  "/search",
  "/slideshow?mode=random&delay=60000",
  "/slideshow/shell",
  "/timeline?filter_album=test-simple&date=2019-11-06",
  "/404",
] as const;

const isHydrationDiagnostic = (message: string) =>
  /hydration|server rendered html|did not match|minified react error #(41[89]|42[0-5])|cannot be (?:a descendant|a child) of/i.test(
    message,
  );

test.describe("server hydration", () => {
  for (const route of routes) {
    test(`${route} hydrates without recovering client content`, async ({ page }) => {
      const diagnostics: string[] = [];
      page.on("console", (message) => {
        if (isHydrationDiagnostic(message.text())) {
          diagnostics.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        if (isHydrationDiagnostic(error.message)) {
          diagnostics.push(error.message);
        }
      });

      await page.addInitScript(() => {
        localStorage.setItem("slideshow-showclock", "true");
        localStorage.setItem("slideshow-showdetails", "true");
        localStorage.setItem("slideshow-mode", '"random"');
        localStorage.setItem("slideshow-timedelay", "60000");
      });

      await page.goto(route, { waitUntil: "load" });
      await page.locator("body").waitFor();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      expect(diagnostics).toEqual([]);
    });
  }
});
