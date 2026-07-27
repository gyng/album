const fs = require("node:fs");
const path = require("node:path");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const {
  PHOTO_EXTENSIONS,
  STALE_TEMP_FILE_THRESHOLD_MS,
} = require("./prepare-optimised-images.cjs");

const OPTIMISED_IMAGE_SIZES = new Set(imageOptimisationConfig.sizes);
const OPTIMISED_VIDEO_MAX_WIDTH = 1920;
const RESIZED_IMAGE_DIR = ".resized_images";
const RESIZED_VIDEO_DIR = ".resized_videos";
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const IMAGE_CACHE_CONFIG_FILE = ".image-optimisation-config.json";
const IMAGE_CACHE_CONFIG = JSON.stringify(imageOptimisationConfig);

const isDirectory = (targetPath) => {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
};

const listDirectories = (root) => {
  if (!isDirectory(root)) {
    return [];
  }

  return fs.readdirSync(root).filter((entry) => {
    return isDirectory(path.join(root, entry));
  });
};

// isFileEntry mirrors prepare-optimised-images.cjs's own helper of the same
// shape: withFileTypes() reports isFile() as false for symlinks, so a
// symlinked photo would otherwise never count, permanently disabling the
// orphan sweep and the sentinel stamp for a symlink-based album library.
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

const directoryHasPhotoFile = (dir) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // ENOENT: the directory vanished (TOCTOU). EACCES: unreadable (e.g. a
    // permissions mistake on the albums mount). Neither is grounds to crash
    // the whole predev run — treat it as "no photo here" and keep scanning
    // the other albums.
    if (err.code === "ENOENT" || err.code === "EACCES") {
      return false;
    }
    throw err;
  }

  return entries.some((entry) => {
    return isFileEntry(dir, entry) && PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
  });
};

// A directory only counts as a real album if it isn't a test fixture or a
// hidden/system directory left behind by something other than album
// authoring (a Syncthing `.stfolder`, a Synology `@eaDir`, an fsck
// `lost+found`) AND it directly contains at least one photo file. The name
// checks alone aren't enough: any of those non-`test-` directories left on an
// improperly mounted or synced albums/ would otherwise be counted as a real
// album and defeat the orphan-sweep guard below.
const isRealAlbumName = (albumsDir, name) => {
  return (
    !name.startsWith("test-") &&
    !name.startsWith(".") &&
    directoryHasPhotoFile(path.join(albumsDir, name))
  );
};

const albumsDirHasRealAlbum = (albumsDir, albumNames) => {
  return albumNames.some((name) => isRealAlbumName(albumsDir, name));
};

const removeFileIfExists = (targetPath) => {
  // Tolerate ENOENT rather than pre-checking with existsSync: under concurrent
  // builds the file can vanish between the check and the unlink (TOCTOU).
  try {
    fs.unlinkSync(targetPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

// Cache files are named "<originalName>@<size>.<ext>", but the original name can
// itself contain "@" (e.g. "me@beach.jpg@800.avif"). Split on the LAST "@" so
// the original name and size segment survive intact.
const parseCacheFileName = (file) => {
  const nameWithoutExt = path.parse(file).name;
  const lastAt = nameWithoutExt.lastIndexOf("@");
  if (lastAt === -1) {
    return { originalName: nameWithoutExt, size: Number.NaN };
  }

  return {
    originalName: nameWithoutExt.slice(0, lastAt),
    size: Number(nameWithoutExt.slice(lastAt + 1)),
  };
};

const hasSourceChangedSinceCache = (sourcePath, cachedPath) => {
  // Compare mtime only. ctime moves on any metadata change (chmod/chown, and an
  // rsync/restore over albums/), which would needlessly invalidate the entire
  // media cache and trigger hours of re-encoding despite unchanged content.
  const sourceStat = fs.statSync(sourcePath);

  let cachedStat;
  try {
    cachedStat = fs.statSync(cachedPath);
  } catch (err) {
    // Tolerate ENOENT rather than pre-checking with existsSync: under a
    // concurrent build the cached file (or a temp file renamed into place)
    // can vanish between readdirSync and this stat (TOCTOU, same as
    // removeFileIfExists above). Treat it as not-changed and let the caller
    // skip the entry rather than crashing the whole cleanup pass.
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }

  return sourceStat.mtimeMs > cachedStat.mtimeMs;
};

// A cache-dir entry like "photo.jpg@800.avif.tmp-<pid>-<n>" is a still-live or
// crashed in-flight write from prepare-optimised-images.cjs / photo.ts's own
// encoder (see TEMP_FILE_SEPARATOR there). parseCacheFileName has no size
// segment to parse for it (it parses to NaN), which OPTIMISED_IMAGE_SIZES
// would never contain — without this check every fresh in-flight temp file
// would be deleted out from under its writer as a bogus "unneeded size",
// resurrecting the exact delete-under-writer race the temp-file scheme exists
// to prevent. Apply the same stale-only discipline as the stray-temp cleanup
// there: only remove it once it's older than the threshold a concurrent
// writer could plausibly still be using.
// End-anchored on the ".tmp-<pid>" / ".tmp-<pid>-<n>" suffix shapes the encode
// scripts produce, so a source photo whose own name merely contains ".tmp-"
// (and its derived cache entries like "scan.tmp-final.jpg@800.avif") is never
// misclassified as a temp file and repeatedly deleted.
const TEMP_FILE_PATTERN = /\.tmp-\d+(-\d+)?$/;
const isTempFile = (file) => TEMP_FILE_PATTERN.test(file);

// Poster outputs of services/videoPoster.ts, keyed by the video's own filename.
const POSTER_CACHE_PATTERN = /@poster\.(jpg|json)$/i;
const isPosterCacheFile = (file) => POSTER_CACHE_PATTERN.test(file);

// A YouTube external has no file in the album directory: its cache entries are
// keyed by the synthetic "<video id>.youtube" name that services/youtubeExternal.ts
// writes. The v2 manifest is therefore the only thing that can say whether such
// an entry is still wanted, so an external dropped from the manifest is what
// makes its poster collectable.
const MANIFEST_V2_NAME = "album.json";
const YOUTUBE_MEDIA_EXTENSION = ".youtube";

const listDeclaredExternalNames = (albumDir) => {
  const manifestPath = path.join(albumDir, MANIFEST_V2_NAME);
  if (!fs.existsSync(manifestPath)) {
    return new Set();
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    // An unreadable manifest is not evidence that anything is orphaned, so
    // keep every external cache entry rather than deleting work that a fixed
    // manifest would immediately need re-fetched.
    return null;
  }

  const externals = Array.isArray(manifest?.externals) ? manifest.externals : [];
  const names = new Set();
  for (const external of externals) {
    if (external?.type !== "youtube" || typeof external.href !== "string") {
      continue;
    }
    const id = readYoutubeVideoId(external.href);
    if (id) {
      names.add(`${id}${YOUTUBE_MEDIA_EXTENSION}`);
    }
  }
  return names;
};

// Deliberately duplicated from services/youtubeExternal.ts rather than imported:
// this sweep runs before (and independently of) any TypeScript loading, and the
// two only have to agree on the id, not on the whole module.
const readYoutubeVideoId = (href) => {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    const candidate =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : host.endsWith("youtube.com")
          ? url.pathname.startsWith("/embed/")
            ? url.pathname.slice("/embed/".length)
            : (url.searchParams.get("v") ?? "")
          : "";
    const id = candidate.split("/")[0] ?? "";
    return /^[\w-]{8,16}$/.test(id) ? id : null;
  } catch {
    return null;
  }
};

const isExternalCacheName = (originalName) =>
  originalName.toLowerCase().endsWith(YOUTUBE_MEDIA_EXTENSION);

// Per-minute scene frames are cached as "<video>@t<seconds>@…", so the name in
// front of the size segment is not itself a file. Trace it back to the clip it
// was taken from before deciding whether its source still exists.
const SCENE_SUFFIX_PATTERN = /@t\d+(?:\.\d+)?$/;
const baseMediaName = (originalName) => originalName.replace(SCENE_SUFFIX_PATTERN, "");

const isFreshTempFile = (targetPath) => {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (err) {
    // Already gone (TOCTOU) — nothing to protect, treat as not-fresh so the
    // caller's removal attempt below is a harmless no-op.
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
  return Date.now() - stat.mtimeMs < STALE_TEMP_FILE_THRESHOLD_MS;
};

const cleanupImageCache = ({ albumDir, publicAlbumDir, invalidateOptimisedImages }) => {
  const resizedDir = path.join(publicAlbumDir, RESIZED_IMAGE_DIR);

  if (!isDirectory(resizedDir)) {
    return {
      removedStale: 0,
      removedUnneeded: 0,
      removedChanged: 0,
      removedOutdated: 0,
      removedStaleTemp: 0,
    };
  }

  const declaredExternals = listDeclaredExternalNames(albumDir);
  let removedStale = 0;
  let removedUnneeded = 0;
  let removedChanged = 0;
  let removedOutdated = 0;
  let removedStaleTemp = 0;

  for (const file of fs.readdirSync(resizedDir)) {
    const cachedFile = path.join(resizedDir, file);

    if (isTempFile(file)) {
      if (!isFreshTempFile(cachedFile)) {
        removedStaleTemp += removeFileIfExists(cachedFile) ? 1 : 0;
      }
      continue;
    }

    if (invalidateOptimisedImages && path.extname(file).toLowerCase() === ".avif") {
      removedOutdated += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    const { originalName, size } = parseCacheFileName(file);
    const sourceName = baseMediaName(originalName);
    const originalFile = path.join(albumDir, sourceName);

    if (isExternalCacheName(sourceName)) {
      if (declaredExternals && !declaredExternals.has(sourceName)) {
        removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
        continue;
      }
      if (!OPTIMISED_IMAGE_SIZES.has(size)) {
        removedUnneeded += removeFileIfExists(cachedFile) ? 1 : 0;
      }
      continue;
    }

    if (!fs.existsSync(originalFile)) {
      removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (hasSourceChangedSinceCache(originalFile, cachedFile)) {
      removedChanged += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (!OPTIMISED_IMAGE_SIZES.has(size)) {
      removedUnneeded += removeFileIfExists(cachedFile) ? 1 : 0;
    }
  }

  return { removedStale, removedUnneeded, removedChanged, removedOutdated, removedStaleTemp };
};

const cleanupVideoCache = ({ albumDir, publicAlbumDir }) => {
  const resizedDir = path.join(publicAlbumDir, RESIZED_VIDEO_DIR);

  if (!isDirectory(resizedDir)) {
    return { removedStale: 0, removedUnneeded: 0, removedChanged: 0, removedStaleTemp: 0 };
  }

  const declaredExternals = listDeclaredExternalNames(albumDir);
  let removedStale = 0;
  let removedUnneeded = 0;
  let removedChanged = 0;
  let removedStaleTemp = 0;

  for (const file of fs.readdirSync(resizedDir)) {
    const cachedFile = path.join(resizedDir, file);

    if (isTempFile(file)) {
      if (!isFreshTempFile(cachedFile)) {
        removedStaleTemp += removeFileIfExists(cachedFile) ? 1 : 0;
      }
      continue;
    }

    const { originalName, size } = parseCacheFileName(file);
    const sourceName = baseMediaName(originalName);
    const originalFile = path.join(albumDir, sourceName);

    if (isExternalCacheName(sourceName)) {
      if (declaredExternals && !declaredExternals.has(sourceName)) {
        removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
      }
      continue;
    }

    if (!fs.existsSync(originalFile)) {
      removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (hasSourceChangedSinceCache(originalFile, cachedFile)) {
      removedChanged += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    // "<video>@poster.jpg" / "<video>@poster.json" are the extracted frame the
    // indexer reads and the sidecar describing the clip, not a transcode at
    // some retired width. They parse to a NaN size like any other non-numeric
    // segment, so without this they would be swept every run and re-extracted
    // on the next build.
    if (isPosterCacheFile(file)) {
      continue;
    }

    if (
      VIDEO_EXTENSIONS.has(path.extname(originalFile).toLowerCase()) &&
      size !== OPTIMISED_VIDEO_MAX_WIDTH
    ) {
      removedUnneeded += removeFileIfExists(cachedFile) ? 1 : 0;
    }
  }

  return { removedStale, removedUnneeded, removedChanged, removedStaleTemp };
};

// listDirectories(albumsDir) only ever sees albums that still exist, so a
// deleted album's `public/data/albums/<name>/.resized_images` and
// `.resized_videos` caches are never visited by the per-album loop above and
// ship forever. Walk the public albums dir separately and remove the media
// caches for any name that no longer has a matching source album.
// Conservative: only the two known cache directories are ever deleted, plus
// the now-empty public album directory if nothing else remains in it — no
// other content.
//
// Guarded the same way as the image-cache-config sentinel write below: if
// there is no real album at all — `albums/` missing or unmounted, a fresh
// clone/CI checkout where only the committed `test-*` fixtures exist, or an
// improperly mounted/synced albums/ containing only non-album directories
// like `.stfolder` or `lost+found` — every real album's public cache would
// look orphaned and get deleted. Skip the sweep entirely in that case rather
// than mass-deleting real caches.
const removeOrphanedAlbumMediaCaches = ({ publicAlbumsDir, albumNames, hasRealAlbum }) => {
  if (!hasRealAlbum) {
    return 0;
  }

  const knownAlbums = new Set(albumNames);
  let removedOrphanedAlbums = 0;

  for (const publicAlbumName of listDirectories(publicAlbumsDir)) {
    if (knownAlbums.has(publicAlbumName)) {
      continue;
    }

    const publicAlbumDir = path.join(publicAlbumsDir, publicAlbumName);
    const cacheDirs = [RESIZED_IMAGE_DIR, RESIZED_VIDEO_DIR]
      .map((dir) => path.join(publicAlbumDir, dir))
      .filter(isDirectory);
    if (cacheDirs.length === 0) {
      continue;
    }

    for (const cacheDir of cacheDirs) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    removedOrphanedAlbums += 1;

    if (fs.readdirSync(publicAlbumDir).length === 0) {
      fs.rmdirSync(publicAlbumDir);
    }
  }

  return removedOrphanedAlbums;
};

const cleanupOptimisedMedia = async ({
  albumsDir = path.resolve(__dirname, "..", "..", "albums"),
  publicAlbumsDir = path.resolve(__dirname, "..", "public", "data", "albums"),
} = {}) => {
  const albumNames = listDirectories(albumsDir);
  const hasRealAlbum = albumsDirHasRealAlbum(albumsDir, albumNames);
  const imageCacheConfigPath = path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE);
  let imageCacheConfigIsCurrent = false;
  try {
    imageCacheConfigIsCurrent =
      fs.readFileSync(imageCacheConfigPath, "utf8") === IMAGE_CACHE_CONFIG;
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  const totals = {
    albumsScanned: albumNames.length,
    removedStaleImages: 0,
    removedChangedImages: 0,
    removedUnneededImageSizes: 0,
    removedOutdatedImages: 0,
    removedStaleTempImages: 0,
    removedStaleVideos: 0,
    removedChangedVideos: 0,
    removedUnneededVideoSizes: 0,
    removedStaleTempVideos: 0,
    removedOrphanedAlbums: 0,
  };

  for (const albumName of albumNames) {
    const albumDir = path.join(albumsDir, albumName);
    const publicAlbumDir = path.join(publicAlbumsDir, albumName);

    const imageResults = cleanupImageCache({
      albumDir,
      publicAlbumDir,
      invalidateOptimisedImages: !imageCacheConfigIsCurrent,
    });
    const videoResults = cleanupVideoCache({ albumDir, publicAlbumDir });

    totals.removedStaleImages += imageResults.removedStale;
    totals.removedChangedImages += imageResults.removedChanged;
    totals.removedUnneededImageSizes += imageResults.removedUnneeded;
    totals.removedOutdatedImages += imageResults.removedOutdated;
    totals.removedStaleTempImages += imageResults.removedStaleTemp;
    totals.removedStaleVideos += videoResults.removedStale;
    totals.removedChangedVideos += videoResults.removedChanged;
    totals.removedUnneededVideoSizes += videoResults.removedUnneeded;
    totals.removedStaleTempVideos += videoResults.removedStaleTemp;
  }

  totals.removedOrphanedAlbums = removeOrphanedAlbumMediaCaches({
    publicAlbumsDir,
    albumNames,
    hasRealAlbum,
  });

  // Gated on the same hasRealAlbum condition as the sweep above: if there is
  // no real album, invalidation/cleanup above was skipped, so stamping the
  // sentinel "current" here would be a lie — a real album reappearing later
  // would then look already up to date and its outdated caches would never
  // get invalidated.
  if (!imageCacheConfigIsCurrent && hasRealAlbum) {
    fs.mkdirSync(publicAlbumsDir, { recursive: true });
    fs.writeFileSync(imageCacheConfigPath, IMAGE_CACHE_CONFIG);
  }

  return totals;
};

module.exports = {
  cleanupOptimisedMedia,
};

/* istanbul ignore next -- direct CLI dispatch; cleanupOptimisedMedia is tested independently */
if (require.main === module) {
  cleanupOptimisedMedia()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
