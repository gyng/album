import { encodePublicAssetPath } from "./encodePublicAssetPath";
import { clipPathOf } from "./videoScenePath";

/**
 * A clip's web-playable file, written by `optimiseVideo` in `services/video.ts`
 * into the album's own `.resized_videos` cache as `<filename>@1920.mp4`.
 *
 * That module is server-only — it imports `node:fs`, `ffmpeg-static` and
 * `ffprobe-static` — so the browser cannot ask it for the URL. The width and
 * the directory name are repeated here for the same reason the cache sweep and
 * the poster prepass repeat them: three small constants are cheaper than
 * routing every clip URL through the server. Change one, change all of them.
 */
export const OPTIMISED_VIDEO_MAX_WIDTH = 1920;
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
  return encodePublicAssetPath(
    "/" +
      [...clipSrc.split("/").slice(0, -1), RESIZED_VIDEO_DIR, ...clipSrc.split("/").slice(-1)].join(
        "/",
      ) +
      `@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
  );
};
