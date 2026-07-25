const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");

const RESIZED_IMAGE_DIR = ".resized_images";
const TEMP_FILE_SEPARATOR = ".tmp-";
// A stray "<output>.tmp-<pid>" temp file older than this is assumed to be
// left behind by a process that died mid-encode. Anything younger might
// belong to a concurrent encoder (e.g. the dev server's photo.ts) that is
// still writing it — deleting that out from under it makes its renameSync
// throw ENOENT.
const STALE_TEMP_FILE_THRESHOLD_MS = 15 * 60 * 1000;
// Monotonic per-process counter appended to every temp file name so that two
// concurrent encode attempts for the SAME output within this process (this
// script racing photo.ts's own optimiseImages(), or two overlapping variants
// for the same file) never share a temp path — see nextTempFileSuffix below.
let tempFileCounter = 0;
const nextTempFileSuffix = () => `${TEMP_FILE_SEPARATOR}${process.pid}-${++tempFileCounter}`;

// album.ts's listAlbumMediaFiles + getAlbumWithoutManifest treat every
// non-JSON, non-video file in an album directory as a photo passed to
// photo.ts's optimiseImages() — there is no image-extension allowlist
// upstream, so a RAW file (e.g. the committed `DSCF2770.RAF` fixture) or any
// other sharp-undecodable format reaches the real build's encoder too. This
// warm-cache pass only pre-populates the AVIF cache as an optimisation, so it
// allowlists the extensions sharp actually decodes and the build serves —
// case-insensitively, which also excludes WSL2 `:Zone.Identifier` sidecars,
// odd-case `.JSON`, and RAW/undecodable formats outright rather than relying
// on a per-file encode failure to skip them.
const PHOTO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".tif",
  ".tiff",
]);

const isPhotoFile = (filename) => {
  return PHOTO_EXTENSIONS.has(path.extname(filename).toLowerCase());
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
// behind a "<output>.tmp-<pid>-<n>" file from a previous run. It's never read
// as a cache hit (isUsableCacheFile only looks at the exact output path), but
// it is silent disk litter — clear out any stray temp siblings for the
// variants we're about to (re)encode.
//
// Every entry matching the prefix is only ever removed once it's stale,
// regardless of which pid created it: a fresh temp file — including one
// created by this same process for a still-in-flight sibling encode (this
// script racing photo.ts's own optimiseImages() for the same output, or two
// overlapping variants) — may still be mid-write, and deleting it out from
// under that writer makes its renameSync throw ENOENT. There used to be an
// "own pid" fast path that deleted our own process's temp files
// unconditionally, on the assumption that they could only be leftovers from
// an earlier, already-finished attempt; that assumption breaks once two
// concurrent same-process encodes can share one pid. Since
// nextTempFileSuffix now makes every temp file name unique per attempt (see
// above), a crashed run's temp files simply age past the threshold below like
// any other stray file, so the own-pid special case is unnecessary as well as
// unsafe — dropped entirely.
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
    const entryPath = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(entryPath);
    } catch (err) {
      if (err.code === "ENOENT") {
        continue;
      }
      throw err;
    }
    if (Date.now() - stat.mtimeMs < STALE_TEMP_FILE_THRESHOLD_MS) {
      continue;
    }
    try {
      fs.unlinkSync(entryPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }
};

// `async` matters here, not just style: this is called from inside
// `missing.map(...)` below, before Promise.allSettled attaches to any of the
// returned promises. cleanupStrayTempFiles is a synchronous call — as a plain
// (non-async) function, a non-ENOENT throw from it (EACCES, EISDIR on a path
// collision) would propagate synchronously out of the .map() callback itself,
// aborting the whole missing.map(...) array construction and rejecting the
// pool's `work` for every variant in this photo — including a sibling
// variant's encode that .map() already started earlier in the same pass and
// left unawaited. Declaring this `async` converts that synchronous throw into
// a rejected promise instead, so it settles like any other single-variant
// failure and Promise.allSettled still awaits every sibling to completion.
// How far an encoded variant's pixels may drift from the source's, averaged per
// channel over a 4x4 reduction. AVIF is lossy and the ICC conversion moves
// colours a little, so a good encode is not identical — measured at 0-5, even
// where the variant is an upscale of a smaller source. A file that shipped
// corrupt measured ~90: the top of the image, then magenta garbage.
const VARIANT_COLOUR_TOLERANCE = 20;

// 4x4, deliberately coarse. At finer resolution a one-pixel resampling
// difference in a contrasty photo (black trees against bright sky) reads as a
// large deviation, while the failure being caught here — a corrupt encode — is
// a colour cast that shows at any scale.
const samplePixels = (pipeline) =>
  pipeline.resize(4, 4, { fit: "fill" }).removeAlpha().raw().toBuffer();

const meanChannelDeviation = (expected, actual) => {
  if (expected.length === 0 || expected.length !== actual.length) {
    return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (let index = 0; index < expected.length; index += 1) {
    total += Math.abs(expected[index] - actual[index]);
  }
  return total / expected.length;
};

// Encoders are not supposed to return success and write garbage, but one did:
// a complete, decodable AVIF whose lower four fifths were magenta noise, which
// then shipped. Nothing upstream can catch that — the encode resolved, the file
// renamed atomically, and every "does it decode" check passes. So each variant
// is read back and compared against the source it came from.
const encodedVariantMatchesSource = async (sourcePipeline, encodedPath) => {
  const [expected, actual] = await Promise.all([
    samplePixels(sourcePipeline.clone()),
    samplePixels(sharp(encodedPath)),
  ]);

  return meanChannelDeviation(expected, actual) <= VARIANT_COLOUR_TOLERANCE;
};

const ENCODE_ATTEMPTS = 2;

const encodeVariant = async (sourcePipeline, { size, output }) => {
  cleanupStrayTempFiles(output);

  let lastError = null;
  for (let attempt = 1; attempt <= ENCODE_ATTEMPTS; attempt += 1) {
    const tempOutput = `${output}${nextTempFileSuffix()}`;
    try {
      await sourcePipeline
        .clone()
        .resize(size)
        .withIccProfile(imageOptimisationConfig.iccProfile)
        .avif(imageOptimisationConfig.avif)
        .toFile(tempOutput);

      if (await encodedVariantMatchesSource(sourcePipeline, tempOutput)) {
        // Encode-then-rename makes the write atomic: readers (including a
        // concurrent build) either see no file at `output` or a complete one,
        // never a truncated one left by an interrupted encode.
        fs.renameSync(tempOutput, output);
        return;
      }

      // The corruption seen in the wild was not reproducible from the same
      // input, so one more attempt is usually all it takes.
      lastError = new Error(
        `Encoded variant does not match its source (attempt ${attempt} of ${ENCODE_ATTEMPTS})`,
      );
    } catch (err) {
      lastError = err;
    } finally {
      try {
        fs.unlinkSync(tempOutput);
      } catch {
        // best-effort cleanup of the partial temp file; ignore if already gone
      }
    }
  }

  throw lastError;
};

// Runs `work` over `items` with up to `jobs` items in flight at once. Per-file
// encode failures are caught inside `work` itself (see prepareOptimisedImages
// below) and never reach this pool, so in practice `work` only throws for
// something outside a single photo's encode — e.g. a failed mkdirSync. On
// such an error, workers stop picking up new items but any already-started
// item is allowed to finish before the pool rejects; that item's own
// in-flight variant writes are awaited (not merely left running) because
// `work` awaits its Promise.allSettled before returning, so a rejection here
// still can't race a sibling variant's write.
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
    failures: [],
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
    // This pre-warm pass is only an optimisation: Promise.allSettled (not
    // Promise.all) so one variant failing to encode — a source file that is
    // technically a listed photo extension but that sharp still can't decode
    // — doesn't abandon its sibling variants mid-write and doesn't abort the
    // whole pool. The real build encodes every photo it actually needs and
    // will surface a genuinely broken file there instead.
    const results = await Promise.allSettled(
      missing.map((variant) => encodeVariant(sourcePipeline, variant)),
    );

    let encodedCount = 0;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        encodedCount += 1;
        return;
      }
      const { size, output } = missing[index];
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      summary.failures.push({ albumName, filename, size, output, message });
      console.warn(
        `Could not pre-warm ${output} (will be re-attempted by the real build): ${message}`,
      );
    });

    if (encodedCount > 0) {
      summary.photosEncoded += 1;
    }
    summary.variantsEncoded += encodedCount;
  });

  summary.durationMs = Date.now() - startedAt;
  if (summary.failures.length > 0) {
    console.warn(`${summary.failures.length} variant(s) could not be pre-warmed and were skipped:`);
    for (const failure of summary.failures) {
      console.warn(`  - ${failure.output}: ${failure.message}`);
    }
  }
  return summary;
};

module.exports = {
  prepareOptimisedImages,
  PHOTO_EXTENSIONS,
  TEMP_FILE_SEPARATOR,
  STALE_TEMP_FILE_THRESHOLD_MS,
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
