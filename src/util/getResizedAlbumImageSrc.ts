import { encodePublicAssetPath } from "./encodePublicAssetPath";
import { clipPathOf } from "./videoScenePath";
import videoEncoding from "./videoEncoding.json";

/**
 * A clip's web-playable file, written by `optimiseVideo` in `services/video.ts`
 * into the album's own `.resized_videos` cache as `<filename>@1920-q28.mp4`.
 *
 * That module is server-only — it imports `node:fs`, `ffmpeg-static` and
 * `ffprobe-static` — so the browser cannot ask it for the URL. Shared encoding
 * settings keep browser URLs, generated files and cache cleanup in agreement.
 * The quality suffix also makes browsers fetch a new file after a CRF change.
 */
export const OPTIMISED_VIDEO_MAX_WIDTH = videoEncoding.maxWidth;
export const RESIZED_VIDEO_DIR = ".resized_videos";

export const getResizedAlbumImageSrc = (path: string): string => {
  const imageSrc = path.replace("..", "data");
  return encodePublicAssetPath(
    "/" +
      [
        ...imageSrc.split("/").slice(0, -1),
        ".resized_images",
        ...imageSrc.split("/").slice(-1),
      ].join("/") +
      "@800.avif",
  );
};

/**
 * The playable file for a clip at `path`, whether that path names the clip or
 * one of its per-minute scene rows (`clip.mov@t120`, whose frame lives inside
 * the clip).
 */
export const getResizedAlbumVideoSrc = (path: string): string => {
  const clipSrc = clipPathOf(path).replace("..", "data");
  return `${encodePublicAssetPath(
    "/" +
      [...clipSrc.split("/").slice(0, -1), RESIZED_VIDEO_DIR, ...clipSrc.split("/").slice(-1)].join(
        "/",
      ) +
      `@${OPTIMISED_VIDEO_MAX_WIDTH}-q${videoEncoding.crf}.mp4`,
  )}?metadata=${videoEncoding.metadataVersion}`;
};
