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
        "google/siglip2-base-patch16-224",
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
  await page.route("**/e2e-search.sqlite", (route) =>
    route.fulfill({ body: core, contentType: "application/octet-stream" }),
  );
  await page.route("**/e2e-search-embeddings.sqlite", (route) =>
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

test("Cross Exposure starts with hidden connections and reveals a scrollable, aligned grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/cross-exposure");
  await expect(
    page.getByRole("button", { name: "Hidden connections", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start crossing", exact: true }).click();
  const board = page.getByRole("region", { name: "Crossword board" });
  await expect(board.getByRole("columnheader").first()).toHaveText("Column 1");
  await expect(
    page.getByRole("group", { name: "Available photographs" }).getByRole("button"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Reveal clues", exact: true }).click();
  await expect(board.getByRole("columnheader").first()).not.toHaveText("Column 1");
  const header = board.getByRole("rowheader").first();
  const bounds = await board.boundingBox();
  await board.focus();
  await board.press("ArrowRight");
  await board.press("ArrowRight");
  await board.press("ArrowRight");
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const after = await header.boundingBox();
  expect(after!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
  expect(after!.x).toBeLessThanOrEqual(bounds!.x + 12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cross Exposure result" })).toBeFocused();
  await expect(board.getByRole("img")).toHaveCount(9);
});
