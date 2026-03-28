import { test, expect } from "@playwright/test";

test.describe("Timeline Functionality", () => {
  test("heatmap preview and day selection work", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/timeline");

    await expect(page).toHaveTitle("Timeline");
    await expect(
      page.getByRole("heading", { name: "Timeline" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /random/i })).toBeVisible();

    const populatedCells = page.locator('button[aria-disabled="false"]');
    await expect(populatedCells.first()).toBeVisible({ timeout: 15000 });

    const firstCell = populatedCells.first();
    const firstCellLabel = await firstCell.getAttribute("aria-label");
    expect(firstCellLabel).toBeTruthy();

    await firstCell.hover();

    const previewLink = page.locator('a[aria-label^="View "][aria-label$=" preview"]').first();
    await expect(previewLink).toBeVisible({ timeout: 10000 });
    await expect(previewLink).toHaveAttribute("href", /\/album\/.+#.+/);
    await expect(previewLink.locator("img")).toBeVisible();

    await firstCell.click();

    const selectedSection = page.locator('section[aria-label^="Photos from "]');
    await expect(selectedSection).toBeVisible({ timeout: 10000 });

    const selectedHeading = selectedSection.getByRole("heading").first();
    await expect(selectedHeading).toBeVisible();
    await expect(selectedSection.locator('a[href*="/album/"]').first()).toBeVisible();

    const selectedCountText = await selectedSection.locator("text=/\\d+ photos?/").first().textContent();
    expect(selectedCountText).toMatch(/\d+ photos?/);
    await expect(page.getByLabel("Location summary")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("empty dates still show a text-only popup", async ({ page }) => {
    await page.goto("/timeline");

    const emptyCell = page.locator('button[aria-label*="no photos"]').first();
    await expect(emptyCell).toBeVisible({ timeout: 15000 });

    await emptyCell.hover();

    await expect(page.locator('a[aria-label^="View "][aria-label$=" preview"]')).toHaveCount(0);
    await expect(page.getByText(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i).first()).toBeVisible();
  });

  test("mobile layout keeps the selected day visible first", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/timeline");

    await expect(
      page.locator('section[aria-label^="Photos from "]'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /random/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /random/i }).click();
    await expect(
      page.locator('section[aria-label^="Photos from "] h2').first(),
    ).toBeVisible();
    await expect(
      page.locator('a[href*="/album/"]').first(),
    ).toBeVisible();
  });
});