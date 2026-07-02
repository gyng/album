const path = require("path");
const {
  buildAttentionAlbums,
  buildDeletedAlbumReports,
  buildIndexVerification,
  buildPreflightInsights,
  buildSummary,
  buildVerificationInsights,
  getVercelPreflightCommand,
  hasIndexChanges,
  loadDbState,
  parseArgs,
  resolveExecutionPlan,
} = require("./publish-wizard-lib.cjs");

describe("publish-wizard-lib", () => {
  it("parses the supported CLI flags", () => {
    expect(
      parseArgs(["--dry-run", "--yes", "--deploy", "--index-only", "--json"]),
    ).toEqual({
      dryRun: true,
      fastTrack: true,
      yes: true,
      json: true,
      indexOnly: true,
      deploy: true,
      force: false,
      skipPull: false,
      skipBuild: false,
    });
  });

  it("parses the fast-track flag alias", () => {
    expect(parseArgs(["--fast-track"])).toEqual({
      dryRun: false,
      fastTrack: true,
      yes: false,
      json: false,
      indexOnly: false,
      deploy: false,
      force: false,
      skipPull: false,
      skipBuild: false,
    });

    expect(parseArgs(["--fasttrack"])).toEqual({
      dryRun: false,
      fastTrack: true,
      yes: false,
      json: false,
      indexOnly: false,
      deploy: false,
      force: false,
      skipPull: false,
      skipBuild: false,
    });
  });

  it("parses interactive mode as a fast-track opt-out", () => {
    expect(parseArgs(["--interactive"])).toEqual({
      dryRun: false,
      fastTrack: false,
      yes: false,
      json: false,
      indexOnly: false,
      deploy: false,
      force: false,
      skipPull: false,
      skipBuild: false,
    });

    expect(parseArgs(["--step-by-step"])).toEqual({
      dryRun: false,
      fastTrack: false,
      yes: false,
      json: false,
      indexOnly: false,
      deploy: false,
      force: false,
      skipPull: false,
      skipBuild: false,
    });
  });

  it("summarises new photo health across albums", () => {
    const summary = buildSummary([
      {
        photos: ["a.jpg", "b.jpg"],
        videos: ["clip.mp4"],
        removedPhotos: ["../albums/demo/old.jpg"],
        manifest: { exists: true, valid: false },
        warnings: ["warn-a"],
        blockers: ["block-a"],
        newPhotos: [
          {
            metadata: {
              readable: true,
              hasGps: true,
              capturedAt: "2026-03-27T10:00:00.000Z",
            },
          },
          {
            metadata: {
              readable: true,
              hasGps: false,
              capturedAt: null,
            },
          },
          {
            metadata: {
              readable: false,
              hasGps: false,
              capturedAt: null,
            },
          },
        ],
      },
    ]);

    expect(summary).toEqual({
      totalAlbums: 1,
      totalPhotos: 2,
      totalVideos: 1,
      newPhotos: 3,
      removedPhotos: 1,
      photosWithGps: 1,
      photosWithoutGps: 1,
      photosMissingExifDate: 1,
      unreadablePhotos: 1,
      invalidAlbums: 1,
      totalWarnings: 1,
      totalBlockers: 1,
    });
  });

  it("flags missing indexed photos and embeddings", () => {
    const verification = buildIndexVerification({
      discoveredPhotoPaths: [
        "../albums/demo/a.jpg",
        "../albums/demo/b.jpg",
        "../albums/demo/c.jpg",
      ],
      newPhotoPaths: ["../albums/demo/b.jpg", "../albums/demo/c.jpg"],
      dbState: {
        exists: true,
        imageCount: 2,
        embeddingsCount: 1,
        hasEmbeddingsTable: true,
        indexedPhotoPaths: new Set([
          "../albums/demo/a.jpg",
          "../albums/demo/b.jpg",
        ]),
        indexedEmbeddingPaths: new Set(["../albums/demo/b.jpg"]),
      },
    });

    expect(verification.ok).toBe(false);
    expect(verification.missingPhotoPaths).toEqual(["../albums/demo/c.jpg"]);
    expect(verification.missingNewPhotoPaths).toEqual(["../albums/demo/c.jpg"]);
    expect(verification.missingEmbeddingPaths).toEqual(["../albums/demo/c.jpg"]);
    expect(verification.blockers).toContain(
      "1 discovered photos are missing from the images table",
    );
    expect(verification.warnings).toContain(
      "1 newly discovered photos are missing embeddings",
    );
  });

  it("collects a fast-track execution plan up front", async () => {
    const prompts = [];
    const originalPrompt = global.prompt;

    const askSequence = [true, true, false];
    let index = 0;

    const originalCreateInterface = require("readline/promises").createInterface;
    require("readline/promises").createInterface = () => ({
      question: async (prompt) => {
        prompts.push(prompt);
        return askSequence[index++] ? "y" : "n";
      },
      close: () => {},
    });

    try {
      const plan = await resolveExecutionPlan({
        args: {
          dryRun: false,
          fastTrack: true,
          yes: false,
          json: false,
          indexOnly: false,
          deploy: false,
          force: false,
          skipPull: false,
          skipBuild: false,
        },
        report: {
          summary: {
            newPhotos: 2,
            removedPhotos: 0,
          },
        },
      });

      expect(plan).toEqual({
        runIndex: true,
        runBuild: true,
        runDeploy: false,
      });
      expect(prompts).toEqual([
        "Run indexing now? [Y/n] ",
        "If indexing succeeds, build the site afterwards? [Y/n] ",
        "If the build succeeds, deploy the prebuilt output afterwards? [y/N] ",
      ]);
    } finally {
      require("readline/promises").createInterface = originalCreateInterface;
      global.prompt = originalPrompt;
    }
  });

  it("leaves build and deploy undecided in interactive mode", async () => {
    const prompts = [];
    const originalCreateInterface = require("readline/promises").createInterface;
    require("readline/promises").createInterface = () => ({
      question: async (prompt) => {
        prompts.push(prompt);
        return "y";
      },
      close: () => {},
    });

    try {
      const plan = await resolveExecutionPlan({
        args: {
          dryRun: false,
          fastTrack: false,
          yes: false,
          json: false,
          indexOnly: false,
          deploy: false,
          force: false,
          skipPull: false,
          skipBuild: false,
        },
        report: {
          summary: {
            newPhotos: 2,
            removedPhotos: 0,
          },
        },
      });

      expect(plan).toEqual({
        runIndex: true,
        runBuild: false,
        runDeploy: false,
      });
      expect(prompts).toEqual(["Run indexing now? [Y/n] "]);
    } finally {
      require("readline/promises").createInterface = originalCreateInterface;
    }
  });

  it("checks Vercel up front when a fast-track plan builds or deploys", () => {
    const args = {
      indexOnly: false,
      fastTrack: true,
    };

    expect(
      getVercelPreflightCommand({
        args,
        plan: { runIndex: true, runBuild: true, runDeploy: false },
      }),
    ).toBe("npx --yes vercel@latest whoami");

    expect(
      getVercelPreflightCommand({
        args,
        plan: { runIndex: false, runBuild: false, runDeploy: true },
      }),
    ).toBe("npx --yes vercel@latest whoami");
  });

  it("checks Vercel up front in interactive mode before the index step", () => {
    // Interactive mode decides build/deploy *after* the (possibly multi-hour)
    // index, so the plan still shows them as false here. The auth check must
    // still run up front so a logged-out user fails fast, not at `vercel pull`.
    expect(
      getVercelPreflightCommand({
        args: { indexOnly: false, fastTrack: false, skipBuild: false, deploy: false },
        plan: { runIndex: true, runBuild: false, runDeploy: false },
      }),
    ).toBe("npx --yes vercel@latest whoami");
  });

  it("skips the Vercel upfront check for index-only or local-only plans", () => {
    expect(
      getVercelPreflightCommand({
        args: { indexOnly: true },
        plan: { runIndex: true, runBuild: false, runDeploy: false },
      }),
    ).toBeNull();

    // Fast-track plan that has already decided against building and deploying.
    expect(
      getVercelPreflightCommand({
        args: { indexOnly: false, fastTrack: true },
        plan: { runIndex: true, runBuild: false, runDeploy: false },
      }),
    ).toBeNull();

    // Interactive mode with the build explicitly skipped and no forced deploy.
    expect(
      getVercelPreflightCommand({
        args: { indexOnly: false, fastTrack: false, skipBuild: true, deploy: false },
        plan: { runIndex: true, runBuild: false, runDeploy: false },
      }),
    ).toBeNull();
  });

  it("builds richer preflight insights and attention ordering", () => {
    const report = {
      db: {
        exists: true,
        imageCount: 120,
        embeddingsCount: 80,
        hasEmbeddingsTable: true,
      },
      summary: {
        newPhotos: 3,
        removedPhotos: 1,
        photosWithoutGps: 2,
        photosMissingExifDate: 1,
        unreadablePhotos: 1,
        invalidAlbums: 1,
      },
      albums: [
        {
          albumName: "warn-only",
          newPhotos: [
            { filename: "a.jpg", metadata: { readable: true, hasGps: false, capturedAt: null } },
          ],
          removedPhotos: [],
          warnings: ["album has no media files"],
          blockers: [],
        },
        {
          albumName: "blocked",
          newPhotos: [
            { filename: "b.jpg", metadata: { readable: false, hasGps: false, capturedAt: null } },
          ],
          removedPhotos: ["../albums/blocked/old.jpg"],
          warnings: [],
          blockers: ["album.json is invalid for blocked"],
        },
      ],
    };

    const insights = buildPreflightInsights(report);
    const attentionAlbums = buildAttentionAlbums(report);

    expect(insights.map((item) => item.level)).toEqual(
      expect.arrayContaining(["info", "warn", "block"]),
    );
    expect(insights.map((item) => item.text).join(" ")).toContain("missing GPS");
    expect(attentionAlbums.map((item) => item.albumName)).toEqual(["blocked", "warn-only"]);
    expect(attentionAlbums[0].diagnostics.unreadablePhotos).toBe(1);
  });

  it("builds richer verification insights", () => {
    const verification = buildIndexVerification({
      discoveredPhotoPaths: ["../albums/demo/a.jpg", "../albums/demo/b.jpg"],
      newPhotoPaths: ["../albums/demo/b.jpg"],
      dbState: {
        exists: true,
        imageCount: 1,
        embeddingsCount: 0,
        hasEmbeddingsTable: true,
        indexedPhotoPaths: new Set(["../albums/demo/a.jpg"]),
        indexedEmbeddingPaths: new Set(),
      },
    });

    const insights = buildVerificationInsights(verification);

    expect(insights[0]).toEqual({
      level: "block",
      text: "1 discovered photo(s) are missing from the images table.",
    });
    expect(insights.map((item) => item.text).join(" ")).toContain("New-photo index coverage: 0%");
    expect(insights.map((item) => item.text).join(" ")).toContain("embedding coverage");
  });

  describe("hasIndexChanges", () => {
    const base = {
      summary: { newPhotos: 0, removedPhotos: 0 },
      db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0 },
    };

    it("is false when nothing needs (re)indexing", () => {
      expect(hasIndexChanges(base)).toBe(false);
    });

    it("is true for new photos", () => {
      expect(hasIndexChanges({ ...base, summary: { newPhotos: 1, removedPhotos: 0 } })).toBe(true);
    });

    it("is true for removed photos", () => {
      expect(hasIndexChanges({ ...base, summary: { newPhotos: 0, removedPhotos: 3 } })).toBe(true);
    });

    it("is true for missing embeddings", () => {
      expect(
        hasIndexChanges({ ...base, db: { missingEmbeddingCount: 5, staleEmbeddingCount: 0 } }),
      ).toBe(true);
    });

    it("is true after a model switch leaves stale embeddings", () => {
      // The regression: the wizard entry point ignored staleEmbeddingCount and
      // printed "Skipping index update" even though the plan re-indexed.
      expect(
        hasIndexChanges({ ...base, db: { missingEmbeddingCount: 0, staleEmbeddingCount: 1486 } }),
      ).toBe(true);
    });
  });

  describe("buildDeletedAlbumReports", () => {
    it("surfaces indexed photos whose album directory is gone as removed", () => {
      const reports = buildDeletedAlbumReports({
        indexedPhotoPaths: new Set([
          "../albums/kept/a.jpg",
          "../albums/deleted/x.jpg",
          "../albums/deleted/y.jpg",
        ]),
        onDiskAlbumNames: ["kept"],
      });

      expect(reports).toHaveLength(1);
      expect(reports[0].albumName).toBe("deleted");
      expect(reports[0].removedPhotos).toEqual([
        "../albums/deleted/x.jpg",
        "../albums/deleted/y.jpg",
      ]);
      expect(reports[0].newPhotos).toEqual([]);
      expect(reports[0].photoPaths).toEqual([]);
      expect(reports[0].warnings[0]).toContain("no longer exists on disk");
      expect(reports[0].blockers).toEqual([]);
    });

    it("returns nothing when every indexed album still exists", () => {
      expect(
        buildDeletedAlbumReports({
          indexedPhotoPaths: new Set(["../albums/kept/a.jpg"]),
          onDiskAlbumNames: ["kept"],
        }),
      ).toEqual([]);
    });

    it("counts a deleted album's photos into the summary so indexing triggers", () => {
      const reports = buildDeletedAlbumReports({
        indexedPhotoPaths: new Set(["../albums/gone/a.jpg", "../albums/gone/b.jpg"]),
        onDiskAlbumNames: [],
      });
      const summary = buildSummary(reports);

      expect(summary.removedPhotos).toBe(2);
      expect(hasIndexChanges({ summary, db: {} })).toBe(true);
    });
  });

  describe("embedding model health insights", () => {
    const baseReport = {
      db: {
        exists: true,
        imageCount: 1486,
        hasEmbeddingsTable: true,
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

    it("does not warn when the DB matches the expected hybrid model set", () => {
      // Healthy hybrid index: two intentional model IDs with full, equal
      // coverage. The old code flagged this as broken via mixedEmbeddingModels;
      // the new code looks at unexpectedEmbeddingModels relative to the
      // indexer's expected set.
      const insights = buildPreflightInsights({
        ...baseReport,
        db: {
          ...baseReport.db,
          embeddingsCount: 2972,
          expectedEmbeddingModelIds: [
            "google/siglip-base-patch16-224",
            "google/siglip2-base-patch16-224",
          ],
          mixedEmbeddingModels: [
            { modelId: "google/siglip-base-patch16-224", count: 1486 },
            { modelId: "google/siglip2-base-patch16-224", count: 1486 },
          ],
          unexpectedEmbeddingModels: [],
          staleEmbeddingCount: 0,
          missingEmbeddingCount: 0,
        },
      });

      const texts = insights.map((i) => i.text).join(" ");
      expect(texts).not.toContain("different model IDs");
      expect(texts).not.toContain("Similarity search is broken");
      expect(texts).not.toContain("re-embedded");
    });

    it("warns about stale model IDs not in the expected set", () => {
      const insights = buildPreflightInsights({
        ...baseReport,
        db: {
          ...baseReport.db,
          embeddingsCount: 1486,
          expectedEmbeddingModelIds: ["google/siglip2-base-patch16-224"],
          unexpectedEmbeddingModels: [
            { modelId: "google/siglip-base-patch16-224", count: 1486 },
          ],
          currentEmbeddingModelId: "google/siglip2-base-patch16-224",
          staleEmbeddingCount: 1486,
          staleEmbeddingModelIds: ["google/siglip-base-patch16-224"],
          missingEmbeddingCount: 0,
        },
      });

      const texts = insights.map((i) => i.text).join(" ");
      expect(texts).toContain("google/siglip-base-patch16-224");
      expect(texts).not.toContain("Similarity search is broken");
    });

    it("warns when an expected model is fully missing", () => {
      const insights = buildPreflightInsights({
        ...baseReport,
        db: {
          ...baseReport.db,
          embeddingsCount: 1486,
          expectedEmbeddingModelIds: [
            "google/siglip-base-patch16-224",
            "google/siglip2-base-patch16-224",
          ],
          unexpectedEmbeddingModels: [],
          staleEmbeddingCount: 0,
          missingEmbeddingCount: 1486,
        },
      });

      const texts = insights.map((i) => i.text).join(" ");
      expect(texts).toMatch(/missing|no embeddings|re-embedded|indexed on the next index run/i);
    });
  });

  describe("loadDbState", () => {
    const publicDir = path.resolve(__dirname, "../public");
    const mainDbPath = path.join(publicDir, "search.sqlite");
    const embeddingsDbPath = path.join(publicDir, "search-embeddings.sqlite");
    const fs = require("fs");
    const hasMainDb = fs.existsSync(mainDbPath);
    const hasEmbeddingsDb = fs.existsSync(embeddingsDbPath);

    (hasMainDb ? it : it.skip)("reports hasEmbeddingsTable false when only main DB provided and it has no embeddings table", async () => {
      const state = await loadDbState(mainDbPath);
      expect(state.hasEmbeddingsTable).toBe(false);
      expect(state.embeddingsCount).toBe(0);
    });

    (hasMainDb && hasEmbeddingsDb ? it : it.skip)("reads embeddings from a separate embeddings DB when main DB has no embeddings table", async () => {
      const state = await loadDbState(mainDbPath, embeddingsDbPath);
      expect(state.hasEmbeddingsTable).toBe(true);
      expect(state.embeddingsCount).toBeGreaterThan(0);
      expect(state.embeddingsCount).toBeGreaterThanOrEqual(state.imageCount);
    });
  });
});
