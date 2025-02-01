import path from "path";
import {
  getNextJsSafeExif,
  getPhotoSize,
  optimiseImages,
  removeUnneededImageSizes,
  stripPublicFromPath,
} from "./photo";
import {
  Block,
  Content,
  PhotoBlock,
  SerializedBlock,
  SerializedContent,
  SerializedPhotoBlock,
  SerializedVideoBlock,
  SerializedTextBlock,
  TextBlock,
  VideoBlock,
} from "./types";
const sqlite3 = require("sqlite3").verbose();

export const deserializeTextBlock = async (
  serialized: SerializedTextBlock,
): Promise<TextBlock> => {
  const copy = { ...serialized };
  return new Promise((resolve) => {
    resolve(copy);
  });
};

export const deserializeVideoBlock = async (
  serialized: SerializedVideoBlock,
): Promise<VideoBlock> => {
  const copy = { ...serialized };
  return new Promise((resolve) => {
    resolve(copy);
  });
};

const getPhotoDetailsFromSearchIndex = async (
  path: string,
  dbPath = "public/search.sqlite",
): Promise<any[]> => {
  const promise = new Promise<any[]>((resolve, reject) => {
    // This is really unoptimal
    const db = new sqlite3.Database(dbPath);
    const sql = "SELECT * FROM images WHERE path = ? LIMIT 1;";
    // In index
    // ../src/public/data/albums/kanto/DSCF3871_2.jpg
    const result: any[] = [];
    db.get(sql, [path], (err: Error, row: any) => {
      if (err) {
        reject(err);
      }
      result.push(row);

      if (row?.colors) {
        const jsonified = row?.colors
          ?.replaceAll("(", "[")
          .replaceAll(")", "]");
        row.colors = JSON.parse(jsonified);
      }

      db.close();
      resolve(result);
    });
  });

  return promise;
};

export const deserializePhotoBlock = async (
  block: SerializedPhotoBlock,
  options: {
    dirname: string;
  },
): Promise<PhotoBlock> => {
  const photoFilename = block.data.src;
  const localFilepath = path.join(options.dirname, photoFilename);

  const { width, height } = await getPhotoSize(localFilepath);
  const exif = await getNextJsSafeExif(localFilepath);
  const srcset = await optimiseImages(localFilepath, "public/data/albums");
  removeUnneededImageSizes(localFilepath);

  // Tags are optional
  // Needs to be null for same de/serialization result
  let tags = null;
  try {
    tags = (await getPhotoDetailsFromSearchIndex(localFilepath))?.[0] ?? null;
  } catch (err) {
    console.info("Failed to get details from index, skipping", err);
  }

  const copy: PhotoBlock = {
    ...block,
    formatting: {
      cover: block.data.src.includes("cover"),
      ...block.formatting,
    },
    data: {
      ...block.data,
      src: stripPublicFromPath(path.join(options.dirname, block.data.src)),
    },
    _build: {
      srcset,
      exif: exif,
      tags: tags,
      width,
      height,
    },
  };

  return copy;
};

export const deserializeBlock = async (
  b: SerializedBlock,
  dirname?: string,
): Promise<Block> => {
  switch (b.kind) {
    case "photo":
      if (dirname) {
        return deserializePhotoBlock(b, { dirname });
      }
      throw new Error("Need dirname for photoblock deser");
    case "text":
      return deserializeTextBlock(b);
    default:
      throw new Error(`unsupported kind ${b.kind}`);
  }
};

export const deserializeContentBlock = async (
  serialized: SerializedContent,
  /** Relative to Next.js root, eg, `public/data/albums/foobar` */
  dirname: string,
): Promise<Content> => {
  return {
    ...serialized,
    blocks: await Promise.all(
      serialized.blocks.map(async (b) => deserializeBlock(b, dirname)),
    ),
    _build: {
      slug: serialized.name,
      srcdir: dirname,
    },
  };
};
