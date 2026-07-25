/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

jest.mock("sharp", () => jest.fn());

const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const {
  prepareOptimisedImages,
  PHOTO_EXTENSIONS,
  TEMP_FILE_SEPARATOR,
  STALE_TEMP_FILE_THRESHOLD_MS,
} = require("./prepare-optimised-images.cjs");

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
  // Pixels the verification pass reads back: the source's, and each encoded
  // file's. Equal by default, so an ordinary encode passes its check.
  samples = { source: [0, 0, 0], encoded: () => [0, 0, 0] },
} = {}) => {
  const avif = jest.fn(() => ({ toFile }));
  const withIccProfile = jest.fn(() => ({ avif }));
  const sampleFor = (input) =>
    jest.fn(async () => Buffer.from(input === undefined ? samples.source : samples.encoded(input)));
  const verifyChain = (input) => ({
    removeAlpha: jest.fn(() => ({ raw: jest.fn(() => ({ toBuffer: sampleFor(input) })) })),
  });
  const resize = jest.fn(() => ({ withIccProfile, ...verifyChain(undefined) }));
  const clone = jest.fn(() => ({ resize }));
  const rotate = jest.fn(() => ({ clone }));
  sharp.mockImplementation((input) => ({
    rotate,
    metadata: () => metadata(input),
    resize: jest.fn(() => verifyChain(input)),
  }));
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
    // Two clones per encoded variant: one to encode from, one for the
    // verification pass that reads the result back and compares it.
    expect(pipeline.clone).toHaveBeenCalledTimes(4);
    expect(pipeline.resize).toHaveBeenCalledTimes(4);
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

  it("rejects an encode whose pixels do not match the source, and retries it", async () => {
    // The failure this exists for: an encoder that returns success and writes a
    // complete file whose contents are garbage. It decodes without error — the
    // shipped one did — so the only way to catch it is to look at the pixels.
    // Measured on the real corrupt file: ~90 per channel against the source,
    // where a good encode sits at 0-5 even when it is an upscale.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-garbage-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "photo.jpg"), "source");

    let attempts = 0;
    mockSharpPipeline({
      toFile: jest.fn(async (output) => {
        attempts += 1;
        fs.writeFileSync(output, "generated");
        return { width: 800, height: 600 };
      }),
      samples: {
        source: [10, 10, 10],
        // Every first attempt comes back as garbage; the retry is clean.
        encoded: () => (attempts % 2 === 1 ? [250, 10, 250] : [10, 10, 10]),
      },
    });

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    // Three variants, each rejected once and re-encoded: six writes, no
    // failures, and nothing corrupt left in the cache.
    expect(attempts).toBe(6);
    expect(summary.variantsEncoded).toBe(3);
    expect(summary.failures).toEqual([]);
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    expect(listTempFiles(cacheDir)).toEqual([]);
  });

  it("gives up on a variant that keeps encoding to the wrong pixels", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-garbage-persist-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "photo.jpg"), "source");

    mockSharpPipeline({
      samples: { source: [10, 10, 10], encoded: () => [250, 10, 250] },
    });

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    // Reported rather than published: a missing size is recoverable, a corrupt
    // one that decodes is not.
    expect(summary.variantsEncoded).toBe(0);
    expect(summary.failures).toHaveLength(3);
    expect(summary.failures[0].message).toMatch(/does not match its source/i);
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    expect(fs.existsSync(path.join(cacheDir, "photo.jpg@800.avif"))).toBe(false);
    expect(listTempFiles(cacheDir)).toEqual([]);
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
    const sampleChain = (pixels) => ({
      resize: () => ({
        removeAlpha: () => ({ raw: () => ({ toBuffer: async () => Buffer.from(pixels) }) }),
      }),
    });
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
    // Each clone serves both callers: the encode chain, and the verification
    // pass that samples the source's pixels to compare against the encode.
    const succeedingAvifPipeline = {
      rotate: () => ({
        clone: () => ({
          ...sampleChain([0, 0, 0]),
          resize: () => ({
            ...sampleChain([0, 0, 0]).resize(),
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
      // Reading an encoded file back for verification, or a cached file's
      // metadata.
      return { metadata, ...sampleChain([0, 0, 0]) };
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

  it("reports a synchronous stray-temp-cleanup failure for one variant without abandoning an in-flight sibling variant of the same photo", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-cleanup-throw-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");

    let encodeCalls = 0;
    mockSharpPipeline({
      toFile: jest.fn(async (output) => {
        encodeCalls += 1;
        if (encodeCalls === 1) {
          // Keep the first variant's encode in flight while the second
          // variant's stray-temp-file cleanup throws synchronously below.
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        fs.writeFileSync(output, "generated");
        return { width: 800, height: 600 };
      }),
    });

    const realReaddirSync = fs.readdirSync.bind(fs);
    let cacheDirReaddirCalls = 0;
    const cleanupError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    jest.spyOn(fs, "readdirSync").mockImplementation((dir, opts) => {
      if (dir === cacheDir) {
        cacheDirReaddirCalls += 1;
        // Fail only the second variant's cleanup pass (cleanupStrayTempFiles
        // reads the cache dir once per missing variant) — the first variant's
        // encode is already kicked off by then.
        if (cacheDirReaddirCalls === 2) {
          throw cleanupError;
        }
      }
      return realReaddirSync(dir, opts);
    });

    const summary = await prepareOptimisedImages({ albumsDir, publicAlbumsDir, jobs: 1 });

    // The cleanup failure for one variant is reported alongside the encode
    // failures, not thrown out of the run.
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({
      albumName: "trip",
      filename: "photo.jpg",
      message: cleanupError.message,
    });
    // The sibling variants — including the one already in flight when the
    // cleanup throw happened — were not abandoned and completed normally.
    expect(summary.variantsEncoded).toBe(2);
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

  it("exports the photo-extension allowlist and temp-file constants for reuse by cleanup-optimised-media.cjs", () => {
    expect(PHOTO_EXTENSIONS.has(".jpg")).toBe(true);
    expect(PHOTO_EXTENSIONS.has(".raf")).toBe(false);
    expect(TEMP_FILE_SEPARATOR).toBe(".tmp-");
    expect(STALE_TEMP_FILE_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });
});
