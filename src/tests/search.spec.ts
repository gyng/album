import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test("search page loads with explore section", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search");

    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();

    // Browse mode explore section renders
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("search accepts a query and updates URL", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search");

    const input = page.locator('input[placeholder*="Type / to search"]');
    await expect(input).toBeVisible();

    await input.fill("tokyo");
    await expect(page).toHaveURL(/q=tokyo/);

    expect(pageErrors).toEqual([]);
  });

  test("similar mode loads source photo context", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    // Similar-to header and filename appear immediately (before DB loads)
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
