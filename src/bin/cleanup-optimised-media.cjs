const fs = require("node:fs");
const path = require("node:path");

const OPTIMISED_IMAGE_SIZES = new Set([3200, 1600, 800]);
const OPTIMISED_VIDEO_MAX_WIDTH = 1920;
const RESIZED_IMAGE_DIR = ".resized_images";
const RESIZED_VIDEO_DIR = ".resized_videos";
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

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
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  fs.unlinkSync(targetPath);
  return true;
};

const hasSourceChangedSinceCache = (sourcePath, cachedPath) => {
  const sourceStat = fs.statSync(sourcePath);
  const cachedStat = fs.statSync(cachedPath);
  const sourceUpdatedAt = Math.max(sourceStat.mtimeMs, sourceStat.ctimeMs);

  return sourceUpdatedAt > cachedStat.mtimeMs;
};

const cleanupImageCache = ({ albumDir, publicAlbumDir }) => {
  const resizedDir = path.join(publicAlbumDir, RESIZED_IMAGE_DIR);

  if (!isDirectory(resizedDir)) {
    return { removedStale: 0, removedUnneeded: 0, removedChanged: 0 };
  }

  let removedStale = 0;
  let removedUnneeded = 0;
  let removedChanged = 0;

  for (const file of fs.readdirSync(resizedDir)) {
    const cachedFile = path.join(resizedDir, file);
    const originalName = path.parse(file).name.split("@")[0];
    const originalFile = path.join(albumDir, originalName);
    const sizeSegment = file.split("@")[1]?.split(".")[0];
    const size = Number(sizeSegment);

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

  return { removedStale, removedUnneeded, removedChanged };
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
    const originalName = path.parse(file).name.split("@")[0];
    const originalFile = path.join(albumDir, originalName);
    const sizeSegment = file.split("@")[1]?.split(".")[0];
    const size = Number(sizeSegment);

    if (!fs.existsSync(originalFile)) {
      removedStale += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (hasSourceChangedSinceCache(originalFile, cachedFile)) {
      removedChanged += removeFileIfExists(cachedFile) ? 1 : 0;
      continue;
    }

    if (VIDEO_EXTENSIONS.has(path.extname(originalFile).toLowerCase()) && size !== OPTIMISED_VIDEO_MAX_WIDTH) {
      removedUnneeded += removeFileIfExists(cachedFile) ? 1 : 0;
    }
  }

  return { removedStale, removedUnneeded, removedChanged };
};

const cleanupOptimisedMedia = async ({
  albumsDir = path.resolve(__dirname, "..", "..", "albums"),
  publicAlbumsDir = path.resolve(__dirname, "..", "public", "data", "albums"),
} = {}) => {
  const albumNames = listDirectories(albumsDir);
  const totals = {
    albumsScanned: albumNames.length,
    removedStaleImages: 0,
    removedChangedImages: 0,
    removedUnneededImageSizes: 0,
    removedStaleVideos: 0,
    removedChangedVideos: 0,
    removedUnneededVideoSizes: 0,
  };

  for (const albumName of albumNames) {
    const albumDir = path.join(albumsDir, albumName);
    const publicAlbumDir = path.join(publicAlbumsDir, albumName);

    const imageResults = cleanupImageCache({ albumDir, publicAlbumDir });
    const videoResults = cleanupVideoCache({ albumDir, publicAlbumDir });

    totals.removedStaleImages += imageResults.removedStale;
    totals.removedChangedImages += imageResults.removedChanged;
    totals.removedUnneededImageSizes += imageResults.removedUnneeded;
    totals.removedStaleVideos += videoResults.removedStale;
    totals.removedChangedVideos += videoResults.removedChanged;
    totals.removedUnneededVideoSizes += videoResults.removedUnneeded;
  }

  return totals;
};

module.exports = {
  cleanupOptimisedMedia,
};

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