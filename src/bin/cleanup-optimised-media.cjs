const fs = require("node:fs");
const path = require("node:path");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");

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
  const cachedStat = fs.statSync(cachedPath);

  return sourceStat.mtimeMs > cachedStat.mtimeMs;
};

const cleanupImageCache = ({ albumDir, publicAlbumDir, invalidateOptimisedImages }) => {
  const resizedDir = path.join(publicAlbumDir, RESIZED_IMAGE_DIR);

  if (!isDirectory(resizedDir)) {
    return { removedStale: 0, removedUnneeded: 0, removedChanged: 0, removedOutdated: 0 };
  }

  let removedStale = 0;
  let removedUnneeded = 0;
  let removedChanged = 0;
  let removedOutdated = 0;

  for (const file of fs.readdirSync(resizedDir)) {
    const cachedFile = path.join(resizedDir, file);

    if (invalidateOptimisedImages && path.extname(file).toLowerCase() === ".avif") {
      removedOutdated += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    const { originalName, size } = parseCacheFileName(file);
    const originalFile = path.join(albumDir, originalName);

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

  return { removedStale, removedUnneeded, removedChanged, removedOutdated };
};

const cleanupVideoCache = ({ albumDir, publicAlbumDir }) => {
  const resizedDir = path.join(publicAlbumDir, RESIZED_VIDEO_DIR);

  if (!isDirectory(resizedDir)) {
    return { removedStale: 0, removedUnneeded: 0, removedChanged: 0 };
  }

  let removedStale = 0;
  let removedUnneeded = 0;
  let removedChanged = 0;

  for (const file of fs.readdirSync(resizedDir)) {
    const cachedFile = path.join(resizedDir, file);
    const { originalName, size } = parseCacheFileName(file);
    const originalFile = path.join(albumDir, originalName);

    if (!fs.existsSync(originalFile)) {
      removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (hasSourceChangedSinceCache(originalFile, cachedFile)) {
      removedChanged += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (
      VIDEO_EXTENSIONS.has(path.extname(originalFile).toLowerCase()) &&
      size !== OPTIMISED_VIDEO_MAX_WIDTH
    ) {
      removedUnneeded += removeFileIfExists(cachedFile) ? 1 : 0;
    }
  }

  return { removedStale, removedUnneeded, removedChanged };
};

// listDirectories(albumsDir) only ever sees albums that still exist, so a
// deleted album's `public/data/albums/<name>/.resized_images` and
// `.resized_videos` caches are never visited by the per-album loop above and
// ship forever. Walk the public albums dir separately and remove the media
// caches for any name that no longer has a matching source album.
// Conservative: only the two known cache directories are ever deleted, plus
// the now-empty public album directory if nothing else remains in it — no
// other content.
const removeOrphanedAlbumMediaCaches = ({ publicAlbumsDir, albumNames }) => {
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
    removedStaleVideos: 0,
    removedChangedVideos: 0,
    removedUnneededVideoSizes: 0,
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
    totals.removedStaleVideos += videoResults.removedStale;
    totals.removedChangedVideos += videoResults.removedChanged;
    totals.removedUnneededVideoSizes += videoResults.removedUnneeded;
  }

  totals.removedOrphanedAlbums = removeOrphanedAlbumMediaCaches({
    publicAlbumsDir,
    albumNames,
  });

  if (!imageCacheConfigIsCurrent && albumNames.length > 0) {
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
