// Packs every photograph into one contact sheet for the explore page's cloud.
//
// Run before the build, like the other prepasses: the payload that positions
// the cloud carries each photograph's slot on this sheet, so the sheet has to
// exist first.
//
// It reads the *already optimised* variants rather than the originals — the
// smallest one this site publishes — so this is a resize of an 800px image and
// not a decode of a 40-megapixel raw.

const fs = require("node:fs");
const path = require("node:path");
const { atlasManifest, planAtlas } = require("./embeddingAtlas.cjs");
const { siteConfig } = require("./siteConfig.cjs");

const RESIZED_DIR = ".resized_images";
/** Where `prepare-optimised-images.cjs` writes its variants. */
const PUBLIC_ALBUMS_DIR = path.join(__dirname, "..", "public", "data", "albums");
const SOURCE_SUFFIX = "@800.avif";
const OUTPUT_DIR = path.join(__dirname, "..", "public", "data");
const OUTPUT_PREFIX = "embedding-atlas";

/**
 * The photographs on disk, keyed the way the search database keys them.
 *
 * The variants live under `public/data/albums`, but the key is built with
 * `paths.albumsDir` — the same data-format constant the database uses — so the
 * key here is the key the payload joins on.
 */
/* istanbul ignore next -- disk; the layout is what is tested */
const findOptimisedPhotos = (albumsDir) => {
  if (!fs.existsSync(albumsDir)) return [];

  return fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((album) => {
      const resized = path.join(albumsDir, album.name, RESIZED_DIR);
      if (!fs.existsSync(resized)) return [];

      return fs
        .readdirSync(resized)
        .filter((file) => file.endsWith(SOURCE_SUFFIX))
        .map((file) => ({
          path: `${siteConfig.paths.albumsDir}/${album.name}/${file.slice(0, -SOURCE_SUFFIX.length)}`,
          file: path.join(resized, file),
        }));
    });
};

/* istanbul ignore next -- disk and an encoder */
const run = async (log = console.log) => {
  const sharp = require("sharp");
  const photos = findOptimisedPhotos(PUBLIC_ALBUMS_DIR);

  if (photos.length === 0) {
    log("No optimised photographs; skipping the embedding atlas.");
    return null;
  }

  const plan = planAtlas(photos.map((photo) => photo.path));
  const byPath = new Map(photos.map((photo) => [photo.path, photo.file]));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = [];
  for (let sheet = 0; sheet < plan.sheets; sheet += 1) {
    const cells = plan.placements.filter((placement) => placement.sheet === sheet);

    const composites = [];
    for (const placement of cells) {
      const source = byPath.get(placement.path);
      try {
        composites.push({
          input: await sharp(source)
            .resize(plan.cell, plan.cell, { fit: "cover", position: "attention" })
            .toBuffer(),
          left: placement.x,
          top: placement.y,
        });
      } catch (error) {
        // One unreadable variant is a missing cell, not a failed build.
        log(`Skipping ${placement.path} in the atlas: ${error.message}`);
      }
    }

    const name = `${OUTPUT_PREFIX}-${sheet}.avif`;
    await sharp({
      create: {
        width: plan.sheet,
        height: plan.sheet,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .avif({ quality: 55, effort: 4 })
      .toFile(path.join(OUTPUT_DIR, name));

    files.push(`/data/${name}`);
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${OUTPUT_PREFIX}.json`),
    `${JSON.stringify(atlasManifest(plan, files))}\n`,
  );

  const bytes = files.reduce(
    (total, file) => total + fs.statSync(path.join(OUTPUT_DIR, path.basename(file))).size,
    0,
  );
  log(
    `Wrote ${photos.length} photographs into ${files.length} atlas sheet(s), ${Math.round(bytes / 1024)}KB`,
  );

  return { plan, files };
};

module.exports = { findOptimisedPhotos, run };

/* istanbul ignore next -- direct CLI dispatch */
if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
