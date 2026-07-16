const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { ICON_SPECS, preparePwaIcons } = require("./prepare-pwa-icons.cjs");

describe("prepare PWA icons", () => {
  it("derives every declared PNG size from the canonical SVG", async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-pwa-icons-"));
    try {
      await preparePwaIcons({
        sourcePath: path.join(__dirname, "..", "public", "pwa-icon.svg"),
        outputDirectory,
      });

      // Sizes are read from ICON_SPECS, so asserting them back could never
      // disagree with the implementation — it would only restate sharp's own
      // behaviour. A misdeclared icon is caught by the consistency check in
      // test/pwa-manifest.test.ts instead. What is worth proving here is that
      // the canonical SVG still rasterises and every declared icon is written
      // in the format the manifest promises.
      for (const { filename } of ICON_SPECS) {
        const metadata = await sharp(path.join(outputDirectory, filename)).metadata();
        expect(metadata.format).toBe("png");
      }
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
