import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { getNextJsSafeExif, getPhotoSize, optimiseImages, stripPublicFromPath } from "./photo";
import { getOriginalVideoTechnicalData, optimiseVideo, readVideoPoster } from "./video";
import { parseYoutubeVideoId, youtubeMediaFilename } from "./youtubeExternal";
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
import { incrementBuildCounter, measureBuild } from "./buildTiming";
import { parseColorPalette } from "../util/colorDistance";
// Node's own SQLite, not the native `sqlite3` addon: the driver is compiled
// into the runtime, so there is no per-platform binary to fetch, no ABI to
// track, and nothing linked against a glibc other than this machine's. It is
// synchronous, which suits a build: every lookup here was already serialised
// behind a promise.
let searchDb: DatabaseSync | null = null;
const photoSearchIndexCache = new Map<string, Promise<any[]>>();
const DEFAULT_SEARCH_DB_PATH = "public/search.sqlite";

const getConfiguredSearchDbPath = (): string => {
  const configuredUrl = process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL;
  if (!configuredUrl?.startsWith("/") || configuredUrl.startsWith("//")) {
    return DEFAULT_SEARCH_DB_PATH;
  }

  try {
    const pathname = decodeURIComponent(new URL(configuredUrl, "https://build.local").pathname);
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0 || segments.includes("..")) {
      return DEFAULT_SEARCH_DB_PATH;
    }
    return path.join("public", ...segments);
  } catch {
    return DEFAULT_SEARCH_DB_PATH;
  }
};

const closeSearchDb = async (): Promise<void> => {
  if (!searchDb) {
    return;
  }

  const dbToClose = searchDb;
  searchDb = null;
  dbToClose.close();
};

const getSearchDb = (dbPath: string) => {
  if (searchDb) {
    incrementBuildCounter("deserialize.searchIndexLookup.dbCacheHits");
    return searchDb;
  }

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  incrementBuildCounter("deserialize.searchIndexLookup.dbCacheMisses");
  searchDb = new DatabaseSync(dbPath, { readOnly: true });
  return searchDb;
};

const isMissingLocalMediaError = (err: unknown): boolean => {
  if (!(err instanceof Error)) {
    return false;
  }

  const maybeNodeError = err as NodeJS.ErrnoException;
  return maybeNodeError.code === "ENOENT" || err.message.includes("Input file is missing");
};

const makeMissingFileError = (filepath: string): NodeJS.ErrnoException => {
  const error = new Error(`Input file is missing: ${filepath}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
};

export const deserializeTextBlock = async (serialized: SerializedTextBlock): Promise<TextBlock> => {
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
      // An external has no file in the album directory, but the poster prepass
      // downloads its thumbnail under the synthetic "<video id>.youtube" name
      // and writes the same sidecar a local clip gets. Without that on the
      // block, an external is invisible to everything outside its album page.
      const videoId = parseYoutubeVideoId(serialized.data.href);
      const poster = videoId
        ? readVideoPoster(path.join(options.dirname, youtubeMediaFilename(videoId)))
        : null;

      return {
        ...serialized,
        ...(poster
          ? {
              _build: {
                src: serialized.data.href,
                mimeType: "video/youtube",
                poster: { srcset: poster.srcset },
                ...(poster.capturedAtLocal !== undefined
                  ? { capturedAtLocal: poster.capturedAtLocal }
                  : {}),
              },
            }
          : {}),
      };
    }

    const localFilepath = path.join(options.dirname, serialized.data.href);
    const optimised = await optimiseVideo(localFilepath, "public/data/albums");
    const originalTechnicalData = await getOriginalVideoTechnicalData(localFilepath);
    const poster = readVideoPoster(localFilepath);
    // The poster sidecar's reading is camera-local wall clock, the same as
    // every EXIF timestamp in the pipeline; originalTechnicalData.originalDate
    // is a UTC instant kept for the technical panel, so it is only the last
    // resort here.
    const resolvedDate =
      serialized.data.date ?? poster?.capturedAtLocal ?? originalTechnicalData.originalDate;

    const copy: VideoBlock = {
      ...serialized,
      data: {
        type: "local",
        href: optimised.src,
        // Omit `date` entirely when unknown — an explicit `undefined` here
        // aborts the static build via Next's isSerializableProps check.
        ...(resolvedDate !== undefined ? { date: resolvedDate } : {}),
      },
      _build: {
        src: optimised.src,
        originalSrc: serialized.data.href,
        mimeType: optimised.mimeType,
        originalTechnicalData,
        ...(poster
          ? {
              poster: { srcset: poster.srcset },
              ...(poster.capturedAtLocal !== undefined
                ? { capturedAtLocal: poster.capturedAtLocal }
                : {}),
              ...(poster.latDeg !== undefined ? { latDeg: poster.latDeg } : {}),
              ...(poster.lngDeg !== undefined ? { lngDeg: poster.lngDeg } : {}),
              ...(poster.durationSeconds !== undefined
                ? { durationSeconds: poster.durationSeconds }
                : {}),
            }
          : {}),
      },
    };

    return copy;
  });
};

// The search database keys photos by their repo-relative path (for example
// `../albums/kanto/DSCF3871.jpg`). A populated database that matches nothing is
// therefore the signature of a path mismatch — usually paths.albumsDir having
// been changed after indexing — and it is otherwise completely silent: every
// lookup returns no row, `_build.tags` normalises to `{}`, and the build
// succeeds with no alt text, tags, geocodes or colour placeholders anywhere.
//
// Reported once per build, with a sample of what the indexed keys actually look
// like, because the difference between the two prefixes is the whole diagnosis.
let warnedAboutKeyMismatch = false;

export const resetSearchIndexKeyMismatchWarning = (): void => {
  warnedAboutKeyMismatch = false;
};

const reportSearchIndexKeyMismatch = (db: DatabaseSync, missedPath: string): void => {
  if (warnedAboutKeyMismatch) {
    return;
  }
  warnedAboutKeyMismatch = true;

  let row: { path?: string } | undefined;
  try {
    row = db.prepare("SELECT path FROM images LIMIT 1;").get() as { path?: string } | undefined;
  } catch {
    // An unreadable index is reported by the lookup itself, not here.
    return;
  }

  if (row?.path) {
    console.warn(
      `[album] Search index has entries but none matched "${missedPath}".\n` +
        `[album] Indexed paths look like "${row.path}".\n` +
        "[album] Alt text, tags, geocodes and colour placeholders will be missing. " +
        "Check paths.albumsDir in site.config.json matches the path the indexer used.",
    );
  }
  // An empty index is the ordinary "not indexed yet" case, not a mismatch.
};

const PHOTO_DETAILS_SQL_WITH_ZONE =
  "SELECT images.*, metadata.tz_name, metadata.tz_offset " +
  "FROM images LEFT JOIN metadata ON metadata.path = images.path " +
  "WHERE images.path = ? LIMIT 1;";

const PHOTO_DETAILS_SQL_WITHOUT_ZONE = "SELECT * FROM images WHERE path = ? LIMIT 1;";

let zoneColumnsMissing = false;

const isMissingZoneColumns = (err: unknown) =>
  err instanceof Error && /no such column/i.test(err.message);

const getPhotoDetailsFromSearchIndex = async (
  path: string,
  dbPath = getConfiguredSearchDbPath(),
): Promise<any[]> => {
  const cached = photoSearchIndexCache.get(path);

  if (cached) {
    incrementBuildCounter("deserialize.searchIndexLookup.cacheHits");
    return cached;
  }

  return measureBuild("deserialize.searchIndexLookup", async () => {
    incrementBuildCounter("deserialize.searchIndexLookup.calls");
    // The derived timezone lives in `metadata`, not the FTS table, so it is
    // joined in here rather than surfaced through a second lookup. A database
    // indexed before those columns existed rejects the join outright, and this
    // lookup's failure is swallowed upstream — so an unconditional join would
    // cost such a fork every photo's alt text, tags, geocodes and colours
    // rather than just its zones. The first row that proves the columns absent
    // switches the whole build to the plain query.
    const lookup = (sql: string): any[] => {
      const db = getSearchDb(dbPath);
      if (!db) {
        return [];
      }

      // In index
      // ../src/public/data/albums/kanto/DSCF3871_2.jpg
      let row: any;
      try {
        row = db.prepare(sql).get(path);
      } catch (err) {
        if (sql === PHOTO_DETAILS_SQL_WITH_ZONE && isMissingZoneColumns(err)) {
          zoneColumnsMissing = true;
          return lookup(PHOTO_DETAILS_SQL_WITHOUT_ZONE);
        }
        throw err;
      }

      if (row?.colors) {
        row.colors = parseColorPalette(row.colors);
      }

      if (!row) {
        reportSearchIndexKeyMismatch(db, path);
      }

      return [row];
    };

    // Kept promise-shaped: the cache dedupes concurrent lookups for one path,
    // and callers await it.
    const promise = (async () =>
      lookup(zoneColumnsMissing ? PHOTO_DETAILS_SQL_WITHOUT_ZONE : PHOTO_DETAILS_SQL_WITH_ZONE))();

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

    if (!fs.existsSync(localFilepath)) {
      throw makeMissingFileError(localFilepath);
    }

    const { width, height } = await getPhotoSize(localFilepath);
    const exif = await getNextJsSafeExif(localFilepath);
    const srcset = await optimiseImages(localFilepath, "public/data/albums");

    // Search metadata is optional, but application consumers rely on the
    // PhotoBlock contract that `_build.tags` is always an object. Normalise a
    // missing database, missing row, or failed lookup at this build boundary.
    let tags: PhotoBlock["_build"]["tags"] = {};
    try {
      tags = (await getPhotoDetailsFromSearchIndex(localFilepath))?.[0] ?? {};
    } catch (err) {
      console.info("Failed to get details from index, skipping", err);
    }

    const copy: PhotoBlock = {
      ...block,
      formatting: {
        // Implicit cover convention: a file literally named `cover.*`
        // (basename without extension === "cover"), not merely containing
        // the substring "cover" (which matched e.g. "album-cover-shot.jpg").
        cover: path.parse(block.data.src).name === "cover",
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

export const deserializeBlock = async (b: SerializedBlock, dirname?: string): Promise<Block> => {
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
    incrementBuildCounter("deserialize.contentBlock.blockCount", serialized.blocks.length);

    const deserializedBlocks = await Promise.all(
      serialized.blocks.map(async (b) => {
        try {
          return await deserializeBlock(b, dirname);
        } catch (err) {
          const isMissingLocalPhoto = b.kind === "photo" && isMissingLocalMediaError(err);
          const isMissingLocalVideo =
            b.kind === "video" && b.data.type === "local" && isMissingLocalMediaError(err);

          if (!isMissingLocalPhoto && !isMissingLocalVideo) {
            throw err;
          }

          const missingPath =
            b.kind === "photo" ? path.join(dirname, b.data.src) : path.join(dirname, b.data.href);

          incrementBuildCounter("deserialize.contentBlock.skippedMissingMedia");
          console.warn(`Skipping missing media file: ${missingPath}`);
          return null;
        }
      }),
    );

    return {
      ...serialized,
      blocks: deserializedBlocks.filter((b): b is Block => b !== null),
      _build: {
        slug: serialized.name,
        srcdir: dirname,
      },
    };
  });
};

export const deserializeInternals = {
  getConfiguredSearchDbPath,
  resetForTesting: async () => {
    photoSearchIndexCache.clear();
    zoneColumnsMissing = false;
    resetSearchIndexKeyMismatchWarning();
    await closeSearchDb();
  },
};
