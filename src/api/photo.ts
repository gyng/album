import path from "path";
import fs from "fs";
import { OptimisedPhoto } from "./types";
import exifr from "exifr";
import sizeOf from "image-size";
import sharp from "sharp";

export const OPTIMISED_SIZES = [4896, 2400, 1200, 800];
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
  return exifr
    .parse(filepath)
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
    ...OPTIMISED_SIZES.sort((a, b) => a - b).map((size) => {
      const newFile = path.join(
        dirname,
        RESIZED_IMAGE_DIR,
        `${filename}@${size}.webp`
      );
      fs.mkdirSync(path.join(dirname, RESIZED_IMAGE_DIR), { recursive: true });

      const optimised: OptimisedPhoto = {
        src: stripPublicFromPath(newFile),
        width: size,
      };

      if (fs.existsSync(newFile)) {
        return optimised;
      }

      return (
        sharp(photoPath)
          .rotate()
          .resize(size)
          // .withMetadata() // larger filesize than .rotate(), but preserves more metadata (eg, width/height)
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
