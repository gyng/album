/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { cleanupOptimisedMedia } = require("./cleanup-optimised-media.cjs");

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

    for (const file of [staleImage, oldImageSize, keptImage, staleVideo, oldVideoSize, keptVideo]) {
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

  it("keeps cache files whose original name contains '@'", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-at-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });

    const source = path.join(albumDir, "me@beach.jpg");
    const keptCache = path.join(imageCacheDir, "me@beach.jpg@800.avif");
    const unneededCache = path.join(imageCacheDir, "me@beach.jpg@999.avif");
    fs.writeFileSync(source, "image");
    fs.writeFileSync(keptCache, "cached");
    fs.writeFileSync(unneededCache, "cached");

    const older = new Date("2020-01-01T00:00:00.000Z");
    const newer = new Date("2020-01-02T00:00:00.000Z");
    fs.utimesSync(source, older, older);
    fs.utimesSync(keptCache, newer, newer);
    fs.utimesSync(unneededCache, newer, newer);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    // Original name resolves correctly, so the valid 800px variant survives and
    // is never flagged as stale; only the genuinely unneeded 999px size goes.
    expect(fs.existsSync(keptCache)).toBe(true);
    expect(fs.existsSync(unneededCache)).toBe(false);
    expect(summary.removedStaleImages).toBe(0);
    expect(summary.removedUnneededImageSizes).toBe(1);
  });

  it("does not invalidate the cache when only the source ctime changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-ctime-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });

    const source = path.join(albumDir, "kept.jpg");
    const cached = path.join(imageCacheDir, "kept.jpg@800.avif");
    fs.writeFileSync(source, "image");
    fs.writeFileSync(cached, "cached");

    const stamp = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(source, stamp, stamp);
    fs.utimesSync(cached, stamp, stamp);

    // A chmod bumps ctime to now but leaves mtime untouched (as chmod/chown or
    // an rsync over albums/ would). Content is unchanged, so the cache stays.
    fs.chmodSync(source, 0o644);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedChangedImages).toBe(0);
    expect(fs.existsSync(cached)).toBe(true);
  });

  it("returns an empty summary for missing roots and absent cache directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-empty-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");

    await expect(cleanupOptimisedMedia({ albumsDir, publicAlbumsDir })).resolves.toEqual({
      albumsScanned: 0,
      removedStaleImages: 0,
      removedChangedImages: 0,
      removedUnneededImageSizes: 0,
      removedStaleVideos: 0,
      removedChangedVideos: 0,
      removedUnneededVideoSizes: 0,
    });

    fs.mkdirSync(path.join(albumsDir, "trip"), { recursive: true });
    await expect(cleanupOptimisedMedia({ albumsDir, publicAlbumsDir })).resolves.toMatchObject({
      albumsScanned: 1,
      removedStaleImages: 0,
      removedStaleVideos: 0,
    });
  });

  it("parses cache names without a size suffix", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-no-size-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "orphan"), "source");
    const cache = path.join(imageCacheDir, "orphan.avif");
    fs.writeFileSync(cache, "cache");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedUnneededImageSizes).toBe(1);
    expect(fs.existsSync(cache)).toBe(false);
  });

  it("tolerates cache files disappearing concurrently for every removal reason", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-race-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "changed.jpg"), "source");
    fs.writeFileSync(path.join(albumDir, "unneeded.jpg"), "source");
    fs.writeFileSync(path.join(albumDir, "changed.mp4"), "source");
    fs.writeFileSync(path.join(albumDir, "unneeded.mp4"), "source");
    const caches = [
      path.join(imageCacheDir, "missing.jpg@800.avif"),
      path.join(imageCacheDir, "changed.jpg@800.avif"),
      path.join(imageCacheDir, "unneeded.jpg@999.avif"),
      path.join(videoCacheDir, "missing.mp4@1920.mp4"),
      path.join(videoCacheDir, "changed.mp4@1920.mp4"),
      path.join(videoCacheDir, "unneeded.mp4@1280.mp4"),
    ];
    caches.forEach((file) => fs.writeFileSync(file, "cache"));
    const older = new Date("2020-01-01");
    const newer = new Date("2020-01-02");
    fs.utimesSync(caches[1], older, older);
    fs.utimesSync(caches[4], older, older);
    fs.utimesSync(path.join(albumDir, "changed.jpg"), newer, newer);
    fs.utimesSync(path.join(albumDir, "changed.mp4"), newer, newer);
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
      const error = new Error("already gone");
      error.code = "ENOENT";
      throw error;
    });

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(unlink).toHaveBeenCalledTimes(6);
    expect(summary).toMatchObject({
      removedStaleImages: 0,
      removedChangedImages: 0,
      removedUnneededImageSizes: 0,
      removedStaleVideos: 0,
      removedChangedVideos: 0,
      removedUnneededVideoSizes: 0,
    });
    unlink.mockRestore();
  });

  it("propagates unexpected unlink failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-unlink-error-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    fs.mkdirSync(path.join(albumsDir, "trip"), { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "missing.jpg@800.avif"), "cache");
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw error;
    });

    await expect(cleanupOptimisedMedia({ albumsDir, publicAlbumsDir })).rejects.toBe(error);
    unlink.mockRestore();
  });

  it("uses the repository defaults", async () => {
    const exists = jest.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect(cleanupOptimisedMedia()).resolves.toMatchObject({ albumsScanned: 0 });

    exists.mockRestore();
  });
});
