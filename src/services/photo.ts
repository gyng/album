import path from "path";
import fs from "node:fs";
import { OptimisedPhoto } from "./types";
import exifr from "exifr";
import { imageSizeFromFile } from "image-size/fromFile";
import sharp from "sharp";
import {
  incrementBuildCounter,
  measureBuild,
  measureBuildSync,
} from "./buildTiming";

export const OPTIMISED_SIZES = [3200, 1600, 800];
export const RESIZED_IMAGE_DIR = ".resized_images";
export const AVIF_OPTIONS = { quality: 75, effort: 2 } as const;

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
    } catch (err) {
      // noop
    }

    return new Promise((resolve) => {
      resolve({ width, height });
    });
  });
};

// TODO: typedef any
export const getNextJsSafeExif = async (filepath: string): Promise<any> => {
  // EXIF dates are resolved to relative datetime: this is wrong behaviour
  // but we are lazy and don't want to turn that off as we need to compare dates
  // https://github.com/MikeKovarik/exifr/issues/51
  return measureBuild("photo.getNextJsSafeExif", async () => {
    return exifr
      .parse(filepath, { reviveValues: true })
      .then((res) => {
        // Next.js doesn't serialize Date objects
        return JSON.parse(JSON.stringify(res));
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

    return Promise.all([
      ...OPTIMISED_SIZES.sort((a, b) => a - b).map(async (size) => {
        const newFile = path.join(
          publicAlbumDirectory,
          RESIZED_IMAGE_DIR,
          `${filename}@${size}.avif`,
        );
        measureBuildSync("photo.optimiseImages.ensureDirectory", () => {
          fs.mkdirSync(path.join(publicAlbumDirectory, RESIZED_IMAGE_DIR), {
            recursive: true,
          });
        });

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
              const metadata = await measureBuild(
                "photo.optimiseImages.cacheHitMetadata",
                () => sharp(newFile).metadata(),
              );
              if (metadata.width && metadata.height) {
                incrementBuildCounter("photo.optimiseImages.cacheHits");
                return {
                  src: stripPublicFromPath(newFile),
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
          return sharp(photoPath)
            .rotate()
            .resize(size)
            // .withMetadata() // larger filesize than .rotate(), but preserves more metadata (eg, width/height)
            // .webp({ quality: 90, smartSubsample: true })
            .avif(AVIF_OPTIONS)
            .toFile(newFile)
            .then((p) => {
              const optimised: OptimisedPhoto = {
                src: stripPublicFromPath(newFile),
                width: p.width,
                height: p.height,
              };
              return optimised;
            })
            .catch((err) => {
              console.error(`Failed to optimise ${photoPath}`);
              throw err;
            });
        });
      }),
    ]);
  });
};

export const stripPublicFromPath = (p: string) => {
  return `/${p.split(path.sep).slice(1).join(path.sep)}`;
};
