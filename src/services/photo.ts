import path from "path";
import fs from "fs";
import { OptimisedPhoto } from "./types";
import exifr from "exifr";
import sizeOf from "image-size";
import sharp from "sharp";

export const OPTIMISED_SIZES = [3200, 1600, 800];
export const RESIZED_IMAGE_DIR = ".resized_images";
export const PUBLIC_ALBUMS_DIR = "public/data/albums";

export const getPhotoSize = async (
  filepath: string,
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

export const removeStaleImages = async (dirname: string) => {
  const resizedDir = path.join(dirname, RESIZED_IMAGE_DIR);

  if (!fs.existsSync(resizedDir)) {
    console.log(
      "missing album resized directory, skipping cleanup.",
      resizedDir,
    );
    return;
  }

  const cachedFiles = fs.readdirSync(resizedDir);

  const getOriginalFileFromCachedFilename = (cachedFilename: string) => {
    const expectedFilename = path.parse(cachedFilename).name.split("@")[0];
    const expectedOriginalFile = path.join(dirname, expectedFilename);
    return expectedOriginalFile;
  };

  return Promise.all([
    ...cachedFiles.map(async (file) => {
      const cachedFile = path.join(resizedDir, file);
      const originalFile = getOriginalFileFromCachedFilename(cachedFile);

      if (!fs.existsSync(originalFile)) {
        console.log(
          `Removing cached optimised image "${cachedFile}". Expected source "${originalFile}" to exist.`,
        );
        fs.unlinkSync(cachedFile);
      }
    }),
  ]);
};

export const removeUnneededImageSizes = async (photoPath: string) => {
  const dirname = path.dirname(photoPath);

  const resizedDir = path.join(PUBLIC_ALBUMS_DIR, dirname, RESIZED_IMAGE_DIR);

  if (!fs.existsSync(resizedDir)) {
    return;
  }

  const cachedFiles = fs.readdirSync(resizedDir);

  const getSizeFromFilename = (cachedFilename: string) => {
    return cachedFilename.split("@")[1].split(".")[0];
  };

  return Promise.all([
    ...cachedFiles.map(async (file) => {
      const cachedFile = path.join(resizedDir, file);
      const size = getSizeFromFilename(file);

      if (!OPTIMISED_SIZES.includes(parseInt(size))) {
        console.log(`Removing optimised image (unused size): ${cachedFile}`);
        fs.unlinkSync(cachedFile);
      }
    }),
  ]);
};

// TODO: Handle RAW camera
export const optimiseImages = async (
  photoPath: string,
  outputDirectory: string,
): Promise<OptimisedPhoto[]> => {
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
      fs.mkdirSync(path.join(publicAlbumDirectory, RESIZED_IMAGE_DIR), {
        recursive: true,
      });

      if (fs.existsSync(newFile)) {
        // console.log(`Already optimised ${newFile}, using cached version`);

        // Check if file is valid
        const stat = fs.statSync(newFile);
        if (stat.size > 0) {
          const metadata = await sharp(newFile).metadata();

          if (!metadata.width || !metadata.height) {
            console.log(`Optimised file is bad? Metadata: ${metadata}`);
          } else {
            const optimised: OptimisedPhoto = {
              src: stripPublicFromPath(newFile),
              width: metadata.width,
              height: metadata.height,
            };

            return optimised;
          }
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
          .then((p) => {
            const optimised: OptimisedPhoto = {
              src: newFile,
              width: p.width,
              height: p.height,
            };
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
