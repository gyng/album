import { expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gotoHydrated } from "./hydrated";
test.use({ serviceWorkers: "block", hasTouch: true });
let directory: string, core: Buffer, vectors: Buffer;
test.beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "gallery-pairs-layout-"));
  const corePath = path.join(directory, "core.sqlite"),
    vectorPath = path.join(directory, "vectors.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  copyFileSync("public/e2e-search-embeddings.sqlite", vectorPath);
  const db = new DatabaseSync(corePath),
    embeddings = new DatabaseSync(vectorPath);
  embeddings.exec("DELETE FROM embeddings");
  for (let i = 0; i < 48; i++) {
    const photo = `../albums/test-simple/pair-${i}.jpg`;
    db.prepare(
      "INSERT INTO images (path,album_relative_path,filename,geocode,exif,tags,colors,alt_text,subject) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      photo,
      `/album/test-simple#pair-${i}.jpg`,
      `pair-${i}.jpg`,
      "",
      "",
      "bird",
      "",
      "A bird portrait.",
      "",
    );
    const vector = new Uint8Array(24);
    vector[Math.floor(i / 2)] = 127;
    embeddings
      .prepare(
        "INSERT INTO embeddings (path,model_id,embedding_dim,embedding_blob,embedding_scale) VALUES (?,?,?,?,?)",
      )
      .run(photo, "google/siglip2-base-patch16-224", 24, vector, 1 / 127);
  }
  db.close();
  embeddings.close();
  core = readFileSync(corePath);
  vectors = readFileSync(vectorPath);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));
const fixture = async (page: Page, tall = false) => {
  await page.route(/\/(?:e2e-)?search(?:-embeddings)?\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/x-sqlite3",
      body: route.request().url().includes("-embeddings") ? vectors : core,
    }),
  );
  await page.route("**/data/albums/**/.resized_images/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${tall ? 4800 : 400}"><rect width="100%" height="100%" fill="silver"/></svg>`,
    }),
  );
};
test("jigsaw supports pool-to-grid dragging, rearranging, returning and keyboard placement", async ({
  page,
}) => {
  await fixture(page);
  await gotoHydrated(page, "/fun/photo-jigsaw");
  await expect(page.getByRole("button", { name: "Piece pool", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Start puzzle" })).toBeEnabled();
  await page.getByRole("button", { name: "Start puzzle" }).click();
  const pool = page.getByRole("region", { name: "Piece pool" });
  const first = pool.getByRole("button", { name: "Pool piece 1" });
  await expect(first).toBeEnabled();
  const destination = page.getByRole("button", { name: "Empty cell at row 1, column 1" });
  await first.dragTo(destination);
  await expect(pool.getByRole("button", { name: /Pool piece/ })).toHaveCount(8);
  await expect(page.getByText("1 move", { exact: true })).toBeVisible();
  const placed = page.getByRole("button", { name: "Piece at row 1, column 1" });
  await placed.dragTo(page.getByRole("button", { name: "Empty cell at row 1, column 2" }));
  await expect(page.getByRole("button", { name: "Empty cell at row 1, column 1" })).toBeVisible();
  await page.getByRole("button", { name: "Piece at row 1, column 2" }).dragTo(pool);
  await expect(pool.getByRole("button", { name: /Pool piece/ })).toHaveCount(9);
  await pool.getByRole("button", { name: "Pool piece 1" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Empty cell at row 1, column 1" }).focus();
  await page.keyboard.press("Enter");
  await expect(pool.getByRole("button", { name: /Pool piece/ })).toHaveCount(8);
});
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  for (const [label, cards] of [
    ["4×4", 16],
    ["5×5", 24],
    ["6×6", 36],
    ["7×7", 48],
  ] as const)
    test(`matching ${label} board fits ${viewport.width}px with tall photographs`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await fixture(page, true);
      await gotoHydrated(page, "/fun/photo-pairs");
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("button", { name: "Start matching" })).toBeEnabled();
      await page.getByRole("button", { name: "Start matching" }).click();
      await expect(page.getByLabel("Matching cards").getByRole("button")).toHaveCount(cards);
      await page.getByRole("button", { name: "Card 1, face down", exact: true }).click();
      const image = page.getByLabel("Matching cards").getByRole("img");
      await expect(image).toBeVisible();
      await image.evaluate(async (el) => {
        await (el as HTMLImageElement).decode();
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
        .toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    });

test("touch dragging places a piece and cancellation leaves the board intact", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP is used to send native touch gestures.");
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await gotoHydrated(page, "/fun/photo-jigsaw");
  await expect(page.getByRole("button", { name: "Start puzzle" })).toBeEnabled();
  await page.getByRole("button", { name: "Start puzzle" }).click();
  const pool = page.getByRole("region", { name: "Piece pool" }),
    piece = pool.getByRole("button", { name: "Pool piece 1" });
  await expect(piece).toBeEnabled();
  await piece.scrollIntoViewIfNeeded();
  const from = await piece.boundingBox(),
    to = await page.getByRole("button", { name: "Empty cell at row 1, column 1" }).boundingBox();
  const session = await page.context().newCDPSession(page);
  const start = { x: from!.x + from!.width / 2, y: from!.y + from!.height / 2 },
    end = { x: to!.x + to!.width / 2, y: to!.y + to!.height / 2 };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(pool.getByRole("button", { name: /Pool piece/ })).toHaveCount(9);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let i = 1; i <= 8; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: start.x + ((end.x - start.x) * i) / 8, y: start.y + ((end.y - start.y) * i) / 8 },
      ],
    });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(pool.getByRole("button", { name: /Pool piece/ })).toHaveCount(8);
  await expect(page.getByText("1 move", { exact: true })).toBeVisible();
});
