import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gotoHydrated } from "./hydrated";

test.use({ serviceWorkers: "block", hasTouch: true });
let directory: string;
let core: Buffer;
let connectionsCore: Buffer;
const image = readFileSync("../albums/test-simple/DSCF0506-2.jpg");
test.beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "sight-lines-e2e-"));
  const corePath = path.join(directory, "core.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  const db = new DatabaseSync(corePath);
  db.exec("DELETE FROM images; DELETE FROM metadata;");
  const subjects = ["cat", "bicycle", "boat", "umbrella", "stairs", "clock"];
  for (let index = 0; index < 108; index++) {
    const filename = `sightline-${index}.jpg`;
    const subject = subjects[Math.floor(index / 18)]!;
    db.prepare(
      "INSERT INTO images (path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject) VALUES (?, ?, ?, '', '', ?, '', ?, '')",
    ).run(
      `../albums/test-simple/${filename}`,
      `/album/test-simple#${filename}`,
      filename,
      subject,
      `A photograph of ${subject}.`,
    );
  }
  db.close();
  core = readFileSync(corePath);
  const connectionsDb = new DatabaseSync(corePath);
  const connectionSubjects = ["people", "water", "food", "snow", "animals", "buildings"];
  for (let index = 0; index < 108; index++) {
    const subject = connectionSubjects[Math.floor(index / 18)]!;
    connectionsDb
      .prepare("UPDATE images SET tags = ?, alt_text = ? WHERE filename = ?")
      .run(subject, `A photograph of ${subject}.`, `sightline-${index}.jpg`);
  }
  connectionsDb.close();
  connectionsCore = readFileSync(corePath);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));
test.beforeEach(async ({ page }, testInfo) => {
  await page.route(/\/(?:e2e-)?search\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({
      body: testInfo.title.startsWith("Connections") ? connectionsCore : core,
      contentType: "application/octet-stream",
    }),
  );
  // Synthetic game metadata uses a committed test photograph for every thumbnail.
  await page.route(/sightline-\d+\.jpg/, (route) =>
    route.fulfill({ body: image, contentType: "image/jpeg" }),
  );
});

for (const { width, size } of [
  { width: 320, size: 6 },
  { width: 1280, size: 5 },
]) {
  test(`Sight Lines lists its subjects and solves with ${width < 500 ? "touch" : "drag"} on a ${size}×${size} board`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoHydrated(page, "/fun/sight-lines");
    await page.getByRole("button", { name: `${size}×${size}`, exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: `${size}×${size}`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Start searching" }).click();
    const targets = page.getByRole("region", { name: "Search targets" });
    await expect(targets.getByRole("heading", { name: "Find these" })).toBeVisible();
    await expect(targets.getByRole("listitem")).toHaveCount(4);
    const board = page.getByRole("group", { name: "Photo search board" });
    const box = await board.getByRole("button").first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    for (let found = 0; found < 4; found++) {
      await page.getByRole("button", { name: "Hint", exact: true }).click();
      const hint = board.getByRole("button", { name: /hint starts here/ });
      const label = (await hint.getAttribute("aria-label"))!;
      const coordinate = label.match(/Row (\d+), column (\d+)/)!;
      const row = Number(coordinate[1]) - 1,
        column = Number(coordinate[2]) - 1;
      const subjectNames: Record<string, string> = {
        Cats: "cat",
        Bicycles: "bicycle",
        Boats: "boat",
        Umbrellas: "umbrella",
        Stairs: "stairs",
        Clocks: "clock",
      };
      const targetName = (await targets
        .getByLabel(/: still to find$/)
        .first()
        .getAttribute("aria-label"))!.split(":")[0]!;
      const subject = subjectNames[targetName]!;
      const captions = await board
        .getByRole("img")
        .evaluateAll((images) => images.map((image) => image.getAttribute("alt") ?? ""));
      const direction = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].find(([dy, dx]) => {
        const endRow = row + dy! * 2,
          endColumn = column + dx! * 2;
        return (
          endRow >= 0 &&
          endColumn >= 0 &&
          endRow < size &&
          endColumn < size &&
          [0, 1, 2].every((step) =>
            captions[(row + dy! * step) * size + column + dx! * step]!.includes(`of ${subject}.`),
          )
        );
      });
      expect(direction).toBeTruthy();
      const end = board
        .getByRole("button")
        .nth((row + direction![0]! * 2) * size + column + direction![1]! * 2);
      if (width < 500) {
        await hint.tap();
        // Touch selection commits on click, after compatibility events settle.
        await expect(hint).toHaveAttribute("aria-pressed", "true");
        await end.tap();
      } else {
        await board.evaluate((element) => element.scrollIntoView({ block: "start" }));
        const startBox = (await hint.boundingBox())!,
          endBox = (await end.boundingBox())!;
        await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, {
          steps: 8,
        });
        await page.mouse.up();
      }

      await expect(targets.getByLabel(/: found$/)).toHaveCount(found + 1);
    }
    const result = page.getByRole("region", { name: "Sight Lines result" });
    await expect(result).toBeFocused();
    await expect(page).toHaveURL(/\/fun\/sight-lines(?:\?|$)/);
    await expect(result.getByRole("link").filter({ has: page.getByRole("img") })).toHaveCount(12);
  });
}

for (const viewport of [
  { width: 390, height: 700 },
  { width: 844, height: 390 },
]) {
  test(`Sight Lines keeps its context reachable at ${viewport.width}×${viewport.height} without covering the preview`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoHydrated(page, "/fun/sight-lines");
    await page.getByRole("button", { name: "Start searching" }).click();
    const dock = page.getByRole("group", { name: "Sight Lines board and targets" });
    const board = page.getByRole("group", { name: "Photo search board" });
    const images = await board
      .getByRole("img")
      .evaluateAll((items) => items.map((item) => item.getAttribute("alt")));
    const first = Array.from({ length: 5 }, (_, row) => row * 5).find(
      (index) => new Set(images.slice(index, index + 3)).size > 1,
    )!;
    await board.getByRole("button").nth(first).tap();
    await board
      .getByRole("button")
      .nth(first + 2)
      .tap();
    const preview = page.getByRole("region", { name: "Selected photographs" });
    await expect(preview.getByRole("img")).toHaveCount(3);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (viewport.height > 600) {
      await expect
        .poll(() => dock.evaluate((element) => getComputedStyle(element).position))
        .toBe("sticky");
      const box = (await dock.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(7);
      // Safari's overlay scrollbar can fit the preview into one row, so the
      // document may end before the dock needs to reach its sticky threshold.
      expect(box.height + 8).toBeLessThanOrEqual(viewport.height - 144);
      await expect(dock).toBeInViewport({ ratio: 1 });
      await expect(preview.getByRole("img").last()).toBeInViewport({ ratio: 1 });
    } else
      await expect
        .poll(() => dock.evaluate((element) => getComputedStyle(element).position))
        .toBe("static");
    await page.getByRole("button", { name: "Give up" }).click();
    await expect
      .poll(() => dock.evaluate((element) => getComputedStyle(element).position))
      .toBe("static");
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`Connections keeps actions reachable while reviewing a 6×6 board at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoHydrated(page, "/fun/connections");
    await page.getByRole("button", { name: "6×6", exact: true }).click();
    await page.getByRole("button", { name: "Start connecting" }).click();
    const controls = page.getByRole("group", { name: "Connection controls" });
    const choices = page
      .getByRole("group", { name: "Photographs", exact: true })
      .getByRole("button");
    await expect(choices).toHaveCount(36);
    for (let index = 0; index < 6; index++) await choices.nth(index).click();
    if (viewport.width <= 720)
      await page
        .getByRole("region", { name: "Selected photographs" })
        .getByRole("img")
        .last()
        .scrollIntoViewIfNeeded();
    else await choices.last().scrollIntoViewIfNeeded();
    await expect.poll(async () => (await controls.boundingBox())!.y).toBeLessThanOrEqual(9);
    for (const control of await controls.getByRole("button").all()) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await expect(controls.getByRole("button", { name: "Check connection" })).toBeEnabled();
    await controls.getByRole("button", { name: "Deselect" }).click();
    await expect(controls.getByRole("button", { name: "Check connection" })).toBeDisabled();
    await page.getByRole("button", { name: "Give up" }).click();
    await expect(page.getByRole("region", { name: "Connections result" })).toBeFocused();
    await expect(controls).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}

test("releasing a drag outside the board does not select photographs when the pointer returns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHydrated(page, "/fun/sight-lines");
  await page.getByRole("button", { name: "Start searching" }).click();
  const board = page.getByRole("group", { name: "Photo search board" });
  await board.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const first = (await board.getByRole("button").first().boundingBox())!;
  const third = (await board.getByRole("button").nth(2).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, first.y + first.height / 2);
  await page.mouse.up();
  await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
  await expect(board.getByRole("button").nth(2)).toHaveAttribute("aria-pressed", "false");
});

test("Sight Lines preserves a 10×10 five-photo-line game and keeps mobile targets usable", async ({
  page,
}) => {
  // Rendering and resolving a 100-tile board takes 12–20s under parallel workers.
  test.slow();
  await page.setViewportSize({ width: 320, height: 844 });
  await gotoHydrated(page, "/fun/sight-lines");
  await page.getByRole("button", { name: "10×10", exact: true }).click();
  await page.getByRole("button", { name: "5 per line", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "10×10", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "5 per line", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Start searching", exact: true })).toBeEnabled();
  await page.keyboard.press("n");
  const board = page.getByRole("group", { name: "Photo search board" });
  await expect(board.getByRole("button")).toHaveCount(100);
  const box = await board.getByRole("button").first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  const result = page.getByRole("region", { name: "Sight Lines result" });
  await expect(result).toBeFocused();
  await expect(result.getByRole("link").filter({ has: page.getByRole("img") })).toHaveCount(30);
});
