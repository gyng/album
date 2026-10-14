import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildPhotoHangman } from "../util/photoHangman";
import type { PhotoGamePhoto } from "../util/photoGames";
import { gotoHydrated } from "./hydrated";

test.use({ serviceWorkers: "block", hasTouch: true });
let directory: string;
let core: Buffer;
const image = readFileSync("../albums/test-simple/DSCF0506-2.jpg");
const photos: PhotoGamePhoto[] = [
  "cat",
  "dog",
  "train",
  "bridge",
  "window",
  "chair",
  "bicycle",
  "boat",
].flatMap((subject, group) =>
  Array.from({ length: 8 }, (_, i) => ({
    path: `../albums/test-simple/hangman-${group * 8 + i}.jpg`,
    href: `/album/test-simple#hangman-${group * 8 + i}.jpg`,
    caption: `A ${subject}.`,
    tags: subject,
    vector: [],
  })),
);
const puzzle = buildPhotoHangman(photos, () => 0.37)!;

test.beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "photo-hangman-e2e-"));
  const corePath = path.join(directory, "core.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  const db = new DatabaseSync(corePath);
  db.exec("DELETE FROM images; DELETE FROM metadata;");
  for (const photo of photos)
    db.prepare(
      "INSERT INTO images (path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject) VALUES (?, ?, ?, '', '', ?, '', ?, '')",
    ).run(photo.path, photo.href, photo.path.split("/").at(-1)!, photo.tags, photo.caption);
  db.close();
  core = readFileSync(corePath);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.37;
  });
  await page.route(/\/(?:e2e-)?search\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({ body: core, contentType: "application/octet-stream" }),
  );
  // The metadata is synthetic; the image boundary serves a committed fixture photograph.
  await page.route(/hangman-\d+\.jpg/, (route) =>
    route.fulfill({ body: image, contentType: "image/jpeg" }),
  );
});
for (const width of [320, 1280]) {
  test(`Photo Hangman filters a subject bank without guessing and reveals a correct answer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await gotoHydrated(page, "/fun/photo-hangman");
    await page.getByRole("button", { name: "Start guessing" }).click();
    const bank = page.getByRole("group", { name: "Subject choices" });
    await expect(bank.getByRole("button")).toHaveCount(puzzle.subjects.length);
    const filter = page.getByRole("searchbox", { name: "Filter subjects" });
    await filter.fill("not-a-subject");
    await expect(page.getByText("No matching subjects.")).toBeVisible();
    await expect(page.getByText("6 misses left")).toBeVisible();
    await filter.fill(puzzle.answer.toLowerCase());
    const answer = bank.getByRole("button", { name: `Guess ${puzzle.answer.toLowerCase()}` });
    await expect(answer).toBeEnabled();
    await expect(page.getByRole("img", { name: "Photographic clue 1" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Photographic clue 2" })).toBeVisible();
    await answer.click();
    const result = page.getByRole("region", { name: "Photo Hangman result" });
    await expect(result).toBeFocused();
    await expect(result.getByRole("link").filter({ has: page.getByRole("img") })).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
test("each wrong subject reveals a photo, previous clues remain available, and six misses finish the round", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/fun/photo-hangman");
  await page.getByRole("button", { name: "Start guessing" }).click();
  const wrong = puzzle.subjects
    .filter((subject) => !puzzle.acceptedAnswers.includes(subject))
    .slice(0, 6);
  for (const [index, subject] of wrong.entries()) {
    const choice = page.getByRole("button", { name: `Guess ${subject.toLowerCase()}` });
    await expect(choice).toBeEnabled();
    await choice.click();
    if (index < 5) {
      await expect(page.getByRole("img", { name: `Photographic clue ${index + 3}` })).toBeVisible();
      await expect(choice).toBeDisabled();
    }
  }
  const result = page.getByRole("region", { name: "Photo Hangman result" });
  await expect(result).toBeFocused();
  await expect(result.getByRole("link").filter({ has: page.getByRole("img") })).toHaveCount(8);
  await page.getByRole("button", { name: "View clue 1" }).click();
  await expect(
    page.getByRole("figure", { name: "Current photographic clue" }).getByRole("img"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("6 misses left")).toBeVisible();
  await expect(result).toHaveCount(0);
});
