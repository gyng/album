/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { cleanupOptimisedMedia } = require("./cleanup-optimised-media.cjs");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const { STALE_TEMP_FILE_THRESHOLD_MS } = require("./prepare-optimised-images.cjs");

const IMAGE_CACHE_CONFIG_FILE = ".image-optimisation-config.json";

const markImageCacheCurrent = (publicAlbumsDir) => {
  fs.mkdirSync(publicAlbumsDir, { recursive: true });
  fs.writeFileSync(
    path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE),
    JSON.stringify(imageOptimisationConfig),
  );
};

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
    markImageCacheCurrent(publicAlbumsDir);

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

  // A poster frame and its sidecar are named "<video>@poster.jpg"/".json", so
  // the size segment parses as NaN — the same shape the video sweep deletes as
  // an outdated transcode width. They belong to a video that still exists and
  // are what the indexer reads, so they have to survive.
  it("keeps a video's poster frame and sidecar while still removing outdated transcodes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cleanup-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);

    fs.writeFileSync(path.join(albumDir, "kept.jpg"), "image");
    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");

    const poster = path.join(videoCacheDir, "clip.mp4@poster.jpg");
    const sidecar = path.join(videoCacheDir, "clip.mp4@poster.json");
    const orphanPoster = path.join(videoCacheDir, "gone.mp4@poster.jpg");
    const oldVideoSize = path.join(videoCacheDir, "clip.mp4@1280.mp4");

    for (const file of [poster, sidecar, orphanPoster, oldVideoSize]) {
      fs.writeFileSync(file, "cached");
    }

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(poster)).toBe(true);
    expect(fs.existsSync(sidecar)).toBe(true);
    expect(fs.existsSync(orphanPoster)).toBe(false);
    expect(fs.existsSync(oldVideoSize)).toBe(false);
  });

  // Poster display variants deliberately live in the photo cache under the
  // video's filename so that every "@<size>.avif" URL builder addresses them
  // without knowing about videos. The image sweep must read them as legitimate.
  it("keeps a video's poster variants in the image cache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cleanup-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);

    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");

    const posterVariant = path.join(imageCacheDir, "clip.mp4@800.avif");
    const orphanVariant = path.join(imageCacheDir, "gone.mp4@800.avif");
    fs.writeFileSync(posterVariant, "cached");
    fs.writeFileSync(orphanVariant, "cached");

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(posterVariant)).toBe(true);
    expect(fs.existsSync(orphanVariant)).toBe(false);
  });

  // A YouTube external has no file in the album directory — its cache entries
  // are keyed by "<video id>.youtube" — so the manifest is what says whether
  // they are still wanted.
  it("keeps cached externals still declared in the manifest and drops the rest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cleanup-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);

    fs.writeFileSync(path.join(albumDir, "kept.jpg"), "image");
    fs.writeFileSync(
      path.join(albumDir, "album.json"),
      JSON.stringify({
        externals: [{ type: "youtube", href: "https://www.youtube.com/embed/ycyUWULJxdU" }],
      }),
    );

    const keptPoster = path.join(videoCacheDir, "ycyUWULJxdU.youtube@poster.jpg");
    const keptSidecar = path.join(videoCacheDir, "ycyUWULJxdU.youtube@poster.json");
    const keptVariant = path.join(imageCacheDir, "ycyUWULJxdU.youtube@800.avif");
    const removedPoster = path.join(videoCacheDir, "9bw3IL444Uo.youtube@poster.jpg");
    const removedVariant = path.join(imageCacheDir, "9bw3IL444Uo.youtube@800.avif");

    for (const file of [keptPoster, keptSidecar, keptVariant, removedPoster, removedVariant]) {
      fs.writeFileSync(file, "cached");
    }

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(keptPoster)).toBe(true);
    expect(fs.existsSync(keptSidecar)).toBe(true);
    expect(fs.existsSync(keptVariant)).toBe(true);
    expect(fs.existsSync(removedPoster)).toBe(false);
    expect(fs.existsSync(removedVariant)).toBe(false);
  });

  // Per-minute scene frames are named "<video>@t<seconds>", so their cache
  // entries have to be traced back to the clip rather than looked up as files
  // that were never on disk.
  it("keeps a video's scene frames and variants, and drops an orphan clip's", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cleanup-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);

    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");

    const scenePoster = path.join(videoCacheDir, "clip.mp4@t120@poster.jpg");
    const sceneVariant = path.join(imageCacheDir, "clip.mp4@t120@800.avif");
    const orphanScenePoster = path.join(videoCacheDir, "gone.mp4@t120@poster.jpg");
    const orphanSceneVariant = path.join(imageCacheDir, "gone.mp4@t120@800.avif");

    for (const file of [scenePoster, sceneVariant, orphanScenePoster, orphanSceneVariant]) {
      fs.writeFileSync(file, "cached");
    }

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(scenePoster)).toBe(true);
    expect(fs.existsSync(sceneVariant)).toBe(true);
    expect(fs.existsSync(orphanScenePoster)).toBe(false);
    expect(fs.existsSync(orphanSceneVariant)).toBe(false);
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
    markImageCacheCurrent(publicAlbumsDir);

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
    markImageCacheCurrent(publicAlbumsDir);

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
    markImageCacheCurrent(publicAlbumsDir);

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
      removedOutdatedImages: 0,
      removedStaleTempImages: 0,
      removedStaleVideos: 0,
      removedChangedVideos: 0,
      removedUnneededVideoSizes: 0,
      removedStaleTempVideos: 0,
      removedOrphanedAlbums: 0,
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
    markImageCacheCurrent(publicAlbumsDir);
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
    markImageCacheCurrent(publicAlbumsDir);
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
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(cacheDir, "missing.jpg@800.avif"), "cache");
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw error;
    });

    await expect(cleanupOptimisedMedia({ albumsDir, publicAlbumsDir })).rejects.toBe(error);
    unlink.mockRestore();
  });

  it("invalidates image variants when the optimisation settings change", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-config-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const cachedImage = path.join(imageCacheDir, "kept.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "kept.jpg"), "image");
    fs.writeFileSync(cachedImage, "old settings");
    fs.writeFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "old settings");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOutdatedImages).toBe(1);
    expect(fs.existsSync(cachedImage)).toBe(false);
    expect(fs.readFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "utf8")).toBe(
      JSON.stringify(imageOptimisationConfig),
    );
  });

  it("removes the image cache for an album that no longer exists on disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const keptAlbumDir = path.join(albumsDir, "kept");
    const orphanedPublicAlbumDir = path.join(publicAlbumsDir, "deleted-trip");
    const orphanedImageCacheDir = path.join(orphanedPublicAlbumDir, ".resized_images");

    fs.mkdirSync(keptAlbumDir, { recursive: true });
    fs.mkdirSync(orphanedImageCacheDir, { recursive: true });
    // "kept" must actually contain a photo file to count as a real album for
    // the orphan-sweep guard — see the ".stfolder"/hasRealAlbum tests below.
    fs.writeFileSync(path.join(keptAlbumDir, "kept.jpg"), "image");
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(orphanedImageCacheDir, "photo.jpg@800.avif"), "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(1);
    expect(fs.existsSync(orphanedPublicAlbumDir)).toBe(false);
  });

  it("removes both media caches for an orphaned album while keeping unrelated content", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-partial-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const keptAlbumDir = path.join(albumsDir, "kept");
    const orphanedPublicAlbumDir = path.join(publicAlbumsDir, "deleted-trip");
    const orphanedImageCacheDir = path.join(orphanedPublicAlbumDir, ".resized_images");
    const orphanedVideoCacheDir = path.join(orphanedPublicAlbumDir, ".resized_videos");
    const unrelatedFile = path.join(orphanedPublicAlbumDir, "notes.txt");

    // A real (non-test-) album must still exist for the orphan sweep to run
    // at all — see "skips the orphan sweep" tests below. It must also
    // actually contain a photo file (see the hasRealAlbum tests below).
    fs.mkdirSync(keptAlbumDir, { recursive: true });
    fs.mkdirSync(orphanedImageCacheDir, { recursive: true });
    fs.mkdirSync(orphanedVideoCacheDir, { recursive: true });
    fs.writeFileSync(path.join(keptAlbumDir, "kept.jpg"), "image");
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(orphanedImageCacheDir, "photo.jpg@800.avif"), "cached");
    fs.writeFileSync(path.join(orphanedVideoCacheDir, "clip.mp4@1920.mp4"), "cached");
    fs.writeFileSync(unrelatedFile, "keep me");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(1);
    expect(fs.existsSync(orphanedImageCacheDir)).toBe(false);
    expect(fs.existsSync(orphanedVideoCacheDir)).toBe(false);
    // Conservative: only the known cache directories are deleted, so the album
    // directory survives with its unrelated content rather than being
    // recursively wiped.
    expect(fs.existsSync(orphanedPublicAlbumDir)).toBe(true);
    expect(fs.existsSync(unrelatedFile)).toBe(true);
  });

  it("removes the video cache for an orphaned album that has no image cache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-video-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const keptAlbumDir = path.join(albumsDir, "kept");
    const orphanedPublicAlbumDir = path.join(publicAlbumsDir, "deleted-trip");
    const orphanedVideoCacheDir = path.join(orphanedPublicAlbumDir, ".resized_videos");

    // A real (non-test-) album must still exist for the orphan sweep to run
    // at all — see "skips the orphan sweep" tests below. It must also
    // actually contain a photo file (see the hasRealAlbum tests below).
    fs.mkdirSync(keptAlbumDir, { recursive: true });
    fs.mkdirSync(orphanedVideoCacheDir, { recursive: true });
    fs.writeFileSync(path.join(keptAlbumDir, "kept.jpg"), "image");
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(orphanedVideoCacheDir, "clip.mp4@1920.mp4"), "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(1);
    expect(fs.existsSync(orphanedPublicAlbumDir)).toBe(false);
  });

  it("does not touch a public album directory whose source album still exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-not-orphan-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const cachedImage = path.join(imageCacheDir, "kept.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(albumDir, "kept.jpg"), "image");
    fs.writeFileSync(cachedImage, "cached");
    const stamp = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(path.join(albumDir, "kept.jpg"), stamp, stamp);
    fs.utimesSync(cachedImage, stamp, stamp);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(0);
    expect(fs.existsSync(cachedImage)).toBe(true);
  });

  it("skips the orphan sweep and keeps a real album's public cache when only test-* albums are present", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-test-only-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const testAlbumDir = path.join(albumsDir, "test-simple");
    // "snapshots" has no matching source directory here — real albums are
    // gitignored, so a fresh clone / CI checkout with only the committed
    // test-* fixtures looks exactly like this on disk.
    const realPublicAlbumDir = path.join(publicAlbumsDir, "snapshots");
    const realImageCacheDir = path.join(realPublicAlbumDir, ".resized_images");
    const realCachedFile = path.join(realImageCacheDir, "photo.jpg@800.avif");

    fs.mkdirSync(testAlbumDir, { recursive: true });
    fs.mkdirSync(realImageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(realCachedFile, "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(0);
    expect(fs.existsSync(realCachedFile)).toBe(true);
  });

  it("does not treat a non-test directory without any photo file as a real album (Syncthing/NAS/lost+found guard)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-nonalbum-dirs-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    // None of these should count as a "real" album: a Syncthing sync-state
    // directory, a Synology NAS metadata directory, an fsck lost+found, and
    // the committed test-* fixture — none contain a photo file directly.
    const stfolderDir = path.join(albumsDir, ".stfolder");
    const eaDirDir = path.join(albumsDir, "@eaDir");
    const lostFoundDir = path.join(albumsDir, "lost+found");
    const testAlbumDir = path.join(albumsDir, "test-simple");
    const realPublicAlbumDir = path.join(publicAlbumsDir, "snapshots");
    const realImageCacheDir = path.join(realPublicAlbumDir, ".resized_images");
    const realCachedFile = path.join(realImageCacheDir, "photo.jpg@800.avif");

    fs.mkdirSync(stfolderDir, { recursive: true });
    fs.mkdirSync(eaDirDir, { recursive: true });
    fs.mkdirSync(lostFoundDir, { recursive: true });
    fs.mkdirSync(testAlbumDir, { recursive: true });
    fs.mkdirSync(realImageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(realCachedFile, "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(0);
    expect(fs.existsSync(realCachedFile)).toBe(true);
  });

  it("runs the orphan sweep once a non-test directory actually contains a photo file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-real-photo-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const stfolderDir = path.join(albumsDir, ".stfolder");
    const realAlbumDir = path.join(albumsDir, "kept");
    const orphanedPublicAlbumDir = path.join(publicAlbumsDir, "deleted-trip");
    const orphanedImageCacheDir = path.join(orphanedPublicAlbumDir, ".resized_images");

    fs.mkdirSync(stfolderDir, { recursive: true });
    fs.mkdirSync(realAlbumDir, { recursive: true });
    fs.mkdirSync(orphanedImageCacheDir, { recursive: true });
    fs.writeFileSync(path.join(realAlbumDir, "kept.jpg"), "image");
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(orphanedImageCacheDir, "photo.jpg@800.avif"), "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(1);
    expect(fs.existsSync(orphanedPublicAlbumDir)).toBe(false);
  });

  it("does not rewrite the image-cache-config sentinel when only test-* albums are present, even if settings changed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-sentinel-guard-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const testAlbumDir = path.join(albumsDir, "test-simple");

    fs.mkdirSync(testAlbumDir, { recursive: true });
    fs.mkdirSync(publicAlbumsDir, { recursive: true });
    fs.writeFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "old settings");

    await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    // No real album exists to invalidate/re-warm, so the sentinel must stay
    // exactly as it was rather than being stamped "current" — otherwise a
    // real album reappearing later would look already up to date and never
    // get its outdated AVIFs invalidated.
    expect(fs.readFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "utf8")).toBe(
      "old settings",
    );
  });

  it("does not delete anything when the albums directory is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-orphan-no-albums-dir-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const realPublicAlbumDir = path.join(publicAlbumsDir, "snapshots");
    const realImageCacheDir = path.join(realPublicAlbumDir, ".resized_images");
    const realCachedFile = path.join(realImageCacheDir, "photo.jpg@800.avif");

    // albumsDir is never created — simulates a missing or unmounted albums/.
    fs.mkdirSync(realImageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(realCachedFile, "cached");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(summary.removedOrphanedAlbums).toBe(0);
    expect(fs.existsSync(realCachedFile)).toBe(true);
  });

  it("uses the repository defaults", async () => {
    const exists = jest.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect(cleanupOptimisedMedia()).resolves.toMatchObject({ albumsScanned: 0 });

    exists.mockRestore();
  });

  it("never classifies a source photo whose name contains .tmp- as a temp file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-tmpname-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);

    const source = path.join(albumDir, "scan.tmp-final.jpg");
    const cached = path.join(imageCacheDir, "scan.tmp-final.jpg@800.avif");
    fs.writeFileSync(source, "image");
    fs.writeFileSync(cached, "cached");
    // Settle both well past the stale-temp threshold so a misclassification as
    // a temp file would delete the cache entry on every run.
    const older = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(source, older, older);
    fs.utimesSync(cached, older, older);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(cached)).toBe(true);
    expect(summary.removedStaleTempImages).toBe(0);
  });

  it("keeps a fresh in-flight temp file in the resized image dir but removes a stale one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-temp-image-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(albumDir, "photo.jpg"), "image");

    // A fresh in-flight temp file, exactly as photo.ts / prepare-optimised-images.cjs
    // would leave one mid-encode: it must survive because its size segment
    // parses to NaN, which must never be treated as "an unneeded size".
    const freshTemp = path.join(imageCacheDir, "photo.jpg@800.avif.tmp-12345-1");
    fs.writeFileSync(freshTemp, "still being written");

    // A stale temp left behind by a process that died mid-encode.
    const staleTemp = path.join(imageCacheDir, "photo.jpg@1600.avif.tmp-99999-1");
    fs.writeFileSync(staleTemp, "abandoned");
    const old = new Date(Date.now() - STALE_TEMP_FILE_THRESHOLD_MS - 60 * 1000);
    fs.utimesSync(staleTemp, old, old);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(freshTemp)).toBe(true);
    expect(fs.existsSync(staleTemp)).toBe(false);
    expect(summary.removedStaleTempImages).toBe(1);
    // The fresh temp must not be counted as an "unneeded size" removal.
    expect(summary.removedUnneededImageSizes).toBe(0);
  });

  it("keeps a fresh in-flight temp file in the resized video dir but removes a stale one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-temp-video-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");

    const freshTemp = path.join(videoCacheDir, "clip.mp4@1920.mp4.tmp-12345-1");
    fs.writeFileSync(freshTemp, "still being written");

    const staleTemp = path.join(videoCacheDir, "clip.mp4@1280.mp4.tmp-99999-1");
    fs.writeFileSync(staleTemp, "abandoned");
    const old = new Date(Date.now() - STALE_TEMP_FILE_THRESHOLD_MS - 60 * 1000);
    fs.utimesSync(staleTemp, old, old);

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    expect(fs.existsSync(freshTemp)).toBe(true);
    expect(fs.existsSync(staleTemp)).toBe(false);
    expect(summary.removedStaleTempVideos).toBe(1);
    expect(summary.removedUnneededVideoSizes).toBe(0);
  });

  it("tolerates the cached file disappearing between readdir and the changed-since check instead of crashing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-cache-vanish-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "kept.jpg");
    const cached = path.join(imageCacheDir, "kept.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    markImageCacheCurrent(publicAlbumsDir);
    fs.writeFileSync(source, "image");
    fs.writeFileSync(cached, "cached");

    const realStatSync = fs.statSync.bind(fs);
    const statSpy = jest.spyOn(fs, "statSync").mockImplementation((target, ...rest) => {
      if (target === cached) {
        const error = new Error("vanished between readdir and stat");
        error.code = "ENOENT";
        throw error;
      }
      return realStatSync(target, ...rest);
    });

    await expect(cleanupOptimisedMedia({ albumsDir, publicAlbumsDir })).resolves.toMatchObject({
      removedChangedImages: 0,
    });

    statSpy.mockRestore();
  });

  it("counts a symlinked photo file as a real album, keeping the orphan sweep and sentinel stamp active", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-symlink-real-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const realAlbumDir = path.join(albumsDir, "trip");
    const realPhotoStorage = path.join(root, "real-photo-storage", "photo.jpg");
    const orphanedPublicAlbumDir = path.join(publicAlbumsDir, "deleted-trip");
    const orphanedImageCacheDir = path.join(orphanedPublicAlbumDir, ".resized_images");

    fs.mkdirSync(realAlbumDir, { recursive: true });
    fs.mkdirSync(path.dirname(realPhotoStorage), { recursive: true });
    fs.mkdirSync(orphanedImageCacheDir, { recursive: true });
    fs.writeFileSync(realPhotoStorage, "image");
    // The album's only photo is a symlink — directoryHasPhotoFile must resolve
    // it via statSync, not rely on entry.isFile() (false for symlinks).
    fs.symlinkSync(realPhotoStorage, path.join(realAlbumDir, "photo.jpg"));
    fs.writeFileSync(path.join(orphanedImageCacheDir, "photo.jpg@800.avif"), "cached");
    fs.writeFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "old settings");

    const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

    // hasRealAlbum must be true even though the only photo is a symlink: the
    // orphan sweep ran and the sentinel got restamped to the current settings.
    expect(summary.removedOrphanedAlbums).toBe(1);
    expect(fs.existsSync(orphanedPublicAlbumDir)).toBe(false);
    expect(fs.readFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "utf8")).toBe(
      JSON.stringify(imageOptimisationConfig),
    );
  });

  const itUnlessRoot = process.getuid && process.getuid() === 0 ? it.skip : it;

  itUnlessRoot(
    "treats an unreadable album source directory as having no photo instead of crashing predev",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-eacces-"));
      const albumsDir = path.join(root, "albums");
      const publicAlbumsDir = path.join(root, "public", "data", "albums");
      // A single unreadable album, so evaluating it can't be skipped by
      // Array.prototype.some() short-circuiting on some other real album —
      // this deterministically forces directoryHasPhotoFile to hit EACCES.
      const lockedAlbumDir = path.join(albumsDir, "locked");

      fs.mkdirSync(lockedAlbumDir, { recursive: true });
      fs.writeFileSync(path.join(lockedAlbumDir, "photo.jpg"), "image");
      fs.mkdirSync(publicAlbumsDir, { recursive: true });
      fs.writeFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "old settings");
      fs.chmodSync(lockedAlbumDir, 0o000);

      try {
        const summary = await cleanupOptimisedMedia({ albumsDir, publicAlbumsDir });

        expect(summary.albumsScanned).toBe(1);
        // Treated as "no photo here" (not a real album), just like the
        // test-*/`.stfolder`-only scenarios: the sentinel is left untouched
        // rather than being stamped "current" on the strength of a directory
        // whose contents could not actually be verified.
        expect(fs.readFileSync(path.join(publicAlbumsDir, IMAGE_CACHE_CONFIG_FILE), "utf8")).toBe(
          "old settings",
        );
      } finally {
        fs.chmodSync(lockedAlbumDir, 0o700);
      }
    },
  );
});
