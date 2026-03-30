import { test, expect } from "@playwright/test";

test.describe("Timeline Functionality", () => {
  test("heatmap preview and day selection work", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/timeline");

    // Wait for page to be ready
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

    const populatedCells = page.locator('button[aria-disabled="false"]');
    await expect(populatedCells.first()).toBeVisible();

    const firstCell = populatedCells.first();
    await firstCell.hover();

    const previewLink = page
      .locator('a[aria-label^="View "][aria-label$=" preview"]')
      .first();
    await expect(previewLink).toBeVisible();
    await expect(previewLink.locator("img")).toBeVisible();

    await firstCell.click();

    const selectedSection = page.locator('section[aria-label^="Photos from "]');
    await expect(selectedSection).toBeVisible();
    await expect(
      selectedSection.locator('a[href*="/album/"]').first(),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("mobile layout works", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/timeline");

    await expect(
      page.locator('section[aria-label^="Photos from "]'),
    ).toBeVisible();
    await page.getByRole("button", { name: /random/i }).click();
    await expect(page.locator('a[href*="/album/"]').first()).toBeVisible();
  });
});
