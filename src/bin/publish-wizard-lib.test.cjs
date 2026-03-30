const path = require("path");
const {
  buildAttentionAlbums,
  buildIndexVerification,
  buildPreflightInsights,
  buildSummary,
  buildVerificationInsights,
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

  describe("loadDbState", () => {
    const publicDir = path.resolve(__dirname, "../public");
    const mainDbPath = path.join(publicDir, "search.sqlite");
    const embeddingsDbPath = path.join(publicDir, "search-embeddings.sqlite");

    it("reports hasEmbeddingsTable false when only main DB provided and it has no embeddings table", async () => {
      const state = await loadDbState(mainDbPath);
      expect(state.hasEmbeddingsTable).toBe(false);
      expect(state.embeddingsCount).toBe(0);
    });

    it("reads embeddings from a separate embeddings DB when main DB has no embeddings table", async () => {
      const state = await loadDbState(mainDbPath, embeddingsDbPath);
      expect(state.hasEmbeddingsTable).toBe(true);
      expect(state.embeddingsCount).toBeGreaterThan(0);
      expect(state.embeddingsCount).toBe(state.imageCount);
    });
  });
});
