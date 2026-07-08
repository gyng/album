import { test, expect, Page } from "@playwright/test";
import { existsSync, statSync } from "fs";
import { join } from "path";

const searchDbPath = join(__dirname, "..", "public", "search.sqlite");
const hasSearchDb =
  existsSync(searchDbPath) && statSync(searchDbPath).size > 0;

const testImagePath = join(
  __dirname,
  "..",
  "..",
  "albums",
  "test-simple",
  "DSCF0506-2.jpg",
);

// Hold every embedding-model request open forever: the specs assert the UI
// shell (buttons, dialog, chip, pending state), never a completed encode, so
// CI must not download models from Hugging Face — and a request that never
// resolves keeps the "Searching…" state deterministic.
const holdModelDownloads = async (page: Page) => {
  await page.route(
    (url) => /huggingface\.co|hf\.co|jsdelivr\.net/.test(url.href),
    () => {
      /* never fulfilled */
    },
  );
};

test.describe("Image search UI shell", () => {
  let pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("draw pad opens focused, closes on Escape, and restores focus", async ({
    page,
  }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");
    await holdModelDownloads(page);
    await page.goto("/search");

    const drawButton = page.getByRole("button", { name: /draw to search/i });
    // Enabled once the WASM DB has loaded.
    await expect(drawButton).toBeEnabled({ timeout: 15_000 });
    await drawButton.click();

    const dialog = page.getByRole("dialog", { name: "Draw to search" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(drawButton).toBeFocused();
  });

  test("drawing enables Search and submits to a removable query chip", async ({
    page,
  }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");
    await holdModelDownloads(page);
    await page.goto("/search");

    const drawButton = page.getByRole("button", { name: /draw to search/i });
    await expect(drawButton).toBeEnabled({ timeout: 15_000 });
    await drawButton.click();

    const dialog = page.getByRole("dialog", { name: "Draw to search" });
    const searchButton = dialog.getByRole("button", {
      name: "Search",
      exact: true,
    });
    await expect(searchButton).toBeDisabled();

    const canvasBox = await dialog.locator("canvas").boundingBox();
    expect(canvasBox).not.toBeNull();
    if (!canvasBox) {
      return;
    }
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.3,
      canvasBox.y + canvasBox.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.7,
      canvasBox.y + canvasBox.height * 0.5,
      { steps: 5 },
    );
    await page.mouse.up();

    await expect(searchButton).toBeEnabled();
    await searchButton.click();
    await expect(dialog).not.toBeVisible();

    // The chip appears immediately; the grid shows a pending state while the
    // (held) model download keeps the encode in flight.
    const chip = page.getByRole("button", { name: "Remove image query" });
    await expect(chip).toBeVisible();
    await expect(page.getByText("Drawn sketch")).toBeVisible();
    await expect(page.getByText("Searching…")).toBeVisible();

    await chip.click();
    await expect(chip).not.toBeVisible();
    // Clearing the query returns to the browse-mode explore sections.
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();
  });

  test("uploading a photo starts an image query", async ({ page }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");
    await holdModelDownloads(page);
    await page.goto("/search");

    const uploadButton = page.getByRole("button", {
      name: /search by image/i,
    });
    await expect(uploadButton).toBeEnabled({ timeout: 15_000 });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    await expect(
      page.getByRole("button", { name: "Remove image query" }),
    ).toBeVisible();
    await expect(page.getByText("Uploaded image")).toBeVisible();
    await expect(page.getByText("Searching…")).toBeVisible();
  });
});
