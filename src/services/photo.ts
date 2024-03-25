import path from "path";
import fs from "fs";
import { OptimisedPhoto } from "./types";
import exifr from "exifr";
import sizeOf from "image-size";
import sharp from "sharp";

export const OPTIMISED_SIZES = [4896, 2400, 1200, 600];
export const RESIZED_IMAGE_DIR = ".resized_images";

export const getPhotoSize = async (
  filepath: string
): Promise<{ width: number; height: number }> => {
  let width = 100;
  let height = 100;

  try {
    const dimensions = sizeOf(filepath);
    width = dimensions.width ?? 0;
    height = dimensions.height ?? 0;
  } catch (err) {
    // noop
  }

  return new Promise((resolve) => {
    resolve({ width, height });
  });
};

// TODO: typedef any
export const getNextJsSafeExif = async (filepath: string): Promise<any> => {
  // EXIF dates are resolved to relative datetime: this is wrong behaviour
  // but we are lazy and don't want to turn that off as we need to compare dates
  // https://github.com/MikeKovarik/exifr/issues/51
  return exifr
    .parse(filepath, { reviveValues: true })
    .then((res) => {
      // Next.js doesn't serialize Date objects
      return JSON.parse(JSON.stringify(res));
    })
    .catch(() => {
      return {};
    });
};

// TODO: Handle RAW camera
export const optimiseImages = async (
  photoPath: string
): Promise<OptimisedPhoto[]> => {
  const filename = path.basename(photoPath);
  const dirname = path.dirname(photoPath);

  return Promise.all([
    ...OPTIMISED_SIZES.sort((a, b) => a - b).map(async (size) => {
      const newFile = path.join(
        dirname,
        RESIZED_IMAGE_DIR,
        `${filename}@${size}.avif`
      );
      fs.mkdirSync(path.join(dirname, RESIZED_IMAGE_DIR), { recursive: true });

      const optimised: OptimisedPhoto = {
        src: stripPublicFromPath(newFile),
        width: size,
      };

      if (fs.existsSync(newFile)) {
        // console.log(`Already optimised ${newFile}, using cached version`);

        // Check if file is valid
        const stat = fs.statSync(newFile);
        if (stat.size > 0) {
          return optimised;
        } else {
          console.log(`Optimised file is bad? size 0: ${newFile}`);
        }
      }

      console.log(`Optimising ${newFile}...`);
      return (
        sharp(photoPath)
          .rotate()
          .resize(size)
          // .withMetadata() // larger filesize than .rotate(), but preserves more metadata (eg, width/height)
          // .webp({ quality: 90, smartSubsample: true })
          .avif({ quality: 75 })
          .toFile(newFile)
          .then(() => {
            return optimised;
          })
          .catch((err) => {
            console.error(`Failed to optimise ${photoPath}`);
            throw err;
          })
      );
    }),
  ]);
};

export const stripPublicFromPath = (p: string) => {
  return `/${p.split(path.sep).slice(1).join(path.sep)}`;
};
