import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
test.use({ serviceWorkers: "block" });
test("Wander surrounds the current photograph and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const points = Array.from({ length: 7 }, (_, i) => ({
    src: `/data/albums/test-simple/.resized_images/scene${i}.jpg%40800.avif`,
    href: `/album/test-simple#scene${i}.jpg`,
    label: `Scene ${i}`,
    tags: [`subject${i}`],
    near: Array.from({ length: 7 }, (_, j) => j).filter((j) => j !== i),
    around: [],
    x: i / 10,
    y: 0,
    z: 0,
  }));
  await page.route("**/data/embedding-space.json", (route) =>
    route.fulfill({ json: { points, clusters: [], axisScale: { x: 1, y: 1, z: 1 }, atlas: null } }),
  );
  await page.route("**/scene*.avif", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="silver"/></svg>',
    }),
  );
  await gotoHydrated(page, "/explore?wander=../albums/test-simple/scene0.jpg");
  const ways = page.getByRole("list", { name: "Ways on" });
  await ways.scrollIntoViewIfNeeded();
  await expect(ways.getByRole("button")).toHaveCount(6);
  const main = await page.getByRole("img", { name: "Scene 0", exact: true }).boundingBox();
  const positions = await ways.getByRole("button").evaluateAll((buttons) =>
    buttons.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }),
  );
  expect(positions.some((p) => p.right <= main!.x)).toBe(true);
  expect(positions.some((p) => p.x >= main!.x + main!.width)).toBe(true);
  expect(positions.some((p) => p.bottom <= main!.y)).toBe(true);
  expect(positions.some((p) => p.y >= main!.y + main!.height)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ways.getByRole("button", { name: "closest", exact: true }).click();
  const current = page.getByRole("img", { name: "Scene 1", exact: true });
  await expect(current).toBeVisible();
  expect(await current.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Wander escapes a closed city loop and offers fresh scene shortcuts after Back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tags = [
    ["street", "building"],
    ["street", "car"],
    ["street", "building"],
    ["forest", "mountain"],
    ["sea", "beach"],
  ];
  const points = tags.map((tags, i) => ({
    src: `/data/albums/test-simple/.resized_images/escape${i}.jpg%40800.avif`,
    href: `/album/test-simple#escape${i}.jpg`,
    label: `Escape scene ${i}`,
    tags,
    near: i < 3 ? [0, 1, 2].filter((index) => index !== i) : [0],
    around: [],
    x: i,
    y: 0,
    z: 0,
  }));
  await page.route("**/data/embedding-space.json", (route) =>
    route.fulfill({ json: { points, clusters: [], axisScale: { x: 1, y: 1, z: 1 }, atlas: null } }),
  );
  await page.route("**/escape*.avif", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="silver"/></svg>',
    }),
  );
  await gotoHydrated(page, "/explore?wander=../albums/test-simple/escape0.jpg");
  await page.getByRole("button", { name: "Show Wander", exact: true }).click();
  const ways = page.getByRole("list", { name: "Ways on" });
  await expect(ways.getByRole("button", { name: "further afield", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nature", exact: true }).click();
  await expect(page.getByRole("img", { name: "Escape scene 3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("img", { name: "Escape scene 0", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nature", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Take a leap", exact: true }).click();
  await expect(page.getByRole("img", { name: "Escape scene 4", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/wander=.*escape4/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
