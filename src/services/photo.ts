import path from "path";
import fs from "node:fs";
import { Exif, OptimisedPhoto } from "./types";
import exifr from "exifr";
import { imageSizeFromFile } from "image-size/fromFile";
import sharp from "sharp";
import { incrementBuildCounter, measureBuild, measureBuildSync } from "./buildTiming";
import { dateToNaiveIso } from "../util/exifTime";
import { encodePublicAssetPath } from "../util/encodePublicAssetPath";
import imageOptimisationConfig from "./imageOptimisationConfig.json";

export const OPTIMISED_SIZES = imageOptimisationConfig.sizes;
export const RESIZED_IMAGE_DIR = ".resized_images";
export const AVIF_OPTIONS = {
  ...imageOptimisationConfig.avif,
  tune: imageOptimisationConfig.avif.tune as "iq",
  chromaSubsampling: imageOptimisationConfig.avif.chromaSubsampling as "4:4:4",
} as const;
// sharp already converts an embedded-profile input's pixel data to sRGB by
// default; withIccProfile("srgb") only tags the output with that profile
// explicitly rather than performing the conversion itself. Without the tag,
// a browser that doesn't assume sRGB for untagged AVIF can render the pixels
// with the wrong colour space, visibly shifting the output.
export const ICC_PROFILE = imageOptimisationConfig.iccProfile;
const TEMP_FILE_SEPARATOR = ".tmp-";
// Monotonic per-process counter appended to every temp file name so that two
// concurrent optimiseImages() calls for the SAME photo inside one process
// (e.g. two overlapping dev-server requests) never share a temp path — see
// nextTempFileSuffix below.
let tempFileCounter = 0;
const nextTempFileSuffix = () => `${TEMP_FILE_SEPARATOR}${process.pid}-${++tempFileCounter}`;

export const getPhotoSize = async (
  filepath: string,
): Promise<{ width: number; height: number }> => {
  return measureBuild("photo.getPhotoSize", async () => {
    let width = 100;
    let height = 100;

    try {
      const dimensions = await imageSizeFromFile(filepath);
      width = dimensions.width ?? 0;
      height = dimensions.height ?? 0;
    } catch {
      // noop
    }

    return { width, height };
  });
};

export const getNextJsSafeExif = async (filepath: string): Promise<Exif> => {
  return measureBuild("photo.getNextJsSafeExif", async () => {
    return exifr
      .parse(filepath, { reviveValues: true })
      .then((res) => {
        // Next.js can't serialise Date objects, and a plain JSON round-trip
        // renders them as UTC — shifting the camera's zone-less wall-clock
        // time by the build machine's offset. Serialise every Date back to
        // its wall clock instead (naive ISO, no zone designator), which is
        // what all date consumers (day keys, hour/year facets, labels) expect.
        return JSON.parse(
          JSON.stringify(res, function (key, value) {
            const raw = (this as Record<string, unknown>)[key];
            return raw instanceof Date ? dateToNaiveIso(raw) : value;
          }),
        );
      })
      .catch(() => {
        return {};
      });
  });
};

// TODO: Handle RAW camera
export const optimiseImages = async (
  photoPath: string,
  outputDirectory: string,
): Promise<OptimisedPhoto[]> => {
  return measureBuild("photo.optimiseImages", async () => {
    incrementBuildCounter("photo.optimiseImages.calls");
    const filename = path.basename(photoPath);
    const dirname = path.dirname(photoPath);
    const albumName = path.basename(dirname);

    const publicAlbumDirectory = path.join(outputDirectory, albumName);
    const resizedImageDirectory = path.join(publicAlbumDirectory, RESIZED_IMAGE_DIR);
    measureBuildSync("photo.optimiseImages.ensureDirectory", () => {
      fs.mkdirSync(resizedImageDirectory, { recursive: true });
    });

    // All generated sizes have the same input transformations. Cloning this
    // pipeline lets libvips share the source instead of opening and rotating
    // the original once per output size.
    let sourcePipeline: ReturnType<typeof sharp> | null = null;

    return Promise.all(
      [...OPTIMISED_SIZES]
        .sort((a, b) => a - b)
        .map(async (size) => {
          const newFile = path.join(resizedImageDirectory, `${filename}@${size}.avif`);

          if (fs.existsSync(newFile)) {
            incrementBuildCounter("photo.optimiseImages.cacheChecks");

            const stat = measureBuildSync("photo.optimiseImages.stat", () => {
              return fs.statSync(newFile);
            });
            if (stat.size > 0) {
              // sharp().metadata() benchmarks faster than imageSizeFromFile() here (0.16ms vs 0.25ms)
              // because of Sharp's native C++ binding. Sidecars were also tried but add management
              // complexity for negligible gain. This is already the optimal approach.
              try {
                const metadata = await measureBuild("photo.optimiseImages.cacheHitMetadata", () =>
                  sharp(newFile).metadata(),
                );
                if (metadata.width && metadata.height) {
                  incrementBuildCounter("photo.optimiseImages.cacheHits");
                  return {
                    src: encodePublicAssetPath(stripPublicFromPath(newFile)),
                    width: metadata.width,
                    height: metadata.height,
                  };
                }
              } catch {
                // fall through to re-encode
              }
              incrementBuildCounter("photo.optimiseImages.cacheHitInvalid");
              console.log(`Optimised file is unreadable, re-encoding: ${newFile}`);
            } else {
              incrementBuildCounter("photo.optimiseImages.cacheHitZeroBytes");
              console.log(`Optimised file is bad? size 0: ${newFile}`);
            }
          }

          console.log(`Optimising ${newFile}...`);
          incrementBuildCounter("photo.optimiseImages.encodes");

          return measureBuild("photo.optimiseImages.encode", async () => {
            sourcePipeline ??= sharp(photoPath).rotate();
            cleanupStrayTempFiles(newFile);
            const tempFile = `${newFile}${nextTempFileSuffix()}`;
            return (
              sourcePipeline
                .clone()
                .resize(size)
                // .withMetadata() // larger filesize than .rotate(), but preserves more metadata (eg, width/height)
                // .webp({ quality: 90, smartSubsample: true })
                .withIccProfile(ICC_PROFILE)
                .avif(AVIF_OPTIONS)
                .toFile(tempFile)
                .then((p) => {
                  // Encode-then-rename makes the write atomic: a reader (including
                  // a concurrent build) either sees no file at `newFile` or a
                  // complete one, never one truncated by an interrupted encode.
                  fs.renameSync(tempFile, newFile);
                  const optimised: OptimisedPhoto = {
                    src: encodePublicAssetPath(stripPublicFromPath(newFile)),
                    width: p.width,
                    height: p.height,
                  };
                  return optimised;
                })
                .catch((err) => {
                  console.error(`Failed to optimise ${photoPath}`);
                  try {
                    fs.unlinkSync(tempFile);
                  } catch {
                    // best-effort cleanup of the partial temp file; ignore if already gone
                  }
                  throw err;
                })
            );
          });
        }),
    );
  });
};

export const stripPublicFromPath = (p: string) => {
  return `/${p.split(path.sep).slice(1).join(path.sep)}`;
};

// A process that died mid-encode (crash, OOM-kill) can leave a
// "<newFile>.tmp-<pid>-<n>" file from a previous run behind. It's never read
// as a cache hit (the cache check only looks at the exact final path), but it
// is silent disk litter — clear out any stray temp siblings for the variant
// we're about to (re)encode.
//
// Every entry matching the prefix is only ever removed once it's stale,
// regardless of which pid created it: a fresh temp file — including one
// created by an earlier, still-in-flight variant of THIS SAME process (two
// overlapping optimiseImages() calls for the same photo) — may still be
// mid-write, and deleting it out from under that writer makes its renameSync
// throw ENOENT. There used to be an "own pid" fast path that deleted our own
// process's temp files unconditionally, on the assumption that they could
// only be leftovers from an earlier, already-finished attempt; that
// assumption breaks for two concurrent same-process encodes sharing one pid.
// Since nextTempFileSuffix now makes every temp file name unique per attempt
// (see above), a crashed run's temp files simply age past the threshold below
// like any other stray file, so the own-pid special case is unnecessary as
// well as unsafe — dropped entirely.
const STALE_TEMP_FILE_THRESHOLD_MS = 15 * 60 * 1000;

const cleanupStrayTempFiles = (finalPath: string) => {
  const dir = path.dirname(finalPath);
  const prefix = `${path.basename(finalPath)}${TEMP_FILE_SEPARATOR}`;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    const entryPath = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entryPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
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
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
};
