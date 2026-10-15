import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gotoHydrated } from "./hydrated";

test.use({ serviceWorkers: "block" });
let directory: string;
let core: Buffer;
let embeddings: Buffer;

test.beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "gallery-grid-flash-"));
  const corePath = path.join(directory, "core.sqlite");
  const vectorPath = path.join(directory, "vectors.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  copyFileSync("public/e2e-search-embeddings.sqlite", vectorPath);
  const db = new DatabaseSync(corePath);
  const vectors = new DatabaseSync(vectorPath);
  db.exec("DELETE FROM images; DELETE FROM metadata;");
  vectors.exec("DELETE FROM embeddings;");
  const names = ["DSCF0506-2.jpg", "DSCF0593.jpg", "DSCF2485-2.jpg"];
  const albums = ["test-simple", "test-manifest", "test-manifest-v2"];
  for (let index = 0; index < 9; index++) {
    const album = albums[Math.floor(index / 3)]!;
    const name = names[index % 3]!;
    const photoPath = `../albums/${album}/${name}`;
    const subject = ["people", "water", "food"][Math.floor(index / 3)]!;
    const framing = ["red", "indoors", "night"][index % 3]!;
    db.prepare(
      "INSERT INTO images (path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject) VALUES (?, ?, ?, ?, '', ?, '', ?, '')",
    ).run(
      photoPath,
      `/album/${album}#${name}`,
      name,
      "Fixture town\nJapan",
      `${subject}, ${framing}`,
      `A photograph of ${subject}, ${framing}.`,
    );
    db.prepare("INSERT INTO metadata (path, lat_deg, lng_deg, iso8601) VALUES (?, ?, ?, ?)").run(
      photoPath,
      index < 4 ? (index < 2 ? 35 : 35 + index * 5) : null,
      index < 4 ? 139 : null,
      `2024-01-0${index + 1}T12:00:00`,
    );
    vectors
      .prepare(
        "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) VALUES (?, ?, 3, ?, ?)",
      )
      .run(
        photoPath,
        "google/embeddinggemma-2",
        new Uint8Array([100, index % 2 ? 30 : 0, 0]),
        1 / 127,
      );
  }
  db.close();
  vectors.close();
  core = readFileSync(corePath);
  embeddings = readFileSync(vectorPath);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));
test.beforeEach(async ({ page }) => {
  await page.route(/\/(?:e2e-)?search\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({ body: core, contentType: "application/octet-stream" }),
  );
  await page.route(/\/(?:e2e-)?search-embeddings\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({ body: embeddings, contentType: "application/octet-stream" }),
  );
});

test("Double Take decodes a full frame before flashing and keeps it contained", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHydrated(page, "/fun/double-take");
  await page.getByRole("button", { name: /Longer look/ }).click();
  await page.getByRole("button", { name: "Start Double Take", exact: true }).click();
  const image = page.getByRole("img", { name: "Photograph 1", exact: true });
  await expect(image).toBeVisible();
  const geometry = await image.evaluate((element: HTMLImageElement) => {
    const image = element.getBoundingClientRect();
    const stage = element.parentElement!.getBoundingClientRect();
    return {
      ready: element.complete && element.naturalWidth > 0,
      contained:
        image.top >= stage.top - 1 &&
        image.bottom <= stage.bottom + 1 &&
        image.width <= stage.width + 1,
    };
  });
  expect(geometry).toEqual({ ready: true, contained: true });
  await expect(page.getByRole("img", { name: "Photograph 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Same place", exact: true }).click();
  const reveal = page.getByRole("region", { name: "Pair revealed" });
  await expect(reveal.getByRole("link")).toHaveCount(2);
  await expect(reveal).toContainText(/metres apart|km apart/);
});

test("Cross Exposure keeps its whole mobile grid visible and reveals the clue key", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/cross-exposure");
  await expect(
    page.getByRole("button", { name: "Hidden connections", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start crossing", exact: true }).click();
  const board = page.getByRole("region", { name: "Crossword board" });
  await expect(board.getByRole("columnheader").first()).toHaveAccessibleName("Column A");
  await expect(
    page.getByRole("group", { name: "Available photographs" }).getByRole("button"),
  ).toHaveCount(9);
  for (let hint = 0; hint < 6; hint++)
    await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(board.getByRole("columnheader").first()).not.toHaveAccessibleName("Column A");
  for (const header of await board.locator("th").all()) {
    await expect(header).toHaveText((await header.getAttribute("aria-label"))!);
    await expect(header).toBeVisible();
  }
  const geometry = await board.evaluate((element) => ({
    width: element.clientWidth,
    content: element.scrollWidth,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width);
  await expect(page.getByRole("region", { name: "Row clues" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Column clues" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cross Exposure result" })).toBeFocused();
  await expect(board.getByRole("img")).toHaveCount(9);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`Cross Exposure keeps the board and selected-shot controls reachable while browsing the tray at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoHydrated(page, "/fun/cross-exposure");
    await page
      .getByRole("group", { name: "Starting photographs" })
      .getByRole("button", { name: "0 starting photographs", exact: true })
      .click();
    await page.getByRole("button", { name: "Start crossing", exact: true }).click();
    const board = page.getByRole("region", { name: "Crossword board" });
    const controls = page.getByRole("group", { name: "Crossword controls" });
    const tray = page.getByRole("group", { name: "Available photographs" });
    await expect(tray.getByRole("button")).toHaveCount(9);
    const last = tray.getByRole("button").last();
    const source = await last.getByRole("img").getAttribute("src");
    await last.scrollIntoViewIfNeeded();
    const geometry = () =>
      board.evaluate((element) => {
        let dock: HTMLElement | null = element.parentElement;
        while (dock && getComputedStyle(dock).position !== "sticky") dock = dock.parentElement;
        const rect = element.getBoundingClientRect();
        return {
          stickyTop: dock?.getBoundingClientRect().top ?? -1,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewport: innerHeight,
        };
      });
    await expect.poll(async () => (await geometry()).stickyTop).toBeGreaterThanOrEqual(7);
    expect((await geometry()).stickyTop).toBeLessThanOrEqual(9);
    expect((await geometry()).bottom).toBeLessThanOrEqual(viewport.height - 44);
    await expect(controls.getByRole("button", { name: "Hint", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await last.click();
    const preview = controls.locator("img");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("src", source!);
    await expect(preview).toBeInViewport({ ratio: 1 });
    const cell = board.getByRole("button", { name: /^Row 1; column A;/ });
    await expect(cell).toBeInViewport({ ratio: 1 });
    await cell.click();
    await expect(cell).toHaveAccessibleName(/; occupied$/);
    await expect(cell).toBeInViewport({ ratio: 1 });
    expect((await geometry()).stickyTop).toBeLessThanOrEqual(9);
    await expect(tray.getByRole("button")).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}

test("Cross Exposure keeps desktop play in one workspace and supports dragging, swapping and returning shots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHydrated(page, "/fun/cross-exposure");
  await page.getByRole("button", { name: "Start crossing", exact: true }).click();
  const board = page.getByRole("region", { name: "Crossword board" });
  const tray = page.getByRole("group", { name: "Available photographs" });
  const cells = board.getByRole("button");
  const first = cells.nth(0);
  const second = cells.nth(1);
  const tile = tray.getByRole("button").first();
  const source = await tile.getByRole("img").getAttribute("src");
  await tile.dragTo(first);
  await expect(first.getByRole("img")).toHaveAttribute("src", source!);
  const nextTile = tray.getByRole("button").first();
  const nextSource = await nextTile.getByRole("img").getAttribute("src");
  await nextTile.dragTo(second);
  await first.dragTo(second);
  await expect(second.getByRole("img")).toHaveAttribute("src", source!);
  await expect(first.getByRole("img")).toHaveAttribute("src", nextSource!);
  await second.dragTo(tray);
  await expect(second.getByRole("img")).toHaveCount(0);
  await expect(tray.getByRole("button")).toHaveCount(8);
  const geometry = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: innerHeight,
    board: document
      .querySelector('[aria-label="Crossword board"]')!
      .getBoundingClientRect()
      .toJSON(),
    tray: document
      .querySelector('[aria-label="Available photographs"]')!
      .getBoundingClientRect()
      .toJSON(),
  }));
  expect(geometry.tray.left).toBeGreaterThan(geometry.board.right);
  expect(geometry.height).toBeLessThanOrEqual(geometry.viewport);
});

test("Cross Exposure releases a tall tablet board so the photograph tray remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 700 });
  await gotoHydrated(page, "/fun/cross-exposure");
  await page.getByRole("button", { name: "Start crossing", exact: true }).click();
  const board = page.getByRole("region", { name: "Crossword board" });
  await expect(board).toBeVisible();
  const stuck = () =>
    board.evaluate((element) => {
      let node: HTMLElement | null = element.parentElement;
      while (node) {
        if (getComputedStyle(node).position === "sticky") return true;
        node = node.parentElement;
      }
      return false;
    });
  await expect.poll(stuck).toBe(false);
  const candidate = page
    .getByRole("group", { name: "Available photographs" })
    .getByRole("button")
    .last();
  const focusMargin = await candidate.evaluate(
    (node) => Number.parseFloat(getComputedStyle(node).scrollMarginBlockStart) || 0,
  );
  expect(focusMargin).toBeLessThanOrEqual(16);
  await candidate.scrollIntoViewIfNeeded();
  await candidate.click();
  await expect(candidate).toHaveAttribute("aria-pressed", "true");
  await expect(candidate).toBeInViewport({ ratio: 1 });
});

test("game setup choices survive a page reload", async ({ page }) => {
  const reload = async () => {
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true");
  };
  const settings = (game: string) =>
    page.evaluate(
      (name) => JSON.parse(localStorage.getItem(`snapshots-fun-settings-v1:${name}`) ?? "null"),
      game,
    );
  await gotoHydrated(page, "/fun/cross-exposure");
  await page
    .getByRole("group", { name: "Grid size" })
    .getByRole("button", { name: "5×5", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Clue mode" })
    .getByRole("button", { name: "Visible clues", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Starting photographs" })
    .getByRole("button", { name: "0 starting photographs", exact: true })
    .click();
  await expect.poll(() => settings("cross")).toEqual({ size: 5, mode: "visible", prefill: 0 });
  await reload();
  await expect(page.getByRole("button", { name: "5×5", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Visible clues", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "0 starting photographs", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await gotoHydrated(page, "/fun/connections");
  await page.getByRole("button", { name: "6×6", exact: true }).click();
  await page.getByRole("button", { name: "Specific subjects", exact: true }).click();
  await page.getByRole("button", { name: "One-away hints on", exact: true }).click();
  await expect
    .poll(() => settings("connections"))
    .toEqual({ size: 6, detail: "specific", hints: false, lives: null });
  await reload();
  await expect(page.getByRole("button", { name: "6×6", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Specific subjects", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "One-away hints off", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  await gotoHydrated(page, "/fun/double-take");
  await page.getByRole("button", { name: /Longer look/ }).click();
  await expect.poll(() => settings("doubleTake")).toEqual({ slower: true });
  await reload();
  await expect(page.getByRole("button", { name: /Longer look.*3 seconds/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
