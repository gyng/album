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

      for (const { filename, size } of ICON_SPECS) {
        const metadata = await sharp(path.join(outputDirectory, filename)).metadata();
        expect(metadata).toMatchObject({ format: "png", width: size, height: size });
      }
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
