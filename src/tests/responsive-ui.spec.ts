import { expect, test, type Page } from "@playwright/test";

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.locator("html").evaluate((root) => ({
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const doubleRenderedTextSize = async (page: Page) => {
  await page.locator("body").evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("*")];
    const fontSizes = elements.map((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );

    elements.forEach((element, index) => {
      element.style.fontSize = `${fontSizes[index] * 2}px`;
    });
  });
};

test.describe("Responsive UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("home navigation aligns with the page content on a cold load", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const albums = page.getByRole("link", { name: "Albums", exact: true });
    const heading = page.getByRole("heading", { name: "Snapshots", exact: true });
    const [albumsBox, headingBox] = await Promise.all([
      albums.boundingBox(),
      heading.boundingBox(),
    ]);

    expect(albumsBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(albumsBox!.x).toBeCloseTo(headingBox!.x, 0);
  });

  test("timeline keeps its heatmap inside the mobile viewport", async ({ page }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await expectNoDocumentOverflow(page);

    const cell = page.locator("button[data-date]").first();
    await expect(cell).toBeVisible();
    const box = await cell.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(22);
    expect(box?.height).toBeGreaterThanOrEqual(22);
  });

  test("design catalogue contains wide token previews locally", async ({ page }) => {
    await page.goto("/design", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Design", exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
  });

  test("explore timeline tooltips stay inside the mobile viewport", async ({ page }) => {
    await page.goto("/explore", { waitUntil: "load" });

    await page.locator('nav[aria-label="Jump to section"] a[href="#colour"]').click();

    const segment = page.locator('a[title*=" around "]').last();
    await expect(segment).toBeVisible();
    await expectNoDocumentOverflow(page);
    await segment.focus();

    const tooltip = segment.locator('span[aria-hidden="true"]').first();
    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expectNoDocumentOverflow(page);
  });

  test("explore filters reflow at the narrowest supported viewport", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 320, height: 568 },
    });
    const mobilePage = await context.newPage();

    try {
      await mobilePage.goto("/explore", { waitUntil: "domcontentloaded" });
      await expect(mobilePage.getByRole("heading", { name: "How you shoot" })).toBeVisible();
      await expectNoDocumentOverflow(mobilePage);
    } finally {
      await context.close();
    }
  });

  test("timeline date cells retain a focus indicator in forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    const cell = page.locator('button[data-date]:not([aria-disabled="true"])').first();
    await cell.focus();
    await expect(cell).toBeFocused();
    await expect
      .poll(() =>
        cell.evaluate((element) => {
          const style = getComputedStyle(element);
          return `${style.outlineStyle} ${style.outlineWidth}`;
        }),
      )
      .toMatch(/^solid (?!0px)/);
  });

  test("timeline day controls reflow at 200% text size", async ({ page }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });
    await doubleRenderedTextSize(page);

    await expect(page.getByRole("button", { name: "Newer" })).toBeInViewport();
    await expectNoDocumentOverflow(page);
  });

  test("album detail disclosures have comfortable touch targets", async ({ page }) => {
    await page.goto("/album/test-simple", { waitUntil: "domcontentloaded" });

    const photo = page.getByTestId("photoblockel").first();
    const image = photo.getByRole("img");
    const summary = photo.getByLabel("Photo details");
    await expect(summary).toBeVisible();
    const [imageBox, summaryBox] = await Promise.all([image.boundingBox(), summary.boundingBox()]);
    expect(imageBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(summaryBox!.width).toBeGreaterThanOrEqual(44);
    expect(summaryBox!.height).toBeGreaterThanOrEqual(44);

    const rightEdgeOffset = imageBox!.x + imageBox!.width - (summaryBox!.x + summaryBox!.width);
    expect(rightEdgeOffset).toBeGreaterThanOrEqual(0);
    expect(rightEdgeOffset).toBeLessThanOrEqual(24);
  });

  test("guess lobby explains the daily challenge without mobile overflow", async ({ page }) => {
    await page.goto("/guess", { waitUntil: "domcontentloaded" });

    const description = page.getByText("Five rounds · same photos for everyone today");
    await expect(description).toBeVisible();
    const descriptionId = await description.getAttribute("id");
    expect(descriptionId).not.toBeNull();
    await expect(page.getByRole("button", { name: "Daily challenge" })).toHaveAttribute(
      "aria-describedby",
      descriptionId!,
    );
    await expectNoDocumentOverflow(page);
  });
});
