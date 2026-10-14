import { expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gotoHydrated } from "./hydrated";

const stubVisionInference = async (page: Page) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let attempts = 0;
    window.Worker = class extends OriginalWorker {
      override postMessage(message: unknown, transfer: Transferable[]): void;
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = {},
      ) {
        const request = message as { type?: string; id?: number };
        if (request?.type === "warmup-image") {
          document.documentElement.dataset.visionWarmup = "true";
          queueMicrotask(() => {
            this.dispatchEvent(new MessageEvent("message", { data: { boot: true } }));
            this.dispatchEvent(new MessageEvent("message", { data: { id: request.id, ok: true } }));
          });
        } else if (request?.type === "encode-image") {
          attempts++;
          queueMicrotask(() => {
            this.dispatchEvent(new MessageEvent("message", { data: { boot: true } }));
            this.dispatchEvent(
              new MessageEvent("message", {
                data:
                  attempts === 1
                    ? { id: request.id, ok: false, error: "Temporary matcher failure" }
                    : { id: request.id, ok: true, vector: [1, 0, 0] },
              }),
            );
          });
        } else if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
};

test.use({ serviceWorkers: "block", hasTouch: true });
let directory: string;
let core: Buffer;
let embeddings: Buffer;

test.beforeAll(() => {
  // Extend isolated copies: the normal search fixtures and their result counts
  // remain unchanged. The added paths are real committed test-album photos.
  directory = mkdtempSync(path.join(tmpdir(), "gallery-fun-e2e-"));
  const corePath = path.join(directory, "core.sqlite");
  const vectorPath = path.join(directory, "vectors.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  copyFileSync("public/e2e-search-embeddings.sqlite", vectorPath);
  const db = new DatabaseSync(corePath);
  const vectorDb = new DatabaseSync(vectorPath);
  for (const [index, name] of ["DSCF0506-2.jpg", "DSCF0593.jpg"].entries()) {
    const photoPath = `../albums/test-manifest/${name}`;
    db.prepare(`INSERT INTO images (path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject)
      SELECT ?, ?, filename, geocode, exif, tags, colors, ?, subject FROM images WHERE filename = ?`).run(
      photoPath,
      `/album/test-manifest#${name}`,
      index ? "A person beside a tree on a city street." : "A boat crossing a river by a bridge.",
      name,
    );
    vectorDb
      .prepare(
        "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) VALUES (?, ?, 3, ?, ?)",
      )
      .run(
        photoPath,
        "google/siglip2-base-patch16-224",
        new Uint8Array([80, index ? 40 : 90, 0]),
        1 / 127,
      );
  }
  vectorDb.exec(`INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale)
    SELECT path, 'google/siglip-base-patch16-224', embedding_dim, embedding_blob, embedding_scale FROM embeddings WHERE model_id = 'google/siglip2-base-patch16-224'`);
  db.close();
  vectorDb.close();
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

test("Fun cards have illustrations and launch each game; old Guess Where challenges retain their query", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun?theme=darkroom");
  for (const title of [
    "Guess Where",
    "Photo Relay",
    "Blind Frame",
    "Photo Oracle",
    "Connect the Shots",
    "Double Take",
    "Cross Exposure",
    "Sight Lines",
    "Photo Hangman",
  ]) {
    const card = page.getByRole("link", { name: new RegExp(`${title}.*Play`) });
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const source = await card.locator("svg image").getAttribute("href");
    expect(source).toBeTruthy();
    const width = await page.evaluate(
      (src) =>
        new Promise<number>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth);
          image.onerror = () => reject(new Error("Game illustration failed to load"));
          image.src = src!;
        }),
      source,
    );
    expect(width).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await gotoHydrated(page, "/guess?seed=fun-challenge&rounds=1&timer=15");
  await expect(page).toHaveURL(/\/fun\/guess\?seed=fun-challenge&rounds=1&timer=15/);
  await expect(
    page.getByRole("navigation", { name: "Fun games" }).getByRole("link", { name: "Guess Where" }),
  ).toHaveAttribute("aria-current", "page");
});

test("Photo Relay supports giving up and completing a new chain on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/relay");
  await page.getByRole("button", { name: "Start relay" }).click();
  await expect(page.getByRole("link", { name: "Fun!", exact: true })).toBeInViewport({
    ratio: 0.98,
  });
  await page.getByRole("button", { name: "Give up" }).click();
  const result = page.getByRole("region", { name: "Relay result" });
  await expect(result.getByRole("link")).toHaveCount(7);
  await page.getByRole("button", { name: "Play again" }).click();
  await page.getByRole("button", { name: /Photograph 1$/ }).focus();
  for (let i = 1; i <= 5; i++) {
    const choice = page.getByRole("button", { name: new RegExp(`Photograph ${i}$`) });
    await expect(choice).toBeFocused();
    await choice.press("Enter");
  }
  await expect(page.getByRole("button", { name: "Finish relay" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish relay" })).toBeFocused();
  await page.getByRole("button", { name: "Finish relay" }).press("Enter");
  await expect(result).toBeVisible();
  await expect(result.getByText(/Visual flow: \d+ \/ 100/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Blind Frame reuses the drawing canvas and reveals the sketch, target and nearest match", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Model inference is the external boundary. Exercise the real canvas,
  // worker-client protocol, compatible database vectors and reveal UI without
  // downloading a vision model in a deterministic browser test.
  await stubVisionInference(page);
  await gotoHydrated(page, "/fun/blind-frame");
  await expect(
    page.getByRole("navigation", { name: "Fun games" }).getByRole("link", { name: "Blind Frame" }),
  ).toBeInViewport({ ratio: 0.98 });
  await page.getByRole("button", { name: "Start Blind Frame" }).click();
  await expect(page.locator("main img")).toHaveCount(0);
  await page.getByRole("button", { name: "Draw this scene" }).click();
  const dialog = page.getByRole("dialog", { name: "Blind Frame sketch" });
  const box = await dialog.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  await dialog.getByRole("button", { name: "Brush colour #ffffff" }).click();
  await page.touchscreen.tap(box!.x + 30, box!.y + 30);
  await dialog.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Brush colour #1a1a1a" }).click();
  await page.mouse.move(box!.x + 40, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 140, box!.y + 140, { steps: 8 });
  await page.mouse.up();
  const ink = () =>
    dialog.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let pixels = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) pixels++;
      return pixels;
    });
  const originalInk = await ink();
  expect(originalInk).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await ink()).toBe(0);
  await dialog.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await ink()).toBe(originalInk);
  await dialog.getByRole("button", { name: "Close sketch" }).click();
  await page.getByRole("button", { name: "Draw this scene" }).click();
  await expect(dialog.getByRole("button", { name: "Reveal", exact: true })).toBeEnabled();
  expect(await ink()).toBe(originalInk);
  await dialog.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Retry this sketch" }).click();
  const result = page.getByRole("region", { name: "Blind Frame result" });
  await expect(result).toBeVisible();
  await expect(result.locator("figure img")).toHaveCount(3);
  await expect(result.getByRole("heading", { name: "More like the original" })).toBeVisible();
  await expect(result.getByRole("figure", { name: "The original photograph" })).toBeVisible();
  await expect(result.getByText(/\d+ \/ 100/)).toBeVisible();
});

test("Photo Oracle hides the remembered photo during questions and reveals it on giving up", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/oracle");
  await expect(
    page.getByRole("navigation", { name: "Fun games" }).getByRole("link", { name: "Photo Oracle" }),
  ).toBeInViewport({ ratio: 0.98 });
  await page.getByRole("button", { name: "Meet the oracle" }).click();
  await page.getByRole("button", { name: /Photograph 1$/ }).click();
  const remembered = await page.locator("main img").getAttribute("src");
  await page.getByRole("button", { name: "I have my photograph" }).click();
  await expect(page.locator("main img")).toHaveCount(0);
  const question = await page.getByRole("status").innerText();
  await page.getByRole("button", { name: "Not sure" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(question);
  await page.getByRole("button", { name: "Give up" }).click();
  await expect(
    page.getByRole("region", { name: "Oracle result" }).getByRole("img"),
  ).toHaveAttribute("src", remembered!);
});

test("Blind Frame opens a desktop canvas and warms the model only when drawing starts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubVisionInference(page);
  await gotoHydrated(page, "/fun/blind-frame");
  await page.getByRole("button", { name: "Start Blind Frame" }).click();
  const pad = page.getByRole("region", { name: "Blind Frame sketch" });
  const canvas = pad.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Draw this scene" })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-vision-warmup", "true");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("html")).toHaveAttribute("data-vision-warmup", "true");
  const ink = () =>
    canvas.evaluate(
      (canvas: HTMLCanvasElement) =>
        Array.from(canvas.getContext("2d")!.getImageData(0, 0, 448, 448).data).filter(
          (value, index) => index % 4 !== 3 && value < 250,
        ).length,
    );
  const before = await ink();
  expect(before).toBeGreaterThan(0);
  await canvas.press("ControlOrMeta+z");
  expect(await ink()).toBe(0);
  await canvas.press("ControlOrMeta+Shift+z");
  expect(await ink()).toBe(before);
});

test("relay accepts a native drag into a link slot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHydrated(page, "/fun/relay");
  await page.getByRole("button", { name: "Start relay" }).click();
  const source = page.getByRole("button", { name: /Photograph 1$/ });
  const slots = page.getByRole("list", { name: "Your relay links" }).getByRole("listitem");
  await source.dragTo(slots.first());
  await expect(page.getByRole("status")).toContainText("1 of 5");
  // A placed photograph's name ends with its link number instead.
  await expect(page.getByRole("button", { name: /Link 1$/ })).toBeDisabled();
  await page.getByRole("button", { name: /Photograph 2$/ }).click();
  const firstSrc = await slots.first().locator("img").getAttribute("src");
  await slots.first().locator("[draggable]").dragTo(slots.nth(1));
  await expect(slots.nth(1).locator("img")).toHaveAttribute("src", firstSrc!);
});

test("Relay keeps its current chain in view while choosing and returns to editable links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/relay");
  await page.getByRole("button", { name: "Start relay" }).click();
  await page.getByRole("button", { name: /Photograph 1$/ }).click();
  const finalChoice = page.getByRole("button", { name: /Photograph 5$/ });
  await finalChoice.scrollIntoViewIfNeeded();
  const reference = page.getByRole("group", { name: "Relay reference" });
  await expect(reference).toBeInViewport({ ratio: 1 });
  await finalChoice.click();
  await expect(reference.getByText(/2\s*\/\s*5 links/)).toBeVisible();
  await reference.getByRole("button", { name: "Edit links" }).click();
  await expect(page.getByRole("button", { name: "Remove link 1" })).toBeInViewport();
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await expect(reference).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`photo game lobbies keep their layout while data loads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [game, startName] of [
      ["connections", "Start connecting"],
      ["cross-exposure", "Start crossing"],
    ] as const) {
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await page.route(/\/(?:e2e-)?search\.sqlite(?:\?.*)?$/, async (route) => {
        await gate;
        await route.fallback();
      });
      try {
        await gotoHydrated(page, `/fun/${game}`);
        const start = page.getByRole("button", { name: startName, exact: true });
        await expect(start).toBeDisabled();
        const art = page.locator("svg").filter({ has: page.locator('image[href^="/fun/"]') });
        const before = { art: await art.boundingBox(), start: await start.boundingBox() };
        await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
        release();
        await expect(start).toBeEnabled();
        const after = { art: await art.boundingBox(), start: await start.boundingBox() };
        for (const element of ["art", "start"] as const)
          for (const dimension of ["x", "y", "width", "height"] as const)
            expect(
              Math.abs(before[element]![dimension] - after[element]![dimension]),
            ).toBeLessThanOrEqual(1);
        await expect(start.locator("kbd")).toHaveText("N");
      } finally {
        release();
      }
    }
  });
}
