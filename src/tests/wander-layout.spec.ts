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
  const keywordPanel = await page
    .getByRole("region", { name: "Follow a keyword", exact: true })
    .boundingBox();
  expect(keywordPanel!.x).toBeGreaterThan(main!.x + main!.width);
  expect(keywordPanel!.y).toBeLessThan(main!.y + main!.height);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await ways.getByRole("button", { name: "closest", exact: true }).click();
  const current = page.getByRole("img", { name: "Scene 1", exact: true });
  await expect(current).toBeVisible();
  expect(await current.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.getByRole("button", { name: "Less subject1", exact: true }).click();
  await expect(page.getByRole("img", { name: "Scene 2", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Wander keyword" }).fill("subject6");
  await page.getByRole("button", { name: "Follow keyword", exact: true }).click();
  await expect(page.getByRole("img", { name: "Scene 6", exact: true })).toBeVisible();

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
  await expect(page.getByRole("button", { name: "Nature", exact: true })).toBeHidden();
  await page.getByText("Change scene", { exact: true }).click();
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

test("Explore opens the Fun quest and Wander offers photo hunts and difficulty", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const tags = [
    [],
    ["cat", "stairs"],
    ...Array.from({ length: 8 }, () => ["cat"]),
    ...Array.from({ length: 8 }, () => ["stairs"]),
  ];
  const points = tags.map((tags, i) => ({
    src: `/data/albums/test-simple/.resized_images/quest${i}.jpg%40800.avif`,
    href: `/album/test-simple#quest${i}.jpg`,
    label: `Quest scene ${i}`,
    tags,
    near: i === 0 ? [1, 2, 3] : [0, 1, 2].filter((index) => index !== i),
    around: [],
    x: i,
    y: 0,
    z: 0,
  }));
  await page.route("**/data/embedding-space.json", (route) =>
    route.fulfill({ json: { points, clusters: [], axisScale: { x: 1, y: 1, z: 1 }, atlas: null } }),
  );
  await page.route("**/quest*.avif", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="silver"/></svg>',
    }),
  );
  await gotoHydrated(page, "/explore?wander=../albums/test-simple/quest0.jpg");
  await page.getByRole("link", { name: "Give me a quest", exact: true }).click();
  await expect(page).toHaveURL(/\/fun\/wander\?/);
  await expect(page.getByRole("list", { name: "Quest targets" })).toContainText("cat + stairs");
  await expect(page.getByRole("button", { name: "Take a leap", exact: true })).toBeDisabled();
  await expect(
    page
      .getByRole("list", { name: "Ways on" })
      .getByRole("button", { name: "further afield", exact: true }),
  ).toHaveCount(0);

  const currentPhoto = page.getByRole("img", { name: "Quest scene 0", exact: true });
  await expect(currentPhoto.locator("xpath=ancestor::a")).toHaveCount(0);
  await currentPhoto.click();
  await expect(page).toHaveURL(/\/fun\/wander\?/);
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("closest");

  await page
    .getByRole("list", { name: "Ways on" })
    .getByRole("button", { name: "closest", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Wander result" })).toContainText("Quest complete");
  await page.getByRole("button", { name: "Change mode", exact: true }).click();
  await page.getByRole("radio", { name: "Photo hunt", exact: true }).click();
  await page.getByRole("radio", { name: "Hard", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
  await expect(page.getByRole("list", { name: "Quest targets" }).getByRole("img")).toHaveCount(5);
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await expect(page.getByRole("region", { name: "Solution", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Solution route" }).first()).toContainText(
    "Start here",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await gotoHydrated(page, "/fun");
  const card = page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Wander", exact: true }) });
  await expect(card).toHaveAttribute("href", "/fun/wander");
  await expect(card.locator("image")).toHaveAttribute("href", "/fun/wander.avif");
});
