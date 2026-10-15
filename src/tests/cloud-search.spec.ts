import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
test.use({ serviceWorkers: "block" });

test("cloud can zoom past its previous limit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHydrated(page, "/explore");
  const cloud = page.getByRole("img", {
    name: /^[1-9][\d,]* photographs arranged by what they are of/,
  });
  await cloud.scrollIntoViewIfNeeded();
  const box = await cloud.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -5000);
  await expect
    .poll(async () => Number((await page.getByText(/^×\d/).innerText()).slice(1)))
    .toBeGreaterThan(10);
});
for (const width of [1280, 390])
  test(`cloud stays still during scene search at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/search-embeddings.sqlite", () => new Promise(() => {}));
    await gotoHydrated(page, "/explore");
    const showCloud = page.getByRole("button", { name: "Show Cloud", exact: true });
    if (await showCloud.isVisible()) await showCloud.click();
    const query = page.getByRole("searchbox", { name: "Find a scene" });
    await query.scrollIntoViewIfNeeded();
    const cloud = page.getByRole("img", { name: /photographs arranged by what they are of/ });
    await expect(cloud).toBeVisible();
    const top = () => cloud.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const before = await top();
    await query.fill("rainy streets");
    await page.getByRole("button", { name: "Spotlight", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ has: page.getByText("Loading image search…") }),
    ).toBeVisible();
    expect(Math.abs((await top()) - before)).toBeLessThan(1);
    await page.getByRole("button", { name: "Clear search" }).click();
    expect(Math.abs((await top()) - before)).toBeLessThan(1);
  });
