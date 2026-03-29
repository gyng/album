import path from "path";
import {
  getNextJsSafeExif,
  getPhotoSize,
  optimiseImages,
  stripPublicFromPath,
} from "./photo";
import { getOriginalVideoTechnicalData, optimiseVideo } from "./video";
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
import {
  incrementBuildCounter,
  measureBuild,
} from "./buildTiming";
import { parseColorPalette } from "../util/colorDistance";
const sqlite3 = require("sqlite3").verbose();

let searchDb: any | null = null;
const photoSearchIndexCache = new Map<string, Promise<any[]>>();

const closeSearchDb = async (): Promise<void> => {
  if (!searchDb) {
    return;
  }

  const dbToClose = searchDb;
  searchDb = null;

  await new Promise<void>((resolve) => {
    dbToClose.close(() => {
      resolve();
    });
  });
};

const getSearchDb = (dbPath: string) => {
  if (searchDb) {
    incrementBuildCounter("deserialize.searchIndexLookup.dbCacheHits");
    return searchDb;
  }

  incrementBuildCounter("deserialize.searchIndexLookup.dbCacheMisses");
  searchDb = new sqlite3.Database(dbPath);
  return searchDb;
};

export const deserializeTextBlock = async (
  serialized: SerializedTextBlock,
): Promise<TextBlock> => {
  return measureBuild("deserialize.textBlock", async () => {
    const copy = { ...serialized };
    return new Promise((resolve) => {
      resolve(copy);
    });
  });
};

export const deserializeVideoBlock = async (
  serialized: SerializedVideoBlock,
  options: {
    dirname: string;
  },
): Promise<VideoBlock> => {
  return measureBuild("deserialize.videoBlock", async () => {
    if (serialized.data.type === "youtube") {
      return { ...serialized };
    }

    const localFilepath = path.join(options.dirname, serialized.data.href);
    const optimised = await optimiseVideo(localFilepath, "public/data/albums");
    const originalTechnicalData =
      await getOriginalVideoTechnicalData(localFilepath);
    const resolvedDate =
      serialized.data.date ?? originalTechnicalData.originalDate;

    const copy: VideoBlock = {
      ...serialized,
      data: {
        ...serialized.data,
        href: optimised.src,
        date: resolvedDate,
      },
      _build: {
        src: optimised.src,
        originalSrc: serialized.data.href,
        mimeType: optimised.mimeType,
        originalTechnicalData,
      },
    };

    return copy;
  });
};

const getPhotoDetailsFromSearchIndex = async (
  path: string,
  dbPath = "public/search.sqlite",
): Promise<any[]> => {
  const cached = photoSearchIndexCache.get(path);

  if (cached) {
    incrementBuildCounter("deserialize.searchIndexLookup.cacheHits");
    return cached;
  }

  return measureBuild("deserialize.searchIndexLookup", async () => {
    incrementBuildCounter("deserialize.searchIndexLookup.calls");
    const promise = new Promise<any[]>((resolve, reject) => {
      const db = getSearchDb(dbPath);
      const sql = "SELECT * FROM images WHERE path = ? LIMIT 1;";
      // In index
      // ../src/public/data/albums/kanto/DSCF3871_2.jpg
      const result: any[] = [];
      db.get(sql, [path], (err: Error, row: any) => {
        if (err) {
          reject(err);
          return;
        }
        result.push(row);

        if (row?.colors) {
          row.colors = parseColorPalette(row.colors);
        }

        resolve(result);
      });
    });

    photoSearchIndexCache.set(path, promise);

    void promise.catch(() => {
      photoSearchIndexCache.delete(path);
    });

    return promise;
  });
};

export const deserializePhotoBlock = async (
  block: SerializedPhotoBlock,
  options: {
    dirname: string;
  },
): Promise<PhotoBlock> => {
  return measureBuild("deserialize.photoBlock", async () => {
    incrementBuildCounter("deserialize.photoBlock.calls");
    const photoFilename = block.data.src;
    const localFilepath = path.join(options.dirname, photoFilename);

    const { width, height } = await getPhotoSize(localFilepath);
    const exif = await getNextJsSafeExif(localFilepath);
    const srcset = await optimiseImages(localFilepath, "public/data/albums");

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
  });
};

export const deserializeBlock = async (
  b: SerializedBlock,
  dirname?: string,
): Promise<Block> => {
  return measureBuild("deserialize.block", async () => {
    switch (b.kind) {
      case "photo":
        if (dirname) {
          return deserializePhotoBlock(b, { dirname });
        }
        throw new Error("Need dirname for photoblock deser");
      case "text":
        return deserializeTextBlock(b);
      case "video":
        if (dirname) {
          return deserializeVideoBlock(b, { dirname });
        }
        throw new Error("Need dirname for videoblock deser");
      default:
        throw new Error("unsupported block kind");
    }
  });
};

export const deserializeContentBlock = async (
  serialized: SerializedContent,
  /** Relative to Next.js root, eg, `public/data/albums/foobar` */
  dirname: string,
): Promise<Content> => {
  return measureBuild("deserialize.contentBlock", async () => {
    incrementBuildCounter("deserialize.contentBlock.calls");
    incrementBuildCounter(
      "deserialize.contentBlock.blockCount",
      serialized.blocks.length,
    );

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
  });
};

export const deserializeInternals = {
  resetForTesting: async () => {
    photoSearchIndexCache.clear();
    await closeSearchDb();
  },
};
