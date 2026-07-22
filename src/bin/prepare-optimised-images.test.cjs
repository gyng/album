/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

jest.mock("sharp", () => jest.fn());

const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const { prepareOptimisedImages } = require("./prepare-optimised-images.cjs");

// Builds a single mock object exposing both the metadata-read shape
// (`sharp(cachedFile).metadata()`, used by the cache-validity check) and the
// encode-pipeline shape (`sharp(source).rotate().clone()...avif().toFile()`).
// Real code only ever calls the method relevant to what it passed in, so one
// shared mock covers both call sites without argument-based branching.
const mockSharpPipeline = ({
  metadata = jest.fn(async () => ({ width: 800, height: 600 })),
  toFile = jest.fn(async (output) => {
    fs.writeFileSync(output, "generated");
    return { width: 800, height: 600 };
  }),
} = {}) => {
  const avif = jest.fn(() => ({ toFile }));
  const withIccProfile = jest.fn(() => ({ avif }));
  const resize = jest.fn(() => ({ withIccProfile }));
  const clone = jest.fn(() => ({ resize }));
  const rotate = jest.fn(() => ({ clone }));
  sharp.mockImplementation((input) => ({ rotate, metadata: () => metadata(input) }));
  return { rotate, clone, resize, withIccProfile, avif, toFile, metadata };
};

const listTempFiles = (dir) => fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));

describe("prepareOptimisedImages", () => {
  afterEach(() => {
    sharp.mockReset();
  });

  it("preserves cached variants, atomically encodes only missing sizes, and leaves no temp files behind", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-prepare-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const hiddenAlbumDir = path.join(albumsDir, "test-fixture");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const cached = path.join(cacheDir, "photo.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(hiddenAlbumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(path.join(hiddenAlbumDir, "hidden.jpg"), "source");
    fs.writeFileSync(cached, "keep me");

    const pipeline = mockSharpPipeline();

    const summary = await prepareOptimisedImages({
      albumsDir,
      publicAlbumsDir,
      jobs: 1,
      includeTestAlbums: false,
    });

    expect(summary).toMatchObject({
      photosDiscovered: 1,
      photosEncoded: 1,
      variantsEncoded: 2,
      variantsCached: 1,
    });
    expect(fs.readFileSync(cached, "utf8")).toBe("keep me");
    expect(fs.readFileSync(path.join(cacheDir, "photo.jpg@1600.avif"), "utf8")).toBe("generated");
    expect(fs.readFileSync(path.join(cacheDir, "photo.jpg@3200.avif"), "utf8")).toBe("generated");
    expect(sharp).toHaveBeenCalledWith(source);
    expect(sharp).toHaveBeenCalledWith(cached);
    expect(pipeline.rotate).toHaveBeenCalledTimes(1);
    expect(pipeline.clone).toHaveBeenCalledTimes(2);
    expect(pipeline.resize).toHaveBeenCalledTimes(2);
    expect(pipeline.withIccProfile).toHaveBeenCalledTimes(2);
    expect(pipeline.withIccProfile).toHaveBeenCalledWith(imageOptimisationConfig.iccProfile);
    expect(pipeline.avif).toHaveBeenCalledTimes(2);
    expect(pipeline.avif).toHaveBeenCalledWith(imageOptimisationConfig.avif);
    // Every encode went through "<output>.tmp-<pid>" then fs.renameSync into
    // place: no stray temp siblings should remain once the run finishes.
    expect(listTempFiles(cacheDir)).toEqual([]);
  });

  it("re-encodes a pre-existing zero-byte cache file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-zero-byte-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const zeroByteCache = path.join(cacheDir, "photo.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(zeroByteCache, "");

    mockSharpPipeline();

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    expect(summary.variantsCached).toBe(0);
    expect(summary.variantsEncoded).toBe(3);
    expect(fs.readFileSync(zeroByteCache, "utf8")).toBe("generated");
  });

  it("re-encodes a pre-existing non-empty cache file that fails to decode (truncated/corrupt)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-truncated-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const truncatedCache = path.join(cacheDir, "photo.jpg@800.avif");
    const validCache1600 = path.join(cacheDir, "photo.jpg@1600.avif");
    const validCache3200 = path.join(cacheDir, "photo.jpg@3200.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    // Non-empty but not a decodable AVIF — what an interrupted write from
    // before this fix could have left behind.
    fs.writeFileSync(truncatedCache, "partial-bytes-from-an-interrupted-write");
    fs.writeFileSync(validCache1600, "cached");
    fs.writeFileSync(validCache3200, "cached");

    mockSharpPipeline({
      metadata: jest.fn(async (target) => {
        if (target === truncatedCache) {
          throw new Error("unsupported image format");
        }
        return { width: 800, height: 600 };
      }),
    });

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    expect(summary.variantsCached).toBe(2);
    expect(summary.variantsEncoded).toBe(1);
    expect(fs.readFileSync(truncatedCache, "utf8")).toBe("generated");
    // The genuinely valid cache entries were left untouched.
    expect(fs.readFileSync(validCache1600, "utf8")).toBe("cached");
    expect(fs.readFileSync(validCache3200, "utf8")).toBe("cached");
  });

  it("cleans up a stray temp file left by a previous interrupted run before re-encoding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-stray-temp-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const output = path.join(cacheDir, "photo.jpg@800.avif");
    const strayTemp = `${output}.tmp-99999`;

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(strayTemp, "leftover from a crashed run");
    // Backdate it past the staleness threshold — a crashed run's temp file is
    // old, unlike one a concurrent encoder might still be actively writing.
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(strayTemp, old, old);

    mockSharpPipeline();

    await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    expect(fs.existsSync(strayTemp)).toBe(false);
    expect(fs.readFileSync(output, "utf8")).toBe("generated");
    expect(listTempFiles(cacheDir)).toEqual([]);
  });

  it("does not abort a sibling item's encode when one photo's encode fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-sibling-failure-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const failAlbumDir = path.join(albumsDir, "fails");
    const okAlbumDir = path.join(albumsDir, "succeeds");
    const failCacheDir = path.join(publicAlbumsDir, "fails", ".resized_images");
    const okCacheDir = path.join(publicAlbumsDir, "succeeds", ".resized_images");
    const failSource = path.join(failAlbumDir, "photo.jpg");
    const okSource = path.join(okAlbumDir, "photo.jpg");

    fs.mkdirSync(failAlbumDir, { recursive: true });
    fs.mkdirSync(okAlbumDir, { recursive: true });
    fs.mkdirSync(failCacheDir, { recursive: true });
    fs.mkdirSync(okCacheDir, { recursive: true });
    fs.writeFileSync(failSource, "source");
    fs.writeFileSync(okSource, "source");
    // Pre-cache the 3200/1600 variants for both photos so each only has a
    // single 800px variant left to encode.
    for (const dir of [failCacheDir, okCacheDir]) {
      fs.writeFileSync(path.join(dir, "photo.jpg@3200.avif"), "cached");
      fs.writeFileSync(path.join(dir, "photo.jpg@1600.avif"), "cached");
    }

    const okOutput = path.join(okCacheDir, "photo.jpg@800.avif");
    const encodeError = new Error("boom");
    const metadata = jest.fn(async () => ({ width: 800, height: 600 }));
    const failingAvifPipeline = {
      rotate: () => ({
        clone: () => ({
          resize: () => ({
            withIccProfile: () => ({
              avif: () => ({ toFile: async () => Promise.reject(encodeError) }),
            }),
          }),
        }),
      }),
    };
    const succeedingAvifPipeline = {
      rotate: () => ({
        clone: () => ({
          resize: () => ({
            withIccProfile: () => ({
              avif: () => ({
                toFile: async (output) => {
                  fs.writeFileSync(output, "generated");
                  return { width: 800, height: 600 };
                },
              }),
            }),
          }),
        }),
      }),
    };
    sharp.mockImplementation((input) => {
      if (input === failSource) return failingAvifPipeline;
      if (input === okSource) return succeedingAvifPipeline;
      return { metadata };
    });

    // One photo failing to encode no longer aborts the pool or the overall
    // run: the promise resolves, the sibling photo still gets encoded, and
    // the failure is reported in the summary instead.
    const summary = await prepareOptimisedImages({
      albumsDir,
      publicAlbumsDir,
      jobs: 2,
      includeTestAlbums: false,
    });

    expect(fs.readFileSync(okOutput, "utf8")).toBe("generated");
    expect(listTempFiles(okCacheDir)).toEqual([]);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({ albumName: "fails", filename: "photo.jpg" });
  });

  it("follows symlinked album directories and symlinked photo files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-symlink-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const realAlbumDir = path.join(root, "real-album-storage");
    const realPhotoPath = path.join(root, "real-photo-storage", "photo.jpg");

    fs.mkdirSync(albumsDir, { recursive: true });
    fs.mkdirSync(realAlbumDir, { recursive: true });
    fs.mkdirSync(path.dirname(realPhotoPath), { recursive: true });
    fs.writeFileSync(realPhotoPath, "source");
    fs.symlinkSync(realPhotoPath, path.join(realAlbumDir, "photo.jpg"));
    fs.symlinkSync(realAlbumDir, path.join(albumsDir, "trip"), "dir");

    mockSharpPipeline();

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    expect(summary.photosDiscovered).toBe(1);
    expect(
      fs.existsSync(path.join(publicAlbumsDir, "trip", ".resized_images", "photo.jpg@800.avif")),
    ).toBe(true);
  });

  it("only recognises an allowlist of extensions sharp can decode, case-insensitively", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-extensions-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "photo.jpg"), "source");
    fs.writeFileSync(path.join(albumDir, "photo.png"), "source");
    fs.writeFileSync(path.join(albumDir, "SCREAMING.JPG"), "source");
    fs.writeFileSync(path.join(albumDir, "album.json"), "{}");
    fs.writeFileSync(path.join(albumDir, "ALBUM.JSON"), "{}");
    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "source");
    // A committed RAW fixture (e.g. albums/test-manifest/DSCF2770.RAF) is
    // undecodable by sharp; it must never reach the encoder.
    fs.writeFileSync(path.join(albumDir, "raw.RAF"), "source");
    // A WSL2 NTFS zone-identifier sidecar extracted as a real file.
    fs.writeFileSync(path.join(albumDir, "photo.jpg:Zone.Identifier"), "source");

    mockSharpPipeline();

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    // Only photo.jpg, photo.png, and SCREAMING.JPG are recognised photos.
    expect(summary.photosDiscovered).toBe(3);
  });

  it("skips a RAW file undecodable by sharp without any error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-raw-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "DSCF2770.RAF"), "not a decodable image");

    mockSharpPipeline();

    await expect(
      prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 }),
    ).resolves.toMatchObject({ photosDiscovered: 0, failures: [] });
    // sharp was never even invoked for the RAW file.
    expect(sharp).not.toHaveBeenCalled();
  });

  it("reports a source file that fails to encode in the summary instead of aborting the run", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-corrupt-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "corrupt.jpg");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(source, "not actually a valid jpeg");

    const encodeError = new Error("Input file contains unsupported image format");
    mockSharpPipeline({
      toFile: jest.fn(async () => {
        throw encodeError;
      }),
    });

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    expect(summary.photosDiscovered).toBe(1);
    expect(summary.photosEncoded).toBe(0);
    expect(summary.variantsEncoded).toBe(0);
    expect(summary.failures).toHaveLength(3);
    expect(summary.failures[0]).toMatchObject({
      albumName: "trip",
      filename: "corrupt.jpg",
      message: encodeError.message,
    });
    // No temp files left behind by the failed encodes.
    expect(listTempFiles(cacheDir)).toEqual([]);
  });

  it("keeps a foreign-pid temp file that is still fresh, but removes a stale one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-temp-age-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const output800 = path.join(cacheDir, "photo.jpg@800.avif");
    const output1600 = path.join(cacheDir, "photo.jpg@1600.avif");
    const freshForeignTemp = `${output800}.tmp-99999`;
    const staleForeignTemp = `${output1600}.tmp-88888`;

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(freshForeignTemp, "still being written by another process");
    fs.writeFileSync(staleForeignTemp, "abandoned by a crashed process");
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(staleForeignTemp, old, old);

    mockSharpPipeline();

    await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    // The fresh foreign-pid temp file survives cleanup — it may belong to a
    // concurrent encoder still writing it.
    expect(fs.existsSync(freshForeignTemp)).toBe(true);
    // The stale one (older than the threshold) is cleared out as litter.
    expect(fs.existsSync(staleForeignTemp)).toBe(false);
  });

  it("drains an in-flight encode to completion before rejecting when an unexpected error occurs for a sibling item", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-drain-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const failAlbumDir = path.join(albumsDir, "fails");
    const okAlbumDir = path.join(albumsDir, "succeeds");
    const okCacheDir = path.join(publicAlbumsDir, "succeeds", ".resized_images");
    const failSource = path.join(failAlbumDir, "photo.jpg");
    const okSource = path.join(okAlbumDir, "photo.jpg");

    fs.mkdirSync(failAlbumDir, { recursive: true });
    fs.mkdirSync(okAlbumDir, { recursive: true });
    fs.writeFileSync(failSource, "source");
    fs.writeFileSync(okSource, "source");

    const okOutput = path.join(okCacheDir, "photo.jpg@800.avif");
    // A failure outside any single photo's encode (e.g. mkdirSync failing —
    // disk full, permissions) is still fatal and should abort the pool,
    // unlike a per-file encode failure (see the "reports a source file that
    // fails to encode" test above).
    const mkdirError = new Error("disk full");
    const realMkdirSync = fs.mkdirSync.bind(fs);
    const mkdirSpy = jest.spyOn(fs, "mkdirSync").mockImplementation((dir, opts) => {
      if (typeof dir === "string" && dir.includes(`${path.sep}fails${path.sep}`)) {
        throw mkdirError;
      }
      return realMkdirSync(dir, opts);
    });

    mockSharpPipeline({
      toFile: jest.fn(async (output) => {
        // Give the "succeeds" album's encode time to still be in flight when
        // the "fails" album's mkdirSync throws.
        await new Promise((resolve) => setTimeout(resolve, 20));
        fs.writeFileSync(output, "generated");
        return { width: 800, height: 600 };
      }),
    });

    await expect(
      prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 2, includeTestAlbums: false }),
    ).rejects.toBe(mkdirError);

    // The sibling worker's already-started encode was allowed to finish
    // (drain) rather than being torn down mid-write by an early exit.
    expect(fs.readFileSync(okOutput, "utf8")).toBe("generated");
    expect(listTempFiles(okCacheDir)).toEqual([]);
    mkdirSpy.mockRestore();
  });
});
