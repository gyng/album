import path from "path";

/**
 * Which files in an album directory are media the build can actually render.
 *
 * Deliberately its own module, free of heavier `services/album` dependencies,
 * so the rule can be imported and tested on its own.
 */

// Formats sharp can decode. Kept in step with PHOTO_EXTENSIONS in
// bin/prepare-optimised-images.cjs — a test pins the two lists together,
// because when they disagreed the prepass skipped a file and the page build
// then handed that same file to sharp, which threw and failed the whole build.
export const PHOTO_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".tif",
  ".tiff",
];

// Mirrors VIDEO_EXTENSIONS in services/video.ts. Duplicated rather than
// imported so this module stays free of the ffmpeg/ffprobe binaries that
// module pulls in; the same test pins them together.
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];

/** Synthetic name written by the YouTube external prepass. */
export const YOUTUBE_EXTENSION = ".youtube";

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  ...PHOTO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  YOUTUBE_EXTENSION,
]);

export const isSupportedMediaFile = (filename: string): boolean =>
  SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(filename).toLowerCase());
