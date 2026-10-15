import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
for (const width of [390, 1280]) {
  test(`cloud combines filters and retains both layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route("**/data/embedding-space.json", (route) =>
      route.fulfill({
        json: {
          points: [0, 1, 2].map((index) => ({
            src: `/data/albums/test-simple/.resized_images/${index}.jpg%40800.avif`,
            href: `/album/test-simple#${index}`,
            label: `Cloud frame ${index}`,
            year: index === 1 ? 2023 : 2024,
            lens: index === 2 ? "Telephoto" : "Prime",
            cluster: 0,
            x: index * 0.4,
            y: 0,
            z: 0,
            umap: { x: index * 0.2, y: 0.1, z: 0 },
          })),
          clusters: [{ label: "trees", count: 3, x: 0, y: 0, z: 0, umap: { x: 0, y: 0, z: 0 } }],
        },
      }),
    );
    let databaseRequests = 0;
    page.on("request", (request) => {
      if (/\.sqlite(?:\?|$)/.test(request.url())) databaseRequests++;
    });
    await page.route(/huggingface\.co|cdn-lfs/, () => new Promise(() => {}));
    await gotoHydrated(page, "/explore#embedding-space");
    const canvas = page.getByRole("img", { name: /photographs arranged/ });
    await expect(canvas).toBeVisible();
    await expect(page.getByText("Find a scene", { exact: true })).toHaveCount(0);
    if (width === 1280) {
      const search = await page.getByRole("searchbox", { name: "Find a scene" }).boundingBox();
      const year = await page.getByLabel("Year", { exact: true }).boundingBox();
      expect(Math.abs(search!.y - year!.y)).toBeLessThan(10);
      expect(search!.x).toBeGreaterThan(year!.x + year!.width);
      const spotlight = await page
        .getByRole("button", { name: "Spotlight", exact: true })
        .boundingBox();
      const stage = await canvas.boundingBox();
      expect(Math.abs(spotlight!.x + spotlight!.width - stage!.x - stage!.width)).toBeLessThan(2);
    }

    await expect(page.getByRole("radio", { name: "Similar photos", exact: true })).toBeChecked();
    await page.getByLabel("Year", { exact: true }).selectOption("2024");
    await expect(canvas).toHaveAttribute("aria-label", /^2 photographs/);
    await page.getByLabel("Lens", { exact: true }).selectOption("Telephoto");
    await expect(
      page.locator("#embedding-space").getByRole("link", { name: "Cloud frame 2", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.locator("#embedding-space").getByRole("link", { name: "Cloud frame 0", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Overview", exact: true }).click();
    await page.getByRole("radio", { name: "2D", exact: true }).click();
    await page.getByRole("radio", { name: "Sheet", exact: true }).click();
    await page.getByLabel("Year", { exact: true }).selectOption("2023");
    await expect(page.getByText("No photographs match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(canvas).toHaveAttribute("aria-label", /^3 photographs/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(databaseRequests).toBe(0);
    await page.getByRole("searchbox", { name: "Find a scene" }).fill("rainy streets");
    await page.getByRole("button", { name: "Spotlight", exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Loading image search|Preparing scene search|Finding photographs/ }),
    ).toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(canvas).toHaveAttribute("aria-label", /^3 photographs/);
  });
}
