/**
 * @jest-environment node
 */

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const exifr = require("exifr");
const {
  ALBUM_CONFIG_FILENAME,
  REPORT_FILENAME,
  askYesNo,
  buildAttentionAlbums,
  buildDeploymentInsight,
  buildIndexVerification,
  buildPreflightInsights,
  buildVerificationInsights,
  buildWizardContext,
  calculateAlbumDiagnostics,
  classifyPublishDelta,
  createAlbumReport,
  createPreflightReport,
  dbAll,
  dbClose,
  dbGet,
  defaultRunGit,
  describeDeploymentPlanRow,
  extractPhotoMetadata,
  fetchDeployedSha,
  fileExists,
  formatDuration,
  formatNumber,
  formatPercent,
  getDeployedVersionUrl,
  getIndexerModelInfo,
  hasIndexChanges,
  isDataPath,
  isPhotoFile,
  isVideoFile,
  isZoneIdentifierFile,
  loadDbState,
  nonEmpty,
  openDatabase,
  parseArgs,
  printExecutionPlan,
  printIndentedList,
  printInsightLines,
  printPreflightReport,
  printSection,
  printStatRows,
  printVerificationReport,
  readAlbumFiles,
  readAlbumManifestStatus,
  readLastIndexStats,
  resolveDeploymentDelta,
  runShellCommand,
  shortSha,
  splitLines,
  statusLabel,
  styleText,
  toIsoStringOrNull,
  toPosixPath,
  wallClockStamp,
  writeReport,
} = require("./publish-wizard-lib.cjs");

const healthyMetadata = {
  readable: true,
  hasGps: true,
  latitude: 1,
  longitude: 2,
  capturedAt: "2026-01-01T00:00:00.000Z",
  warnings: [],
};

describe("publish wizard boundary adapters", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exports naming, formatting, path, and file classification contracts", () => {
    expect({ ALBUM_CONFIG_FILENAME, REPORT_FILENAME }).toEqual({
      ALBUM_CONFIG_FILENAME: "album.json",
      REPORT_FILENAME: ".publish-report.json",
    });
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatPercent(49.6)).toBe("50%");
    expect(nonEmpty("  value ")).toBe("value");
    expect(nonEmpty("  ")).toBeNull();
    expect(nonEmpty(12)).toBeNull();
    expect(splitLines(" one \n\n two ")).toEqual(["one", "two"]);
    expect(splitLines(null)).toEqual([]);
    expect(shortSha("123456789")).toBe("1234567");
    expect(shortSha(null)).toBeNull();
    expect(toPosixPath(path.join("one", "two"))).toBe("one/two");
    expect(isPhotoFile("PHOTO.JPEG")).toBe(true);
    expect(isPhotoFile("photo.png")).toBe(false);
    expect(isVideoFile("clip.MOV")).toBe(true);
    expect(isVideoFile("clip.txt")).toBe(false);
    expect(isZoneIdentifierFile("photo.jpg:Zone.Identifier")).toBe(true);
    expect(isZoneIdentifierFile("photo.jpg")).toBe(false);
    expect(isDataPath("albums/trip/a.jpg")).toBe(true);
    expect(isDataPath("src/public/search.sqlite")).toBe(true);
    expect(isDataPath("src/pages/index.tsx")).toBe(false);
  });

  it("checks file accessibility and builds canonical deployment URLs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-files-"));
    const present = path.join(root, "present");
    fs.writeFileSync(present, "x");
    expect(fileExists(present)).toBe(true);
    expect(fileExists(path.join(root, "missing"))).toBe(false);
    expect(getDeployedVersionUrl({ SITE_URL: "http://gallery.test///" })).toBe(
      "http://gallery.test/version.json",
    );
  });

  it("styles and prints status-oriented terminal output", () => {
    const originalTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    expect(styleText("plain", "code")).toBe("plain");
    expect(styleText("plain")).toBe("plain");

    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    expect(styleText("styled", "\u001b[1m")).toContain("\u001b[0m");
    expect(statusLabel("ok")).toContain("[OK]");
    expect(statusLabel("warn")).toContain("[WARN]");
    expect(statusLabel("block")).toContain("[BLOCK]");
    expect(statusLabel("run")).toContain("[RUN]");
    expect(statusLabel("other")).toContain("[INFO]");

    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    printSection("Short");
    printSection("A much longer section heading");
    printStatRows([
      { label: "One", value: "1" },
      { label: "Long label", value: "2", level: "ok" },
    ]);
    printInsightLines([{ text: "Insight" }, { level: "warn", text: "Warning" }]);
    printIndentedList(["one"]);
    printIndentedList(["two"], "! ");
    expect(log).toHaveBeenCalled();
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalTty });
  });

  it("parses every remaining command flag and rejects unknown input", () => {
    expect(parseArgs(["--force", "--skip-pull", "--skip-build"])).toMatchObject({
      force: true,
      skipPull: true,
      skipBuild: true,
    });
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument: --wat");
  });

  it("covers clean and missing database preflight insights", () => {
    const clean = {
      db: {
        exists: false,
        imageCount: 0,
        embeddingsCount: 0,
        hasEmbeddingsTable: false,
        staleEmbeddingCount: 0,
        missingEmbeddingCount: 0,
      },
      summary: {
        newPhotos: 0,
        removedPhotos: 0,
        photosWithoutGps: 0,
        photosMissingExifDate: 0,
        unreadablePhotos: 0,
        invalidAlbums: 0,
      },
      albums: [],
    };
    expect(buildPreflightInsights(clean).map(({ level }) => level)).toEqual(["warn", "ok"]);

    expect(
      buildPreflightInsights({
        ...clean,
        db: { ...clean.db, exists: true, imageCount: 2, hasEmbeddingsTable: false },
      })[0].text,
    ).toContain("no embeddings table");
    expect(
      buildPreflightInsights({
        ...clean,
        db: {
          ...clean.db,
          exists: true,
          staleEmbeddingCount: 2,
          staleEmbeddingModelIds: null,
          expectedEmbeddingModelIds: null,
          currentEmbeddingModelId: null,
        },
      })[2].text,
    ).toContain("unknown → unknown");

    const diagnostics = calculateAlbumDiagnostics({
      newPhotos: [
        { metadata: { readable: true, hasGps: false, capturedAt: null } },
        { metadata: { readable: false, hasGps: false, capturedAt: null } },
      ],
    });
    expect(diagnostics).toEqual({
      unreadablePhotos: 1,
      photosWithoutGps: 1,
      photosMissingExifDate: 1,
    });
    expect(
      buildAttentionAlbums({
        albums: [{ newPhotos: [], removedPhotos: [], warnings: [], blockers: [] }],
      }),
    ).toEqual([]);
  });

  it("describes complete verification, warnings, blockers, and optional embedding coverage", () => {
    const verification = buildIndexVerification({
      discoveredPhotoPaths: [],
      newPhotoPaths: [],
      dbState: {
        exists: true,
        imageCount: 0,
        embeddingsCount: 0,
        hasEmbeddingsTable: false,
        indexedPhotoPaths: new Set(),
        indexedEmbeddingPaths: new Set(),
      },
    });
    expect(verification.ok).toBe(true);
    expect(verification.indexedCoveragePercent).toBe(100);
    expect(verification.newEmbeddingCoveragePercent).toBeNull();
    expect(buildVerificationInsights(verification)[0].level).toBe("ok");

    const enriched = {
      ...verification,
      newPhotoCount: 1,
      missingNewPhotoPaths: [],
      missingEmbeddingPaths: [],
      newPhotoCoveragePercent: 100,
      newEmbeddingCoveragePercent: 100,
      warnings: ["warning"],
      blockers: ["blocker"],
    };
    expect(buildVerificationInsights(enriched).map(({ text }) => text)).toEqual(
      expect.arrayContaining(["warning", "blocker"]),
    );

    const missingDb = buildIndexVerification({
      discoveredPhotoPaths: [],
      newPhotoPaths: [],
      dbState: {
        exists: false,
        imageCount: 0,
        embeddingsCount: 0,
        hasEmbeddingsTable: false,
        indexedPhotoPaths: new Set(),
        indexedEmbeddingPaths: new Set(),
      },
    });
    expect(missingDb.blockers).toContain("search.sqlite is missing after indexing");
  });

  it("handles deployed-version HTTP and payload fallbacks", async () => {
    await expect(
      fetchDeployedSha({
        versionUrl: "https://example/version.json",
        fetchImpl: async () => ({ ok: false, status: 503 }),
      }),
    ).resolves.toMatchObject({ deployedSha: null, reason: expect.stringContaining("503") });
    await expect(
      fetchDeployedSha({
        versionUrl: "https://example/version.json",
        fetchImpl: async () => ({ ok: true, json: async () => ({ buildVersion: " build-sha " }) }),
      }),
    ).resolves.toEqual({ deployedSha: "build-sha", reason: null });
    await expect(
      fetchDeployedSha({
        versionUrl: "https://example/version.json",
        fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      }),
    ).resolves.toMatchObject({ deployedSha: null, reason: expect.stringContaining("no gitSha") });

    const originalAbortSignal = globalThis.AbortSignal;
    Object.defineProperty(globalThis, "AbortSignal", { configurable: true, value: undefined });
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ gitSha: "sha" }) }));
    await expect(fetchDeployedSha({ versionUrl: "url", fetchImpl })).resolves.toMatchObject({
      deployedSha: "sha",
    });
    expect(fetchImpl).toHaveBeenCalledWith("url", {});
    Object.defineProperty(globalThis, "AbortSignal", {
      configurable: true,
      value: originalAbortSignal,
    });
    await expect(
      fetchDeployedSha({
        versionUrl: "url",
        fetchImpl: async () => {
          throw "offline";
        },
      }),
    ).resolves.toMatchObject({ reason: expect.stringContaining("offline") });
  });

  it("handles deployment resolution without fetch, HEAD, or a usable diff", async () => {
    await expect(
      resolveDeploymentDelta({ repoDir: "/repo", versionUrl: "url", fetchImpl: null }),
    ).resolves.toMatchObject({ kind: "unknown", reason: expect.stringContaining("no fetch") });

    const response = async () => ({ ok: true, json: async () => ({ gitSha: "deadbeef" }) });
    const noHead = jest.fn((args) => {
      if (args[0] === "rev-parse") throw new Error("no head");
      if (args[0] === "diff") throw "diff failed";
      return "";
    });
    await expect(
      resolveDeploymentDelta({
        repoDir: "/repo",
        versionUrl: "url",
        fetchImpl: response,
        runGit: noHead,
      }),
    ).resolves.toMatchObject({
      kind: "unknown",
      headSha: null,
      reason: expect.stringContaining("diff failed"),
    });

    const errorDiff = jest.fn((args) => {
      if (args[0] === "rev-parse") return "head";
      if (args[0] === "cat-file") return "";
      throw new Error("broken diff");
    });
    await expect(
      resolveDeploymentDelta({
        repoDir: "/repo",
        versionUrl: "url",
        fetchImpl: response,
        runGit: errorDiff,
      }),
    ).resolves.toMatchObject({ reason: expect.stringContaining("broken diff") });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ gitSha: "not-local" }) });
    try {
      await expect(
        resolveDeploymentDelta({ repoDir: path.resolve(__dirname, "../.."), versionUrl: "url" }),
      ).resolves.toMatchObject({
        kind: "unknown",
        reason: expect.stringContaining("local history"),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runs the default git adapter against the repository", () => {
    const runGit = defaultRunGit(path.resolve(__dirname, "../.."));
    expect(runGit(["rev-parse", "--is-inside-work-tree"]).trim()).toBe("true");
  });

  it("exercises database callback success and failure adapters", async () => {
    await expect(
      dbGet({ get: (_sql, _params, callback) => callback(null, undefined) }, "select"),
    ).resolves.toBeNull();
    await expect(
      dbGet({ get: (_sql, _params, callback) => callback(new Error("get failed")) }, "select"),
    ).rejects.toThrow("get failed");
    await expect(
      dbAll({ all: (_sql, _params, callback) => callback(null, undefined) }, "select"),
    ).resolves.toEqual([]);
    await expect(
      dbAll({ all: (_sql, _params, callback) => callback(new Error("all failed")) }, "select"),
    ).rejects.toThrow("all failed");
    await expect(dbClose({ close: (callback) => callback() })).resolves.toBeUndefined();
    await expect(
      dbClose({ close: (callback) => callback(new Error("close failed")) }),
    ).rejects.toThrow("close failed");
    await expect(
      openDatabase(
        "bad.sqlite",
        class BadDatabase {
          constructor(_path, _mode, callback) {
            callback(new Error("open failed"));
          }
        },
      ),
    ).rejects.toThrow("open failed");
  });

  it("reports missing database state", async () => {
    const missing = path.join(os.tmpdir(), "definitely-missing-publish.sqlite");
    await expect(loadDbState(missing)).resolves.toMatchObject({ exists: false, imageCount: 0 });
  });

  it("reads an embedded embeddings table from the core database", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-embedded-db-"));
    const dbPath = path.join(root, "search.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE images (path TEXT);
      CREATE TABLE embeddings (path TEXT, model_id TEXT);
      INSERT INTO images VALUES ('a.jpg');
      INSERT INTO embeddings VALUES ('a.jpg', 'model');
    `);
    db.close();

    await expect(loadDbState(dbPath)).resolves.toMatchObject({
      imageCount: 1,
      embeddingsCount: 1,
      hasEmbeddingsTable: true,
      embeddingModelCounts: [{ modelId: "model", count: 1 }],
    });
  });

  it("reads album manifests, directory files, dates, and reports", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-album-"));
    expect(readAlbumManifestStatus(root)).toEqual({ exists: false, valid: null, errors: [] });
    fs.writeFileSync(path.join(root, "album.json"), "{}");
    expect(readAlbumManifestStatus(root)).toMatchObject({ exists: true, valid: true });
    fs.writeFileSync(path.join(root, "album.json"), "{");
    expect(readAlbumManifestStatus(root)).toMatchObject({ exists: true, valid: false });
    const read = jest.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw "unreadable manifest";
    });
    expect(readAlbumManifestStatus(root)).toMatchObject({ errors: ["unreadable manifest"] });
    read.mockRestore();
    fs.mkdirSync(path.join(root, "nested"));
    fs.writeFileSync(path.join(root, "photo.jpg"), "photo");
    expect(readAlbumFiles(root)).toEqual(expect.arrayContaining(["album.json", "photo.jpg"]));
    expect(toIsoStringOrNull(null)).toBeNull();
    expect(toIsoStringOrNull("invalid")).toBeNull();
    expect(toIsoStringOrNull(new Date("2026-01-01Z"))).toBe("2026-01-01T00:00:00.000Z");

    const reportPath = path.join(root, "report.json");
    writeReport(reportPath, { ok: true });
    expect(JSON.parse(fs.readFileSync(reportPath, "utf8"))).toEqual({ ok: true });
  });

  it("extracts EXIF fallbacks and degrades parser failures", async () => {
    jest.spyOn(exifr, "parse").mockResolvedValueOnce({
      lat: 1,
      lon: 2,
      CreateDate: "2026-01-01T00:00:00Z",
    });
    await expect(extractPhotoMetadata("photo.jpg")).resolves.toMatchObject({
      readable: true,
      hasGps: true,
      latitude: 1,
      longitude: 2,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    exifr.parse.mockResolvedValueOnce({
      latitude: 3,
      longitude: 4,
      DateTimeOriginal: "2026-02-01T00:00:00Z",
    });
    await expect(extractPhotoMetadata("primary.jpg")).resolves.toMatchObject({
      latitude: 3,
      longitude: 4,
      capturedAt: "2026-02-01T00:00:00.000Z",
    });
    exifr.parse.mockResolvedValueOnce({});
    await expect(extractPhotoMetadata("empty.jpg")).resolves.toMatchObject({
      hasGps: false,
      latitude: null,
      longitude: null,
      capturedAt: null,
    });
    exifr.parse.mockResolvedValueOnce({
      latitude: Number.NaN,
      longitude: null,
      DateTimeDigitized: "bad",
    });
    await expect(extractPhotoMetadata("photo.jpg")).resolves.toMatchObject({
      readable: true,
      hasGps: false,
      latitude: null,
      longitude: null,
      capturedAt: null,
    });
    exifr.parse.mockRejectedValueOnce("unreadable");
    await expect(extractPhotoMetadata("bad.jpg")).resolves.toMatchObject({
      readable: false,
      warnings: ["unreadable"],
    });
  });

  it("creates album and repository preflight reports", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-preflight-"));
    const albumsDir = path.join(root, "albums");
    const albumDir = path.join(albumsDir, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "new.jpg"), "photo");
    fs.writeFileSync(path.join(albumDir, "clip.mp4"), "video");
    fs.writeFileSync(path.join(albumDir, "photo.jpg:Zone.Identifier"), "zone");
    jest.spyOn(exifr, "parse").mockResolvedValue(healthyMetadata);
    const dbState = {
      indexedPhotoPaths: new Set(["../albums/trip/removed.jpg"]),
    };

    const album = await createAlbumReport({ albumDir, albumName: "trip", dbState });
    expect(album).toMatchObject({
      photos: ["new.jpg"],
      videos: ["clip.mp4"],
      removedPhotos: ["../albums/trip/removed.jpg"],
      warnings: [expect.stringContaining("Zone.Identifier")],
    });

    const report = await createPreflightReport({
      albumsDir,
      dbPath: path.join(root, "missing.sqlite"),
      embeddingsDbPath: path.join(root, "missing-embeddings.sqlite"),
      indexDir: null,
      lastIndexStatsPath: null,
      repoDir: null,
    });
    expect(report).toMatchObject({
      deployment: null,
      db: { exists: false },
      summary: { totalAlbums: 1, totalPhotos: 1, newPhotos: 1 },
    });

    const emptyDir = path.join(albumsDir, "empty");
    fs.mkdirSync(emptyDir);
    fs.writeFileSync(path.join(emptyDir, "album.json"), "{");
    jest.spyOn(exifr, "parse").mockRejectedValueOnce(new Error("bad photo"));
    fs.writeFileSync(path.join(emptyDir, "bad.jpg"), "bad");
    const broken = await createAlbumReport({
      albumDir: emptyDir,
      albumName: "empty",
      dbState: { indexedPhotoPaths: new Set() },
    });
    expect(broken.blockers).toEqual(
      expect.arrayContaining([
        "album.json is invalid for empty",
        "one or more new photos could not be read for EXIF/GPS metadata",
      ]),
    );

    const trulyEmpty = path.join(albumsDir, "truly-empty");
    fs.mkdirSync(trulyEmpty);
    await expect(
      createAlbumReport({
        albumDir: trulyEmpty,
        albumName: "truly-empty",
        dbState: { indexedPhotoPaths: new Set() },
      }),
    ).resolves.toMatchObject({ warnings: ["album has no media files"] });
  });

  it("excludes test fixture albums from production preflight discovery", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-test-albums-"));
    const albumsDir = path.join(root, "albums");
    fs.mkdirSync(path.join(albumsDir, "trip"), { recursive: true });
    fs.mkdirSync(path.join(albumsDir, "test-fixture"));
    fs.writeFileSync(path.join(albumsDir, "trip", "real.jpg"), "photo");
    fs.writeFileSync(path.join(albumsDir, "test-fixture", "fixture.jpg"), "photo");
    jest.spyOn(exifr, "parse").mockResolvedValue(healthyMetadata);

    const previousIncludeTestAlbums = process.env.ALBUM_INCLUDE_TEST_ALBUMS;
    delete process.env.ALBUM_INCLUDE_TEST_ALBUMS;

    try {
      const productionReport = await createPreflightReport({
        albumsDir,
        dbPath: path.join(root, "missing.sqlite"),
        embeddingsDbPath: null,
        indexDir: null,
        lastIndexStatsPath: null,
        repoDir: null,
      });
      expect(productionReport.albums.map((album) => album.albumName)).toEqual(["trip"]);

      process.env.ALBUM_INCLUDE_TEST_ALBUMS = "1";
      const fixtureReport = await createPreflightReport({
        albumsDir,
        dbPath: path.join(root, "missing.sqlite"),
        embeddingsDbPath: null,
        indexDir: null,
        lastIndexStatsPath: null,
        repoDir: null,
      });
      expect(fixtureReport.albums.map((album) => album.albumName)).toEqual([
        "test-fixture",
        "trip",
      ]);
    } finally {
      if (previousIncludeTestAlbums === undefined) {
        delete process.env.ALBUM_INCLUDE_TEST_ALBUMS;
      } else {
        process.env.ALBUM_INCLUDE_TEST_ALBUMS = previousIncludeTestAlbums;
      }
    }
  });

  it("derives expected, stale, and missing embedding model health in preflight", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-model-health-"));
    const albumsDir = path.join(root, "albums");
    fs.mkdirSync(albumsDir);
    const loadState = jest.fn(async () => ({
      exists: true,
      dbPath: "db",
      imageCount: 10,
      embeddingsCount: 13,
      hasEmbeddingsTable: true,
      indexedPhotoPaths: new Set(),
      indexedEmbeddingPaths: new Set(),
      embeddingModelCounts: [
        { modelId: "current", count: 7 },
        { modelId: "stale", count: 6 },
      ],
    }));
    const resolveDelta = jest.fn(async () => ({ kind: "data-only" }));

    const report = await createPreflightReport({
      albumsDir,
      dbPath: "db",
      embeddingsDbPath: "embeddings",
      indexDir: "/index",
      lastIndexStatsPath: null,
      repoDir: "/repo",
      deployedVersionUrl: "https://example/version.json",
      loadState,
      getModelInfo: () => ({ embeddingModelIds: ["current", "missing"] }),
      resolveDelta,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(report.db).toMatchObject({
      expectedEmbeddingModelIds: ["current", "missing"],
      staleEmbeddingCount: 6,
      staleEmbeddingModelIds: ["stale"],
      missingEmbeddingCount: 10,
    });
    expect(resolveDelta).toHaveBeenCalledWith({
      repoDir: "/repo",
      versionUrl: "https://example/version.json",
    });

    const single = await createPreflightReport({
      albumsDir,
      dbPath: "db",
      embeddingsDbPath: null,
      indexDir: "/index",
      lastIndexStatsPath: null,
      repoDir: null,
      loadState,
      getModelInfo: () => ({ embeddingModelId: "current" }),
    });
    expect(single.db.expectedEmbeddingModelIds).toEqual(["current"]);
    expect(single.db.currentEmbeddingModelId).toBe("current");

    const fallbackUrl = await createPreflightReport({
      albumsDir,
      dbPath: "db",
      embeddingsDbPath: null,
      indexDir: null,
      lastIndexStatsPath: null,
      repoDir: "/repo",
      loadState,
      resolveDelta,
    });
    expect(fallbackUrl.deployment).toEqual({ kind: "data-only" });
    expect(resolveDelta).toHaveBeenLastCalledWith({
      repoDir: "/repo",
      versionUrl: "https://photos.awoo.party/version.json",
    });
  });

  it("flags model info as unavailable in the report rather than silently reporting clean zeros", async () => {
    // Regression: when the indexer query fails (including its timeout), the old
    // code fell back to expectedEmbeddingModelIds = [] and forced stale/missing
    // counts to 0 — the printed report looked green with no trace beyond a
    // scrollable console.warn, so a publish after a model change proceeded
    // unflagged. The report itself must carry the unavailability.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-model-unavailable-"));
    const albumsDir = path.join(root, "albums");
    fs.mkdirSync(albumsDir);
    const loadState = jest.fn(async () => ({
      exists: true,
      dbPath: "db",
      imageCount: 10,
      embeddingsCount: 10,
      hasEmbeddingsTable: true,
      indexedPhotoPaths: new Set(),
      indexedEmbeddingPaths: new Set(),
      embeddingModelCounts: [{ modelId: "current", count: 10 }],
    }));

    const report = await createPreflightReport({
      albumsDir,
      dbPath: "db",
      embeddingsDbPath: null,
      indexDir: "/index",
      lastIndexStatsPath: null,
      repoDir: null,
      loadState,
      getModelInfo: () => null,
    });

    expect(report.db).toMatchObject({
      modelInfoUnavailable: true,
      expectedEmbeddingModelIds: [],
      staleEmbeddingCount: 0,
      missingEmbeddingCount: 0,
    });

    const insights = buildPreflightInsights(report);
    expect(insights).toContainEqual(
      expect.objectContaining({
        level: "warn",
        text: expect.stringContaining("skipped (model info unavailable)"),
      }),
    );
  });

  it("treats a not-configured indexer as quiet, distinct from a failed model-info query", async () => {
    // Regression: a run with no indexer configured (indexDir falsy) reused the
    // same modelInfoUnavailable flag as an attempted-and-failed query, so
    // every publish without an indexer emitted the loud "checks skipped"
    // warning even though nothing was ever attempted.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-no-indexer-"));
    const albumsDir = path.join(root, "albums");
    fs.mkdirSync(albumsDir);
    const loadState = jest.fn(async () => ({
      exists: true,
      dbPath: "db",
      imageCount: 10,
      embeddingsCount: 10,
      hasEmbeddingsTable: true,
      indexedPhotoPaths: new Set(),
      indexedEmbeddingPaths: new Set(),
      embeddingModelCounts: [{ modelId: "current", count: 10 }],
    }));
    const getModelInfo = jest.fn(() => null);

    const report = await createPreflightReport({
      albumsDir,
      dbPath: "db",
      embeddingsDbPath: null,
      indexDir: null,
      lastIndexStatsPath: null,
      repoDir: null,
      loadState,
      getModelInfo,
    });

    expect(getModelInfo).not.toHaveBeenCalled();
    expect(report.db).toMatchObject({
      modelInfoUnavailable: false,
      expectedEmbeddingModelIds: [],
      staleEmbeddingCount: 0,
      missingEmbeddingCount: 0,
    });

    const insights = buildPreflightInsights(report);
    expect(insights).not.toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining("skipped (model info unavailable)"),
      }),
    );
  });

  it("queries indexer model metadata and handles command failures", () => {
    expect(
      getIndexerModelInfo("/index", () => Buffer.from('{"embeddingModelId":"model"}')),
    ).toEqual({ embeddingModelId: "model" });
    expect(
      getIndexerModelInfo("/index", () =>
        Buffer.from('cwd:\t/index\n{"embeddingModelId":"model"}\n'),
      ),
    ).toEqual({ embeddingModelId: "model" });
    expect(
      getIndexerModelInfo("/index", () =>
        Buffer.from('cwd:\t/index\n{\n  "embeddingModelIds": ["v1", "v2"]\n}\n"done"\n'),
      ),
    ).toEqual({ embeddingModelIds: ["v1", "v2"] });
    const invalidWarn = jest.fn();
    expect(
      getIndexerModelInfo("/index", () => Buffer.from('{"status":"ready"}\n'), invalidWarn),
    ).toBeNull();
    expect(invalidWarn).toHaveBeenCalledWith(expect.stringContaining("no valid model metadata"));
    const warn = jest.fn();
    expect(
      getIndexerModelInfo(
        "/index",
        () => {
          throw "failed";
        },
        warn,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(
      getIndexerModelInfo(
        "/index",
        () => {
          throw new Error("failed error");
        },
        warn,
      ),
    ).toBeNull();
  });

  it("gives the indexer's model-info query a longer, but still bounded, timeout", () => {
    // A cold `uv run` can exceed 10s; that false timeout used to degrade a
    // safety check (see the "flags model info as unavailable" test above), so
    // the budget was raised. It must still be a hard cap, not unbounded.
    const run = jest.fn(() => Buffer.from('{"embeddingModelId":"model"}'));
    getIndexerModelInfo("/index", run);
    expect(run).toHaveBeenCalledWith(
      "uv run index.py model-info",
      expect.objectContaining({ cwd: "/index", timeout: expect.any(Number) }),
    );
    const [, options] = run.mock.calls[0];
    expect(options.timeout).toBeGreaterThan(10000);
    expect(options.timeout).toBeLessThanOrEqual(30000);
  });

  it("reads optional index stats safely", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-stats-"));
    const stats = path.join(root, "stats.json");
    expect(readLastIndexStats(null)).toBeNull();
    expect(readLastIndexStats(stats)).toBeNull();
    fs.writeFileSync(stats, '{"medianAnalysisMs":12}');
    expect(readLastIndexStats(stats)).toEqual({ medianAnalysisMs: 12 });
    fs.writeFileSync(stats, "{");
    expect(readLastIndexStats(stats)).toBeNull();
  });

  it("supports every yes/no answer path and always closes the prompt", async () => {
    expect(await askYesNo({ prompt: "Proceed?", defaultValue: true, yes: true })).toBe(true);
    const readline = require("readline/promises");
    const original = readline.createInterface;
    const answers = ["", "yes", "n"];
    const close = jest.fn();
    readline.createInterface = () => ({ question: async () => answers.shift(), close });
    try {
      await expect(askYesNo({ prompt: "Proceed?", defaultValue: false, yes: false })).resolves.toBe(
        false,
      );
      await expect(askYesNo({ prompt: "Proceed?", defaultValue: false, yes: false })).resolves.toBe(
        true,
      );
      await expect(askYesNo({ prompt: "Proceed?", defaultValue: true, yes: false })).resolves.toBe(
        false,
      );
      expect(close).toHaveBeenCalledTimes(3);
    } finally {
      readline.createInterface = original;
    }
  });

  it("resolves index-only, skipped-build, forced-deploy, and no-change plans", async () => {
    const baseArgs = {
      yes: true,
      fastTrack: true,
      indexOnly: false,
      skipBuild: false,
      deploy: false,
    };
    const noChanges = {
      summary: { newPhotos: 0, removedPhotos: 0 },
      db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0 },
    };
    await expect(
      require("./publish-wizard-lib.cjs").resolveExecutionPlan({
        args: baseArgs,
        report: noChanges,
      }),
    ).resolves.toEqual({ runIndex: false, runBuild: true, runDeploy: false });
    await expect(
      require("./publish-wizard-lib.cjs").resolveExecutionPlan({
        args: { ...baseArgs, indexOnly: true },
        report: { ...noChanges, summary: { newPhotos: 1, removedPhotos: 0 } },
      }),
    ).resolves.toEqual({ runIndex: true, runBuild: false, runDeploy: false });
    await expect(
      require("./publish-wizard-lib.cjs").resolveExecutionPlan({
        args: { ...baseArgs, skipBuild: true, deploy: false },
        report: noChanges,
      }),
    ).resolves.toEqual({ runIndex: false, runBuild: false, runDeploy: false });
    await expect(
      require("./publish-wizard-lib.cjs").resolveExecutionPlan({
        args: { ...baseArgs, deploy: true },
        report: noChanges,
      }),
    ).resolves.toEqual({ runIndex: false, runBuild: true, runDeploy: true });
  });

  it("runs shell commands through success, exit failure, and spawn errors", async () => {
    const makeSpawn = (event, value) => () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit(event, value));
      return child;
    };
    const times = [0, 1250];
    const log = jest.fn();
    await expect(
      runShellCommand({
        command: "true",
        cwd: "/tmp",
        spawnImpl: makeSpawn("exit", 0),
        now: () => times.shift(),
        log,
      }),
    ).resolves.toBeUndefined();
    await expect(
      runShellCommand({ command: "false", cwd: "/tmp", spawnImpl: makeSpawn("exit", 2), log }),
    ).rejects.toThrow("Command failed (2): false");
    await expect(
      runShellCommand({
        command: "missing",
        cwd: "/tmp",
        spawnImpl: makeSpawn("error", new Error("spawn failed")),
        log,
      }),
    ).rejects.toThrow("spawn failed");

    const defaultLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(runShellCommand({ command: "true", cwd: "/tmp" })).resolves.toBeUndefined();
    expect(defaultLog).toHaveBeenCalled();
  });

  it("formats durations, deployment rows, and wizard paths", () => {
    expect(formatDuration(45)).toBe("~45s");
    expect(formatDuration(120)).toBe("~2min");
    expect(formatDuration(3720)).toBe("~1h 2min");
    expect(describeDeploymentPlanRow(null)).toBeNull();
    expect(describeDeploymentPlanRow({ kind: "code", codeFiles: ["a"] })).toMatchObject({
      level: "info",
    });
    expect(describeDeploymentPlanRow({ kind: "data-only" })).toMatchObject({ level: "ok" });
    expect(describeDeploymentPlanRow({ kind: "unknown" })).toMatchObject({ level: "warn" });
    const context = buildWizardContext({ srcDir: "/repo/src" });
    expect(context).toMatchObject({
      repoDir: "/repo",
      reportPath: "/repo/src/.publish-report.json",
    });
    expect(hasIndexChanges({ summary: { newPhotos: 0, removedPhotos: 0 } })).toBe(false);
    expect(getDeployedVersionUrl()).toMatch(/\/version\.json$/);
    expect(wallClockStamp()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const timezone = jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(60);
    expect(wallClockStamp()).toContain("-01:00");
    timezone.mockRestore();
  });

  it("prints preflight, verification, and execution-plan variants", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const baseSummary = {
      totalAlbums: 1,
      totalPhotos: 7,
      totalVideos: 1,
      newPhotos: 7,
      removedPhotos: 1,
      photosWithGps: 1,
      photosWithoutGps: 1,
      photosMissingExifDate: 1,
      unreadablePhotos: 1,
      invalidAlbums: 1,
    };
    const newPhotos = Array.from({ length: 7 }, (_, index) => ({
      filename: `${index}.jpg`,
      metadata:
        index === 0
          ? { readable: false, hasGps: false, capturedAt: null }
          : { readable: true, hasGps: index % 2 === 0, capturedAt: index === 1 ? null : "date" },
    }));
    const report = {
      summary: baseSummary,
      db: {
        exists: true,
        imageCount: 10,
        embeddingsCount: 5,
        hasEmbeddingsTable: true,
        staleEmbeddingCount: 0,
        missingEmbeddingCount: 0,
      },
      deployment: {
        kind: "code",
        deployedSha: "123456789",
        codeFiles: Array.from({ length: 10 }, (_, index) => `src/${index}.ts`),
      },
      albums: [
        {
          albumName: "trip",
          newPhotos,
          removedPhotos: ["old"],
          warnings: ["warning"],
          blockers: ["blocker"],
        },
      ],
      lastIndexStats: { medianAnalysisMs: 2000 },
    };
    printPreflightReport(report);

    const verification = {
      imageCount: 5,
      embeddingsCount: 2,
      indexedCoveragePercent: 50,
      ok: false,
      discoveredPhotoCount: 2,
      newPhotoCount: 1,
      missingPhotoPaths: ["a"],
      missingNewPhotoPaths: ["a"],
      missingEmbeddingPaths: ["a"],
      newPhotoCoveragePercent: 0,
      newEmbeddingCoveragePercent: 0,
      warnings: [],
      blockers: [],
    };
    printVerificationReport(verification);

    printExecutionPlan({
      args: { fastTrack: true, skipBuild: false, deploy: false },
      report,
      plan: { runIndex: true, runBuild: true, runDeploy: true },
    });
    printExecutionPlan({
      args: { fastTrack: false, skipBuild: true, deploy: true },
      report: {
        ...report,
        deployment: null,
        summary: { ...baseSummary, newPhotos: 0, removedPhotos: 0 },
        db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0 },
        lastIndexStats: null,
      },
      plan: { runIndex: false, runBuild: false, runDeploy: true },
    });
    expect(log).toHaveBeenCalled();
  });

  it("shows the index step as unknown, not clean, when model info is unavailable", () => {
    // Regression: hasIndexChanges saw forced-zero embedding counts and
    // printExecutionPlan rendered a clean "not needed" at info level even
    // though the underlying model-info query failed or timed out.
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    printExecutionPlan({
      args: { fastTrack: true, skipBuild: false, deploy: false },
      report: {
        summary: { newPhotos: 0, removedPhotos: 0 },
        db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0, modelInfoUnavailable: true },
        deployment: null,
        lastIndexStats: null,
      },
      plan: { runIndex: false, runBuild: true, runDeploy: false },
    });

    const indexRow = log.mock.calls.map((args) => args[0]).find((line) => line.includes("Index update"));
    expect(indexRow).toContain("unknown — model info unavailable");
    expect(indexRow).toContain("[WARN]");
    expect(indexRow).not.toContain("not needed");
    log.mockRestore();
  });

  it("prints a clean preflight with no attention albums", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    printPreflightReport({
      summary: {
        totalAlbums: 0,
        totalPhotos: 0,
        totalVideos: 0,
        newPhotos: 0,
        removedPhotos: 0,
        photosWithGps: 0,
        photosWithoutGps: 0,
        photosMissingExifDate: 0,
        unreadablePhotos: 0,
        invalidAlbums: 0,
      },
      db: { exists: false, staleEmbeddingCount: 0, missingEmbeddingCount: 0 },
      deployment: null,
      albums: [],
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No album-level issues"));
  });

  it("prints warning-only, info-only, clean verification, and declined plan variants", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const summary = {
      totalAlbums: 2,
      totalPhotos: 1,
      totalVideos: 0,
      newPhotos: 1,
      removedPhotos: 0,
      photosWithGps: 1,
      photosWithoutGps: 0,
      photosMissingExifDate: 0,
      unreadablePhotos: 0,
      invalidAlbums: 0,
    };
    const report = {
      summary,
      db: {
        exists: true,
        imageCount: 1,
        embeddingsCount: 1,
        hasEmbeddingsTable: true,
        staleEmbeddingCount: 0,
        missingEmbeddingCount: 0,
      },
      deployment: { kind: "data-only", deployedSha: "1234567", codeFiles: [] },
      albums: [
        {
          albumName: "warning",
          newPhotos: [],
          removedPhotos: [],
          warnings: ["warning"],
          blockers: [],
        },
        {
          albumName: "new",
          newPhotos: [{ filename: "a.jpg", metadata: healthyMetadata }],
          removedPhotos: [],
          warnings: [],
          blockers: [],
        },
      ],
      lastIndexStats: null,
    };
    printPreflightReport(report);
    printVerificationReport({
      imageCount: 1,
      embeddingsCount: 1,
      indexedCoveragePercent: 100,
      ok: true,
      discoveredPhotoCount: 1,
      newPhotoCount: 0,
      missingPhotoPaths: [],
      missingNewPhotoPaths: [],
      missingEmbeddingPaths: [],
      newPhotoCoveragePercent: 100,
      newEmbeddingCoveragePercent: null,
      warnings: [],
      blockers: [],
    });
    printExecutionPlan({
      args: { fastTrack: true, skipBuild: false, deploy: false },
      report,
      plan: { runIndex: false, runBuild: false, runDeploy: false },
    });
    printExecutionPlan({
      args: { fastTrack: false, skipBuild: false, deploy: false },
      report: { summary: {}, db: {}, deployment: null, lastIndexStats: null },
      plan: { runIndex: false, runBuild: false, runDeploy: false },
    });
    printPreflightReport({
      ...report,
      deployment: { kind: "code", deployedSha: "1234567", codeFiles: ["src/one.ts"] },
    });
    expect(log).toHaveBeenCalled();
  });

  it("covers deployment insight fallbacks and classification input normalisation", () => {
    expect(classifyPublishDelta({ deployedSha: "sha", changedFiles: null })).toMatchObject({
      kind: "data-only",
    });
    expect(
      buildDeploymentInsight({ kind: "data-only", deployedSha: null, codeFiles: [] }).text,
    ).toContain("production");
    expect(buildDeploymentInsight(null).level).toBe("warn");
    expect(
      require("./publish-wizard-lib.cjs").buildDeletedAlbumReports({
        indexedPhotoPaths: new Set(["not-an-album-path", "../albums/gone/a.jpg"]),
        onDiskAlbumNames: [],
      }),
    ).toHaveLength(1);
  });
});
