/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  cleanupOptimisedMedia,
} = require("./cleanup-optimised-media.cjs");

describe("cleanupOptimisedMedia", () => {
  it("removes stale and outdated cached media variants", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cleanup-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const publicAlbumDir = path.join(publicAlbumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumDir, ".resized_images");
    const videoCacheDir = path.join(publicAlbumDir, ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });

    fs.writeFileSync(path.join(albumDir, "kept.jpg"), "image");
    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");

    const staleImage = path.join(imageCacheDir, "missing.jpg@800.avif");
    const oldImageSize = path.join(imageCacheDir, "kept.jpg@999.avif");
    const keptImage = path.join(imageCacheDir, "kept.jpg@800.avif");
    const staleVideo = path.join(videoCacheDir, "missing.mp4@1920.mp4");
    const oldVideoSize = path.join(videoCacheDir, "clip.mp4@1280.mp4");
    const keptVideo = path.join(videoCacheDir, "clip.mp4@1920.mp4");

    for (const file of [
      staleImage,
      oldImageSize,
      keptImage,
      staleVideo,
      oldVideoSize,
      keptVideo,
    ]) {
      fs.writeFileSync(file, "cached");
    }

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(staleImage)).toBe(false);
    expect(fs.existsSync(oldImageSize)).toBe(false);
    expect(fs.existsSync(keptImage)).toBe(true);
    expect(fs.existsSync(staleVideo)).toBe(false);
    expect(fs.existsSync(oldVideoSize)).toBe(false);
    expect(fs.existsSync(keptVideo)).toBe(true);
  });

  it("removes cached variants when the source file was edited in place", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-edited-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const publicAlbumDir = path.join(publicAlbumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumDir, ".resized_images");
    const videoCacheDir = path.join(publicAlbumDir, ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });

    const sourceImage = path.join(albumDir, "edited.jpg");
    const sourceVideo = path.join(albumDir, "edited.mp4");
    const cachedImage = path.join(imageCacheDir, "edited.jpg@800.avif");
    const cachedVideo = path.join(videoCacheDir, "edited.mp4@1920.mp4");

    fs.writeFileSync(sourceImage, "image-newer");
    fs.writeFileSync(sourceVideo, "video-newer");
    fs.writeFileSync(cachedImage, "cached-older");
    fs.writeFileSync(cachedVideo, "cached-older");

    const older = new Date("2020-01-01T00:00:00.000Z");
    const newer = new Date("2020-01-02T00:00:00.000Z");
    fs.utimesSync(cachedImage, older, older);
    fs.utimesSync(cachedVideo, older, older);
    fs.utimesSync(sourceImage, newer, newer);
    fs.utimesSync(sourceVideo, newer, newer);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedChangedImages).toBe(1);
    expect(summary.removedChangedVideos).toBe(1);
    expect(fs.existsSync(cachedImage)).toBe(false);
    expect(fs.existsSync(cachedVideo)).toBe(false);
  });
});