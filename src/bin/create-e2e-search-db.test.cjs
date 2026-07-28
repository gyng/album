const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  coordinateRef,
  createE2eSearchDatabases,
  encodeEmbedding,
  parseArgs,
  run,
} = require("./create-e2e-search-db.cjs");

describe("create-e2e-search-db", () => {
  it("creates the deterministic gallery fixture used by browser tests", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "album-e2e-db-"));
    const databasePath = path.join(directory, "search.sqlite");
    const embeddingsDatabasePath = path.join(directory, "search-embeddings.sqlite");

    try {
      // Normal E2E preparation always uses --force. Start with invalid stale
      // files so this test proves they are replaced rather than merely testing
      // first-time creation on an empty checkout.
      writeFileSync(databasePath, "stale core database");
      writeFileSync(embeddingsDatabasePath, "stale embeddings database");

      const result = createE2eSearchDatabases({
        outputPath: databasePath,
        embeddingsOutputPath: embeddingsDatabasePath,
        force: true,
      });
      expect(result.created).toBe(true);

      const database = new DatabaseSync(databasePath, { readOnly: true });
      // Five photos plus the album's committed clip, indexed through its poster.
      expect(database.prepare("SELECT COUNT(*) AS count FROM images").get().count).toBe(6);
      expect(
        database
          .prepare("SELECT media_kind, duration_seconds FROM metadata WHERE path LIKE '%.MOV'")
          .get(),
      ).toEqual({ media_kind: "video", duration_seconds: 13.013 });
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'embeddings'")
          .get().count,
      ).toBe(0);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM images WHERE images MATCH 'japan'").get()
          .count,
      ).toBe(3);
      expect(database.prepare("SELECT count FROM tags WHERE tag = 'japan'").get().count).toBe(3);
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM images WHERE exif LIKE '%GPSLatitude%'")
          .get().count,
      ).toBe(6);
      database.close();

      const embeddingsDatabase = new DatabaseSync(embeddingsDatabasePath, { readOnly: true });
      expect(
        embeddingsDatabase.prepare("SELECT COUNT(*) AS count FROM embeddings").get().count,
      ).toBe(6);
      expect(
        embeddingsDatabase
          .prepare("SELECT name FROM pragma_table_info('embeddings') ORDER BY cid")
          .all()
          .map(({ name }) => name),
      ).toEqual(["path", "model_id", "embedding_dim", "embedding_blob", "embedding_scale"]);
      expect(
        embeddingsDatabase
          .prepare(
            "SELECT typeof(embedding_blob) AS blob_type, embedding_scale > 0 AS valid_scale FROM embeddings LIMIT 1",
          )
          .get(),
      ).toEqual({ blob_type: "blob", valid_scale: 1 });
      embeddingsDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reuses existing databases unless force is requested", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "album-e2e-db-existing-"));
    const databasePath = path.join(directory, "search.sqlite");
    const embeddingsDatabasePath = path.join(directory, "search-embeddings.sqlite");

    try {
      createE2eSearchDatabases({
        outputPath: databasePath,
        embeddingsOutputPath: embeddingsDatabasePath,
      });

      expect(
        createE2eSearchDatabases({
          outputPath: databasePath,
          embeddingsOutputPath: embeddingsDatabasePath,
        }),
      ).toEqual({
        created: false,
        outputPath: databasePath,
        embeddingsOutputPath: embeddingsDatabasePath,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses output flags and reports created and reused fixtures", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "album-e2e-db-run-"));
    const databasePath = path.join(directory, "search.sqlite");
    const embeddingsDatabasePath = path.join(directory, "search-embeddings.sqlite");
    const args = [
      "--output",
      databasePath,
      "--embeddings-output",
      embeddingsDatabasePath,
      "--force",
    ];
    const log = jest.fn();

    try {
      expect(parseArgs(args)).toEqual({
        outputPath: databasePath,
        embeddingsOutputPath: embeddingsDatabasePath,
        force: true,
      });
      expect(run(args, log).created).toBe(true);
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Created deterministic"));

      const reusedArgs = args.filter((arg) => arg !== "--force");
      expect(run(reusedArgs, log).created).toBe(false);
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Using existing"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses default paths for missing or incomplete flags", () => {
    const defaults = parseArgs([]);
    const incomplete = parseArgs(["--output"]);

    expect(defaults.force).toBe(false);
    expect(defaults.outputPath).toBe(path.resolve(__dirname, "../public/e2e-search.sqlite"));
    expect(incomplete.outputPath).toBe(defaults.outputPath);
  });

  it("uses the process arguments and console logger by default", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const create = jest.fn((options) => ({ created: false, ...options }));

    const result = run(undefined, undefined, create);

    expect(result.created).toBe(false);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Using existing"));
    log.mockRestore();
  });

  it("quantises zero and signed embeddings and labels coordinate hemispheres", () => {
    const zero = encodeEmbedding([0, 0, 0]);
    const signed = encodeEmbedding([-2, 1, 4]);

    expect(zero.scale).toBe(1);
    expect([...zero.blob.values()]).toEqual([0, 0, 0]);
    expect(signed.scale).toBe(4 / 127);
    expect(coordinateRef(-1, "S", "N")).toBe("S");
    expect(coordinateRef(1, "S", "N")).toBe("N");
  });
});
