import { test } from "@playwright/test";
import path from "path";
import { siteConfig } from "../lib/siteConfig";

/**
 * Captures the README screenshot, loading four views of the deployed site.
 *
 * Automated:  npm run screenshot    (from src/)
 *
 * Output: ../screenshot.jpg (repo root)
 *
 * The page is built here rather than served from a file. It used to live at
 * `public/screenshot.html`, purely because that was the directory the config
 * served — which also published it, so the deployed site answered
 * /screenshot.html with four iframes of itself, and a fork served four iframes
 * of somebody else's photographs. Nothing about it was ever a site asset.
 */
const ORIGIN = siteConfig.site.origin;

/** The four views the README shows, left to right, top to bottom. */
const PANES = [
  { src: `${ORIGIN}/?theme=light`, scrolling: "no" },
  { src: `${ORIGIN}/album/2602japan?theme=dark#DSCF8612.JPG`, scrolling: "yes" },
  { src: `${ORIGIN}/search?q=japan&theme=dark&mode=keyword`, scrolling: "no" },
  { src: `${ORIGIN}/map?lat=1.36561&lon=103.779&zoom=10.36`, scrolling: "no" },
];

/** The photo whose details pane is opened, in the album pane above. */
const DETAILS_PHOTO_ID = "DSCF8612.JPG";

// Filenames make poor CSS identifiers — the dot in ".JPG" reads as a class.
// `CSS.escape` is a browser API and this runs in Node.
const escapeSelectorId = (id: string) => id.replace(/[^\w-]/g, (char) => `\\${char}`);

const buildPage = () => `<!doctype html>
<html>
  <head>
    <title>Screenshot for docs</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100vh; }
      body {
        box-sizing: border-box;
        background-color: rgb(51, 51, 51);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2vw;
        padding: 2vw;
      }
      iframe {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border: none;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
${PANES.map((pane) => `    <iframe scrolling="${pane.scrolling}" src="${pane.src}"></iframe>`).join("\n")}
  </body>
</html>`;

test("capture README screenshot", async ({ page }) => {
  // Fixed viewport so the screenshot dimensions stay consistent
  await page.setViewportSize({ width: 3840, height: 2160 });

  await page.setContent(buildPage(), { waitUntil: "domcontentloaded" });

  // Wait for every pane to finish loading
  const iframes = page.locator("iframe");
  for (let index = 0; index < PANES.length; index += 1) {
    const frame = iframes.nth(index);
    await frame.waitFor({ state: "visible" });
    await frame.contentFrame().locator("body").waitFor({ state: "visible" });
  }

  // Open the details pane in the album iframe (top-right, index 1)
  const albumFrame = iframes.nth(1).contentFrame();
  const photoAnchor = albumFrame.locator(`#${escapeSelectorId(DETAILS_PHOTO_ID)}`);
  await photoAnchor.waitFor({ state: "attached", timeout: 15000 });
  await photoAnchor.locator("details summary").click();
  await photoAnchor.scrollIntoViewIfNeeded();

  // Give content (map tiles, images, details map) a moment to render
  await page.waitForTimeout(5000);

  const out = path.resolve(__dirname, "../../screenshot.jpg");
  await page.screenshot({ path: out, type: "jpeg", quality: 85 });
  console.log(`Screenshot saved to ${out}`);
});
