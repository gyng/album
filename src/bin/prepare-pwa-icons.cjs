const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ICON_SPECS = [
  { filename: "pwa-icon-192.png", size: 192 },
  { filename: "pwa-icon-512.png", size: 512 },
  { filename: "apple-touch-icon.png", size: 180 },
];

const preparePwaIcons = async ({
  sourcePath = path.join(__dirname, "..", "public", "pwa-icon.svg"),
  outputDirectory = path.join(__dirname, "..", "public"),
} = {}) => {
  const source = fs.readFileSync(sourcePath);
  fs.mkdirSync(outputDirectory, { recursive: true });

  await Promise.all(
    ICON_SPECS.map(async ({ filename, size }) => {
      const outputPath = path.join(outputDirectory, filename);
      const output = await sharp(source).resize(size, size).png().toBuffer();
      if (!fs.existsSync(outputPath) || !fs.readFileSync(outputPath).equals(output)) {
        fs.writeFileSync(outputPath, output);
      }
    }),
  );
};

if (require.main === module) {
  preparePwaIcons().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { ICON_SPECS, preparePwaIcons };
