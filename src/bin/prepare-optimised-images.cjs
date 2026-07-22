const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");

// Mirrors video.ts's own VIDEO_EXTENSIONS list. Duplicated (not imported)
// because this is a plain Node CJS script with no TypeScript loader — same
// reasoning cleanup-optimised-media.cjs already documents for its copy.
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const RESIZED_IMAGE_DIR = ".resized_images";
const TEMP_FILE_SEPARATOR = ".tmp-";

// album.ts's listAlbumMediaFiles + getAlbumWithoutManifest treat every
// non-JSON, non-video file in an album directory as a photo passed to
// photo.ts's optimiseImages() — there is no image-extension allowlist
// upstream. Match that here by exclusion rather than a fixed allowlist so
// this warm-cache pass stays in parity with what the real build will encode.
const isPhotoFile = (filename) => {
  if (/\.json$/i.test(filename)) {
    return false;
  }
  return !VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
};

// withFileTypes() reports isDirectory()/isFile() as false for symlinks, so a
// symlinked album or a symlinked photo would silently vanish from this list
// while cleanup-optimised-media.cjs (which stats via fs.statSync, following
// symlinks) still tracks its cache. Resolve the link so both scripts agree.
const isDirectoryEntry = (dir, entry) => {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return fs.statSync(path.join(dir, entry.name)).isDirectory();
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

const isFileEntry = (dir, entry) => {
  if (entry.isFile()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return fs.statSync(path.join(dir, entry.name)).isFile();
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

const listPhotos = ({ albumsDir, includeTestAlbums }) => {
  if (!fs.existsSync(albumsDir)) {
    return [];
  }

  return fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => isDirectoryEntry(albumsDir, entry))
    .filter((entry) => includeTestAlbums || !entry.name.startsWith("test-"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((album) => {
      const albumDir = path.join(albumsDir, album.name);
      return fs
        .readdirSync(albumDir, { withFileTypes: true })
        .filter((entry) => isFileEntry(albumDir, entry))
        .filter((entry) => isPhotoFile(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          albumName: album.name,
          filename: entry.name,
          source: path.join(albumDir, entry.name),
        }));
    });
};

// Encode-then-rename (see encodeVariant) means an interrupted encode can no
// longer leave a truncated file at the final path going forward, but a
// pre-existing cache directory (from before this fix, or damaged by
// something outside this script) can still contain a non-empty-but-truncated
// AVIF. A byte-count check alone can't tell that apart from a genuine cache
// hit, so — mirroring photo.ts's own cache-hit check — decode it and confirm
// it reports real dimensions before trusting it.
const isUsableCacheFile = async (target) => {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
  if (stat.size === 0) {
    return false;
  }

  try {
    const metadata = await sharp(target).metadata();
    return Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
};

// A process that died mid-encode (crash, OOM-kill, `process.exit`) can leave
// behind a "<output>.tmp-<pid>" file from a previous run. It's never read as
// a cache hit (isUsableCacheFile only looks at the exact output path), but it
// is silent disk litter — clear out any stray temp siblings for the variants
// we're about to (re)encode.
const cleanupStrayTempFiles = (output) => {
  const dir = path.dirname(output);
  const prefix = `${path.basename(output)}${TEMP_FILE_SEPARATOR}`;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    try {
      fs.unlinkSync(path.join(dir, entry));
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }
};

const encodeVariant = (sourcePipeline, { size, output }) => {
  cleanupStrayTempFiles(output);
  const tempOutput = `${output}${TEMP_FILE_SEPARATOR}${process.pid}`;

  return sourcePipeline
    .clone()
    .resize(size)
    .withIccProfile(imageOptimisationConfig.iccProfile)
    .avif(imageOptimisationConfig.avif)
    .toFile(tempOutput)
    .then(() => {
      // Encode-then-rename makes the write atomic: readers (including a
      // concurrent build) either see no file at `output` or a complete one,
      // never a truncated one left by an interrupted encode.
      fs.renameSync(tempOutput, output);
    })
    .catch((err) => {
      try {
        fs.unlinkSync(tempOutput);
      } catch {
        // best-effort cleanup of the partial temp file; ignore if already gone
      }
      throw err;
    });
};

// Runs `work` over `items` with up to `jobs` items in flight at once. On
// error, workers stop picking up new items but any already-started item is
// allowed to finish (drain) before the pool rejects — the CLI entry point's
// `process.exit(1)` must never fire while another worker is still mid-write,
// or it truncates an unrelated file.
const runPool = async (items, jobs, work) => {
  let nextIndex = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (nextIndex < items.length && !firstError) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await work(item);
      } catch (err) {
        if (!firstError) {
          firstError = err;
        }
        return;
      }
    }
  });
  await Promise.allSettled(workers);
  if (firstError) {
    throw firstError;
  }
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
    const usable = await Promise.all(variants.map(({ output }) => isUsableCacheFile(output)));
    const missing = variants.filter((_, index) => !usable[index]);

    summary.variantsCached += variants.length - missing.length;
    if (missing.length === 0) {
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const sourcePipeline = sharp(source).rotate();
    await Promise.all(missing.map((variant) => encodeVariant(sourcePipeline, variant)));
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
