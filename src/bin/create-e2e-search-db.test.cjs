const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

      const result = spawnSync(
        process.execPath,
        [
          path.join(__dirname, "create-e2e-search-db.cjs"),
          "--output",
          databasePath,
          "--embeddings-output",
          embeddingsDatabasePath,
          "--force",
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);

      const database = new DatabaseSync(databasePath, { readOnly: true });
      expect(database.prepare("SELECT COUNT(*) AS count FROM images").get().count).toBe(5);
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'embeddings'")
          .get().count,
      ).toBe(0);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM images WHERE images MATCH 'japan'").get()
          .count,
      ).toBe(2);
      expect(database.prepare("SELECT count FROM tags WHERE tag = 'japan'").get().count).toBe(2);
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM images WHERE exif LIKE '%GPSLatitude%'")
          .get().count,
      ).toBe(5);
      database.close();

      const embeddingsDatabase = new DatabaseSync(embeddingsDatabasePath, { readOnly: true });
      expect(
        embeddingsDatabase.prepare("SELECT COUNT(*) AS count FROM embeddings").get().count,
      ).toBe(5);
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
});
