const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const RESIZED_IMAGE_DIR = ".resized_images";

const listPhotos = ({ albumsDir, includeTestAlbums }) => {
  if (!fs.existsSync(albumsDir)) {
    return [];
  }

  return fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => includeTestAlbums || !entry.name.startsWith("test-"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((album) => {
      const albumDir = path.join(albumsDir, album.name);
      return fs
        .readdirSync(albumDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .filter((entry) => PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          albumName: album.name,
          filename: entry.name,
          source: path.join(albumDir, entry.name),
        }));
    });
};

const isUsableCacheFile = (target) => {
  try {
    return fs.statSync(target).size > 0;
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

const runPool = async (items, jobs, work) => {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
};

const prepareOptimisedImages = async ({
  albumsDir = path.resolve(__dirname, "..", "..", "albums"),
  publicAlbumsDir = path.resolve(__dirname, "..", "public", "data", "albums"),
  jobs = 5,
  includeTestAlbums = process.env.ALBUM_INCLUDE_TEST_ALBUMS === "1",
} = {}) => {
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error(`Image preparation jobs must be a positive integer, received ${jobs}`);
  }

  const startedAt = Date.now();
  const photos = listPhotos({ albumsDir, includeTestAlbums });
  const summary = {
    photosDiscovered: photos.length,
    photosEncoded: 0,
    variantsEncoded: 0,
    variantsCached: 0,
    jobs,
    durationMs: 0,
  };

  await runPool(photos, jobs, async ({ albumName, filename, source }) => {
    const outputDir = path.join(publicAlbumsDir, albumName, RESIZED_IMAGE_DIR);
    const variants = imageOptimisationConfig.sizes.map((size) => ({
      size,
      output: path.join(outputDir, `${filename}@${size}.avif`),
    }));
    const missing = variants.filter(({ output }) => !isUsableCacheFile(output));

    summary.variantsCached += variants.length - missing.length;
    if (missing.length === 0) {
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const sourcePipeline = sharp(source).rotate();
    await Promise.all(
      missing.map(({ size, output }) =>
        sourcePipeline.clone().resize(size).avif(imageOptimisationConfig.avif).toFile(output),
      ),
    );
    summary.photosEncoded += 1;
    summary.variantsEncoded += missing.length;
  });

  summary.durationMs = Date.now() - startedAt;
  return summary;
};

module.exports = {
  prepareOptimisedImages,
};

/* istanbul ignore next -- direct CLI dispatch; preparation is tested through its exported API */
if (require.main === module) {
  const jobs = Number(process.env.ALBUM_IMAGE_JOBS ?? 5);
  prepareOptimisedImages({ jobs })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
