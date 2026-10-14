import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gotoHydrated } from "./hydrated";

test.use({ serviceWorkers: "block" });
let directory: string;
let core: Buffer;
const image = readFileSync("../albums/test-simple/DSCF0506-2.jpg");

// Twelve synthetic photographs, one a year: the caption names the year, so the
// test can read the right order from each photograph's accessible name.
test.beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "hindsight-e2e-"));
  const corePath = path.join(directory, "core.sqlite");
  copyFileSync("public/e2e-search.sqlite", corePath);
  const db = new DatabaseSync(corePath);
  db.exec("DELETE FROM images; DELETE FROM metadata;");
  for (let index = 0; index < 12; index++) {
    const filename = `hindsight-${index}.jpg`;
    const photoPath = `../albums/test-simple/${filename}`;
    db.prepare(
      "INSERT INTO images (path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject) VALUES (?, ?, ?, '', '', '', '', ?, '')",
    ).run(photoPath, `/album/test-simple#${filename}`, filename, `Year ${2010 + index}`);
    db.prepare("INSERT INTO metadata (path, iso8601) VALUES (?, ?)").run(
      photoPath,
      `${2010 + index}-0${1 + (index % 9)}-14T09:30:00`,
    );
  }
  db.close();
  core = readFileSync(corePath);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));
test.beforeEach(async ({ page }) => {
  await page.route(/\/(?:e2e-)?search\.sqlite(?:\?.*)?$/, (route) =>
    route.fulfill({ body: core, contentType: "application/octet-stream" }),
  );
  // The metadata is synthetic; the image boundary serves a committed fixture photograph.
  await page.route(/hindsight-\d+\.jpg/, (route) =>
    route.fulfill({ body: image, contentType: "image/jpeg" }),
  );
});

test("Hindsight orders photographs with the keyboard and reveals when each was taken", async ({
  page,
}) => {
  await gotoHydrated(page, "/fun/hindsight");
  const startButton = page.getByRole("button", { name: /Start Hindsight/ });
  await expect(startButton).toBeEnabled();
  await startButton.focus();
  await page.keyboard.press("Enter");

  const tray = page.getByRole("button", { name: /^Year \d{4} Photograph \d$/ });
  await expect(tray).toHaveCount(5);
  // The accessible name joins the image's alt text to the label.
  const byYear = (
    await Promise.all(
      (await tray.all()).map(async (button) => {
        const alt = await button.locator("img").getAttribute("alt");
        return { year: Number(/Year (\d{4})/.exec(alt ?? "")![1]), alt: alt! };
      }),
    )
  ).sort((a, b) => a.year - b.year);

  // Place the second oldest first, then the rest oldest to newest.
  const sequence = [byYear[1]!, byYear[0]!, ...byYear.slice(2)];
  for (const { alt } of sequence) {
    await page.getByRole("button", { name: new RegExp(`^${alt} Photograph \\d$`) }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("status").filter({ hasText: "placed" })).toHaveText("5 of 5 placed");
  await expect(page.getByRole("button", { name: /Check order/ })).toBeFocused();

  // Moving the oldest earlier keeps focus on it; at the front, the opposite move takes focus.
  await page.getByRole("button", { name: "Move photograph 2 earlier" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Move photograph 1 later" })).toBeFocused();

  await page.getByRole("button", { name: /Check order/ }).focus();
  await page.keyboard.press("Enter");
  const result = page.getByRole("region", { name: "Hindsight result" });
  await expect(result).toBeFocused();
  await expect(result.getByText("In order: 100 / 100")).toBeVisible();
  const taken = result.getByRole("list", { name: "Order taken" });
  await expect(taken.getByRole("link")).toHaveCount(5);
  await expect(taken.getByRole("link").first()).toHaveAttribute(
    "href",
    /\/album\/test-simple#hindsight-\d+\.jpg/,
  );
  await expect(taken.getByText(/14 \w+ \d{4} at 09:30/)).toHaveCount(5);
});
