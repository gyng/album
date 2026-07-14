import {
  fetchColorSimilarResults,
  fetchMemoryCandidates,
  fetchGuessPhotos,
  fetchGuessRegions,
  fetchSearchFacetSections,
  fetchHybridResults,
  fetchRandomPhoto,
  fetchRandomResults,
  fetchRecentResults,
  fetchRefinementTagCounts,
  fetchResults,
  fetchSemanticResults,
  fetchSimilarResults,
  fetchSlideshowPhotos,
  fetchTags,
  hasStructuredGeocode,
  searchInternals,
  seededShuffle,
} from "./api";

type ExecArgs = {
  sql: string;
  bind?: Array<string | number>;
  callback: (row: any[]) => void;
};

const makeDatabase = () => {
  return {
    exec: ({ sql, bind, callback }: ExecArgs) => {
      if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
        if (bind?.[0] === "../albums/test-simple/DSCF0506-2.jpg") {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
        }
        return;
      }

      if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
        callback([
          "../albums/test-simple/DSCF0506-2.jpg",
          "google/siglip-base-patch16-224",
          3,
          JSON.stringify([1, 0, 0]),
        ]);
        callback([
          "../albums/test-simple/DSCF0593.jpg",
          "google/siglip-base-patch16-224",
          3,
          JSON.stringify([0.9, 0.1, 0]),
        ]);
        callback([
          "../albums/test-simple/DSCF2581-2_2.jpg",
          "google/siglip-base-patch16-224",
          3,
          JSON.stringify([0, 1, 0]),
        ]);
        return;
      }

      if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
        callback([
          "../albums/test-simple/DSCF0506-2.jpg",
          "/album/test-simple#DSCF0506-2.jpg",
          "DSCF0506-2.jpg",
          "",
          "",
          "bridge, harbor",
          "[(0,0,0)]",
          "Bridge over harbor",
          "",
          "",
          "",
          "",
        ]);
        callback([
          "../albums/test-simple/DSCF0593.jpg",
          "/album/test-simple#DSCF0593.jpg",
          "DSCF0593.jpg",
          "",
          "",
          "harbor, skyline",
          "[(0,0,0)]",
          "Harbor skyline",
          "",
          "",
          "",
          "",
        ]);
        callback([
          "../albums/test-simple/DSCF2581-2_2.jpg",
          "/album/test-simple#DSCF2581-2_2.jpg",
          "DSCF2581-2_2.jpg",
          "",
          "",
          "night, street",
          "[(0,0,0)]",
          "Night street",
          "",
          "",
          "",
          "",
        ]);
      }
    },
  };
};

describe("fetchSimilarResults", () => {
  it("returns similarity-ranked results for a selected image", async () => {
    const results = await fetchSimilarResults({
      database: makeDatabase() as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 2,
    });

    if ((results.data.length ?? 0) !== 2) {
      throw new Error(`Expected 2 results, got ${results.data.length ?? 0}`);
    }
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
    expect(results.data[1]?.path).toBe("../albums/test-simple/DSCF2581-2_2.jpg");
    const firstSimilarity = Number(results.data[0]?.similarity ?? 0);
    const secondSimilarity = Number(results.data[1]?.similarity ?? 0);
    expect(firstSimilarity > secondSimilarity).toBe(true);
  });

  it("can return least-similar results first", async () => {
    const results = await fetchSimilarResults({
      database: makeDatabase() as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      similarityOrder: "least",
      page: 0,
      pageSize: 2,
    });

    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF2581-2_2.jpg");
    expect(results.data[1]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
    expect(Number(results.data[0]?.similarity ?? 0)).toBeLessThan(
      Number(results.data[1]?.similarity ?? 0),
    );
  });

  it("can read embeddings from a separate database", async () => {
    const coreDatabase = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "",
            "",
            "harbor, skyline",
            "[(0,0,0)]",
            "Harbor skyline",
            "",
          ]);
        }
      },
    };
    const embeddingsDatabase = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          return;
        }

        if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0.9, 0.1, 0]),
          ]);
        }
      },
    };

    const results = await fetchSimilarResults({
      database: coreDatabase as any,
      embeddingsDatabase: embeddingsDatabase as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 2,
    });

    expect(results.data).toHaveLength(1);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
  });

  it("returns no results when the database has no embeddings table", async () => {
    const database = {
      exec: ({ sql }: ExecArgs) => {
        if (sql.includes("FROM embeddings")) {
          throw new Error("SQLITE_ERROR: no such table: embeddings");
        }
      },
    };

    const results = await fetchSimilarResults({
      database: database as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 2,
    });

    expect(results.data).toEqual([]);
    expect(results.query).toBe("../albums/test-simple/DSCF0506-2.jpg");
  });

  it("returns empty results when the query embedding_json is malformed", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            "{{not valid json",
          ]);
        }
      },
    };

    const results = await fetchSimilarResults({
      database: database as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 10,
    });

    expect(results.data).toEqual([]);
    expect(results.query).toBe("../albums/test-simple/DSCF0506-2.jpg");
  });

  it("skips malformed candidate embeddings and returns the valid ones", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          return;
        }

        if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0.9, 0.1, 0]),
          ]);
          callback([
            "../albums/test-simple/DSCF2581-2_2.jpg",
            "google/siglip-base-patch16-224",
            3,
            "{{not valid json",
          ]);
          return;
        }

        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "",
            "",
            "harbor, skyline",
            "[(0,0,0)]",
            "Harbor skyline",
            "",
            "",
            "",
            "",
          ]);
        }
      },
    };

    const results = await fetchSimilarResults({
      database: database as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 10,
    });

    expect(results.data).toHaveLength(1);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
  });
});

describe("blob-format embeddings", () => {
  const int8Blob = (values: number[]): Uint8Array => new Uint8Array(Int8Array.from(values).buffer);

  // Emulates a DB published after the int8-blob format change: table_info
  // reports the blob columns, and only blob-shaped SELECTs return rows — a
  // legacy embedding_json SELECT would fail on the real DB, so it returns
  // nothing here and the ranking assertions below catch the wrong query.
  const makeBlobDatabase = () => ({
    exec: ({ sql, bind, callback }: ExecArgs) => {
      if (sql.includes("table_info(embeddings)")) {
        [
          [0, "path", "VARCHAR", 1, null, 1],
          [1, "model_id", "TEXT", 1, null, 2],
          [2, "embedding_dim", "INTEGER", 0, null, 0],
          [3, "embedding_blob", "BLOB", 0, null, 0],
          [4, "embedding_scale", "REAL", 0, null, 0],
        ].forEach((row) => callback(row as any[]));
        return;
      }

      if (!sql.includes("embedding_blob") && sql.includes("FROM embeddings")) {
        return;
      }

      if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
        if (bind?.[0] === "../albums/test-simple/DSCF0506-2.jpg") {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            int8Blob([127, 0, 0]),
            1 / 127,
          ]);
        }
        return;
      }

      if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
        callback([
          "../albums/test-simple/DSCF0593.jpg",
          "google/siglip-base-patch16-224",
          3,
          int8Blob([127, 14, 0]),
          0.9 / 127,
        ]);
        callback([
          "../albums/test-simple/DSCF2581-2_2.jpg",
          "google/siglip-base-patch16-224",
          3,
          int8Blob([0, 127, 0]),
          1 / 127,
        ]);
        return;
      }

      if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
        callback([
          "../albums/test-simple/DSCF0593.jpg",
          "/album/test-simple#DSCF0593.jpg",
          "DSCF0593.jpg",
          "",
          "",
          "harbor, skyline",
          "[(0,0,0)]",
          "Harbor skyline",
          "",
          "",
          "",
          "",
        ]);
        callback([
          "../albums/test-simple/DSCF2581-2_2.jpg",
          "/album/test-simple#DSCF2581-2_2.jpg",
          "DSCF2581-2_2.jpg",
          "",
          "",
          "night, street",
          "[(0,0,0)]",
          "Night street",
          "",
          "",
          "",
          "",
        ]);
      }
    },
  });

  it("ranks int8 blob embeddings by similarity", async () => {
    const results = await fetchSimilarResults({
      database: makeBlobDatabase() as any,
      path: "../albums/test-simple/DSCF0506-2.jpg",
      page: 0,
      pageSize: 2,
    });

    expect(results.data).toHaveLength(2);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
    expect(results.data[1]?.path).toBe("../albums/test-simple/DSCF2581-2_2.jpg");
    expect(Number(results.data[0]?.similarity)).toBeGreaterThan(
      Number(results.data[1]?.similarity),
    );
  });

  it("decodes int8 blobs against the per-vector scale", () => {
    const decoded = searchInternals.decodeInt8Embedding(
      new Uint8Array(Int8Array.from([127, -127, 64, 0]).buffer),
      0.01,
    );

    expect(decoded).toHaveLength(4);
    expect(decoded[0]).toBeCloseTo(1.27, 6);
    expect(decoded[1]).toBeCloseTo(-1.27, 6);
    expect(decoded[2]).toBeCloseTo(0.64, 6);
    expect(decoded[3]).toBe(0);
  });
});

describe("fetchColorSimilarResults", () => {
  it("filters color results by selected facets", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (
          sql.includes("SELECT images.path, images.colors FROM images") &&
          sql.includes("images.geocode LIKE ? OR images.geocode LIKE ?")
        ) {
          expect(bind).toEqual(["%\nTokyo\n%", "%\nTokyo"]);
          callback(["../albums/test-simple/DSCF0593.jpg", "[(255,0,0), (0,0,0)]"]);
          return;
        }

        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
            "",
            "harbor, skyline",
            "[(255,0,0), (0,0,0)]",
            "Harbor skyline",
            "",
            "",
            "",
            "",
          ]);
        }
      },
    };

    const results = await fetchColorSimilarResults({
      database: database as any,
      color: [255, 0, 0],
      page: 0,
      pageSize: 10,
      maxDistance: 60,
      selectedFacets: [{ facetId: "region", value: "Tokyo" }],
    });

    expect(results.data).toHaveLength(1);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
  });
});

describe("fetchSemanticResults", () => {
  it("returns similarity-ranked results for a text embedding", async () => {
    const results = await fetchSemanticResults({
      database: makeDatabase() as any,
      textQuery: "harbor skyline",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 2,
      modelId: "google/siglip-base-patch16-224",
    });

    if ((results.data.length ?? 0) !== 2) {
      throw new Error(`Expected 2 results, got ${results.data.length ?? 0}`);
    }

    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0506-2.jpg");
    expect(results.data[1]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
    expect(Number(results.data[0]?.similarity ?? 0)).toBeGreaterThan(
      Number(results.data[1]?.similarity ?? 0),
    );
    expect(results.query).toBe("harbor skyline");
  });

  it("returns no results when embeddings are unavailable", async () => {
    const database = {
      exec: ({ sql }: ExecArgs) => {
        if (sql.includes("FROM embeddings")) {
          throw new Error("SQLITE_ERROR: no such table: embeddings");
        }
      },
    };

    const results = await fetchSemanticResults({
      database: database as any,
      textQuery: "harbor skyline",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 2,
      modelId: "google/siglip-base-patch16-224",
    });

    expect(results.data).toEqual([]);
    expect(results.query).toBe("harbor skyline");
  });

  it("filters semantic results by selected facets", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (
          sql.includes("SELECT images.path") &&
          sql.includes("images.geocode LIKE ? OR images.geocode LIKE ?")
        ) {
          expect(bind).toEqual(["%\nJapan\n%", "%\nJapan"]);
          callback(["../albums/test-simple/DSCF0593.jpg"]);
          return;
        }

        if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0.9, 0.1, 0]),
          ]);
          return;
        }

        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
            "",
            "harbor, skyline",
            "[(0,0,0)]",
            "Harbor skyline",
            "",
            "",
            "",
            "",
          ]);
        }
      },
    };

    const results = await fetchSemanticResults({
      database: database as any,
      textQuery: "harbor skyline",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 10,
      modelId: "google/siglip-base-patch16-224",
      selectedFacets: [{ facetId: "location", value: "Japan" }],
    });

    expect(results.data).toHaveLength(1);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
  });
});

describe("fetchHybridResults", () => {
  it("fuses keyword and vector rankings with reciprocal rank fusion", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (
          sql.includes("FROM images") &&
          sql.includes("images MATCH ?") &&
          sql.includes("ORDER BY rank")
        ) {
          expect(bind).toEqual([`- {path album_relative_path exif colors} : "harbor"`]);
          callback(["../albums/test-simple/DSCF0593.jpg", 0.9]);
          callback(["../albums/test-simple/DSCF2581-2_2.jpg", 0.5]);
          return;
        }

        if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0.9, 0.1, 0]),
          ]);
          callback([
            "../albums/test-simple/DSCF2581-2_2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0, 1, 0]),
          ]);
          return;
        }

        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "",
            "",
            "harbor, skyline",
            "[(0,0,0)]",
            "Harbor skyline",
            "",
            "",
            "",
            "",
          ]);
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "/album/test-simple#DSCF0506-2.jpg",
            "DSCF0506-2.jpg",
            "",
            "",
            "bridge, harbor",
            "[(0,0,0)]",
            "Bridge over harbor",
            "",
            "",
            "",
            "",
          ]);
          callback([
            "../albums/test-simple/DSCF2581-2_2.jpg",
            "/album/test-simple#DSCF2581-2_2.jpg",
            "DSCF2581-2_2.jpg",
            "",
            "",
            "night, street",
            "[(0,0,0)]",
            "Night street",
            "",
            "",
            "",
            "",
          ]);
        }
      },
    };

    const results = await fetchHybridResults({
      database: database as any,
      textQuery: "harbor",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 3,
      modelId: "google/siglip-base-patch16-224",
    });

    expect(results.data.map((row) => row.path)).toEqual([
      "../albums/test-simple/DSCF0593.jpg",
      "../albums/test-simple/DSCF2581-2_2.jpg",
      "../albums/test-simple/DSCF0506-2.jpg",
    ]);
    expect(results.data[0]?.bm25).toBe(0.9);
    expect(Number(results.data[0]?.similarity ?? 0)).toBeGreaterThan(0);
    expect(results.data[1]?.bm25).toBe(0.5);
    expect(Number(results.data[1]?.rrfScore ?? 0)).toBeGreaterThan(
      Number(results.data[2]?.rrfScore ?? 0),
    );
  });

  it("filters hybrid results by selected facets", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (
          sql.includes("SELECT images.path") &&
          sql.includes("images.geocode LIKE ? OR images.geocode LIKE ?")
        ) {
          expect(bind).toEqual(["%\nJapan\n%", "%\nJapan"]);
          callback(["../albums/test-simple/DSCF0593.jpg"]);
          return;
        }

        if (
          sql.includes("FROM images") &&
          sql.includes("images MATCH ?") &&
          sql.includes("ORDER BY rank")
        ) {
          callback(["../albums/test-simple/DSCF0593.jpg", 0.9]);
          callback(["../albums/test-simple/DSCF2581-2_2.jpg", 0.5]);
          return;
        }

        if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([0.9, 0.1, 0]),
          ]);
          return;
        }

        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "/album/test-simple#DSCF0593.jpg",
            "DSCF0593.jpg",
            "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
            "",
            "harbor, skyline",
            "[(0,0,0)]",
            "Harbor skyline",
            "",
            "",
            "",
            "",
          ]);
        }
      },
    };

    const results = await fetchHybridResults({
      database: database as any,
      textQuery: "harbor",
      keywordQuery: "harbor",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 10,
      modelId: "google/siglip-base-patch16-224",
      selectedFacets: [{ facetId: "location", value: "Japan" }],
    });

    expect(results.data).toHaveLength(1);
    expect(results.data[0]?.path).toBe("../albums/test-simple/DSCF0593.jpg");
  });
});

describe("fetchRecentResults", () => {
  it("returns the most recent images with display snippets", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("LEFT JOIN metadata m ON m.path = images.path")) {
          expect(bind).toEqual([2]);
          callback([
            "../albums/test-simple/newer.jpg",
            "/album/test-simple#newer.jpg",
            "newer.jpg",
            "",
            "EXIF DateTimeOriginal: 2024:10:02 09:00:00",
            "city, dawn",
            "[(0,0,0)]",
            "City at dawn",
            "",
            "",
            "",
            "",
          ]);
          callback([
            "../albums/test-simple/older.jpg",
            "/album/test-simple#older.jpg",
            "older.jpg",
            "",
            "EXIF DateTimeOriginal: 2024:09:29 18:30:00",
            "night, street",
            "[(0,0,0)]",
            "",
            "",
            "",
            "Lantern alley",
            "",
          ]);
        }
      },
    };

    const results = await fetchRecentResults({
      database: database as any,
      pageSize: 2,
    });

    if ((results.length ?? 0) !== 2) {
      throw new Error(`Expected 2 recent results, got ${results.length ?? 0}`);
    }
    expect(results[0].path).toBe("../albums/test-simple/newer.jpg");
    expect(results[0].snippet).toBe("City at dawn");
    expect(results[1].path).toBe("../albums/test-simple/older.jpg");
    expect(results[1].snippet).toBe("night, street");
  });
});

describe("fetchMemoryCandidates", () => {
  it("returns prior-year dated images with normalized isoDate values", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("LEFT JOIN metadata m ON m.path = images.path")) {
          expect(bind).toEqual(["2026"]);
          callback([
            "../albums/test-simple/march.jpg",
            "/album/test-simple#march.jpg",
            "march.jpg",
            "",
            "EXIF DateTimeOriginal: 2025:03:18 09:00:00",
            "city, dawn",
            "[(0,0,0)]",
            "City at dawn",
            "",
            "2025-03-18",
          ]);
          callback([
            "../albums/test-simple/fallback.jpg",
            "/album/test-simple#fallback.jpg",
            "fallback.jpg",
            "",
            "EXIF DateTimeOriginal: 2024:12:30 18:30:00",
            "night, street",
            "[(0,0,0)]",
            "",
            "Lantern alley",
            "2024-12-30",
          ]);
        }
      },
    };

    const results = await fetchMemoryCandidates({
      database: database as any,
      todayDate: "2026-03-15",
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.isoDate).toBe("2025-03-18");
    expect(results[0]?.snippet).toBe("City at dawn");
    expect(results[1]?.isoDate).toBe("2024-12-30");
    expect(results[1]?.snippet).toBe("Lantern alley");
  });
});

describe("fetchRefinementTagCounts", () => {
  it("returns prospective counts for additional refinement tags", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("COUNT(*) AS count") && sql.includes("UNION ALL")) {
          expect(bind).toEqual([
            "harbor",
            `- {path album_relative_path exif colors} : "bird"`,
            `- {path album_relative_path exif colors} : "harbor"`,
            "night",
            `- {path album_relative_path exif colors} : "bird"`,
            `- {path album_relative_path exif colors} : "night"`,
          ]);
          callback(["harbor", 4]);
          callback(["night", 0]);
        }
      },
    };

    const results = await fetchRefinementTagCounts({
      database: database as any,
      activeTerms: ["bird"],
      candidateTags: ["harbor", "night", "bird"],
    });

    expect(results.harbor).toBe(4);
    expect(results.night).toBe(0);
    expect(results.bird).toBeUndefined();
  });

  it("applies active facet filters while recalculating tag counts", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("COUNT(*) AS count") && sql.includes("images.geocode")) {
          expect(sql).toContain("LEFT JOIN metadata m ON m.path = images.path");
          expect(bind).toEqual([
            "harbor",
            `- {path album_relative_path exif colors} : "harbor"`,
            "%\nJapan\n%",
            "%\nJapan",
          ]);
          callback(["harbor", 2]);
        }
      },
    };

    const results = await fetchRefinementTagCounts({
      database: database as any,
      activeTerms: [],
      candidateTags: ["harbor"],
      selectedFacets: [{ facetId: "location", value: "Japan" }],
    });

    expect(results.harbor).toBe(2);
  });
});

describe("fetchSearchFacetSections", () => {
  it("recalculates each section against keywords and the other selected facets", async () => {
    const calls: Array<{ sql: string; bind?: Array<string | number> }> = [];
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        calls.push({ sql, bind });
        callback([
          "Image Make: FUJIFILM\nImage Model: X-T5\nEXIF LensModel: XF35mmF1.4 R\nEXIF ISOSpeedRatings: 400\nEXIF DateTimeOriginal: 2024:03:22 17:45:00\nEXIF OffsetTime: +09:00",
          "Shinjuku-ku\nTokyo\nTokyo\nJapan",
          "2024-03-22",
          // geo_city, geo_region, geo_subregion, geo_country — the probe below
          // reports the columns present, so facet values come from these.
          "Shinjuku-ku",
          "Tokyo",
          "Tokyo",
          "Japan",
        ]);
      },
    };

    const sections = await fetchSearchFacetSections({
      database: database as any,
      activeTerms: ["harbor"],
      selectedFacets: [
        { facetId: "camera", value: "FUJIFILM X-T5" },
        { facetId: "location", value: "Japan" },
      ],
    });

    expect(sections.find((section) => section.facetId === "camera")?.options).toEqual([
      { value: "FUJIFILM X-T5", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "region")?.options).toEqual([
      { value: "Tokyo", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "subregion")?.options).toEqual([
      { value: "Tokyo", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "city")?.options).toEqual([
      { value: "Shinjuku-ku", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "year")?.options).toEqual([
      { value: "2024", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "hour")?.options).toEqual([
      { value: "17:00", count: 1 },
    ]);
    expect(
      calls.some(({ bind }) =>
        bind?.includes(`- {path album_relative_path exif colors} : "harbor"`),
      ),
    ).toBe(true);
    // This mock's probe reports the geo_* columns present, so the Country
    // facet matches the dedicated column exactly rather than any blob line.
    expect(
      calls.some(
        ({ sql, bind }) =>
          sql.includes("SELECT path FROM metadata WHERE geo_country = ?") &&
          bind?.includes("Japan"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        ({ bind }) =>
          bind?.includes("%Image Model:FUJIFILM X-T5%") && bind?.includes("%Image Make:FUJIFILM%"),
      ),
    ).toBe(true);
  });
});

describe("fetchRandomPhoto", () => {
  it("returns an empty array when the database has no matching rows", async () => {
    const database = {
      exec: (_args: ExecArgs) => {
        // return no rows
      },
    };

    const result = await fetchRandomPhoto({ database: database as any });

    expect(result).toEqual([]);
  });
});

const imageRow = (path: string, colors = "[(0,0,0)]") => [
  path,
  `/album/test-simple#${path.split("/").at(-1)}`,
  path.split("/").at(-1),
  "",
  "",
  "tag",
  colors,
  "Alt",
  "",
  "",
  "",
  "",
];

describe("fetchHybridResults keyword degradation", () => {
  it("degrades to keyword-only ranking when the embeddings table is missing", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM embeddings")) {
          throw new Error("SQLITE_ERROR: no such table: embeddings");
        }
        if (
          sql.includes("FROM images") &&
          sql.includes("images MATCH ?") &&
          sql.includes("ORDER BY rank")
        ) {
          callback(["../albums/test-simple/DSCF0593.jpg", 0.9]);
          callback(["../albums/test-simple/DSCF2581-2_2.jpg", 0.5]);
          return;
        }
        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback(imageRow("../albums/test-simple/DSCF0593.jpg"));
          callback(imageRow("../albums/test-simple/DSCF2581-2_2.jpg"));
        }
      },
    };

    const results = await fetchHybridResults({
      database: database as any,
      textQuery: "harbor",
      textVector: [1, 0, 0],
      page: 0,
      pageSize: 10,
      modelId: "google/siglip-base-patch16-224",
    });

    // Keyword ranking survives instead of the whole result collapsing to empty.
    expect(results.data.map((row) => row.path)).toEqual([
      "../albums/test-simple/DSCF0593.jpg",
      "../albums/test-simple/DSCF2581-2_2.jpg",
    ]);
    expect(results.data[0]?.bm25).toBe(0.9);
  });
});

describe("fetchResults pagination", () => {
  it("advertises a next page from page 0 when the page fills", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM images") && sql.includes("ORDER BY rank")) {
          callback(imageRow("../albums/test-simple/a.jpg"));
          callback(imageRow("../albums/test-simple/b.jpg"));
        }
      },
    };

    const results = await fetchResults({
      database: database as any,
      query: "harbor",
      page: 0,
      pageSize: 2,
    });

    expect(results.next).toBe(1);
    expect(results.prev).toBeUndefined();
  });

  it("does not advertise a next page when page 0 is not full", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("FROM images") && sql.includes("ORDER BY rank")) {
          callback(imageRow("../albums/test-simple/a.jpg"));
        }
      },
    };

    const results = await fetchResults({
      database: database as any,
      query: "harbor",
      page: 0,
      pageSize: 2,
    });

    expect(results.next).toBeUndefined();
  });
});

describe("fetchColorSimilarResults scoring", () => {
  it("reports the colour match in colorMatchScore, not similarity", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("SELECT images.path, images.colors FROM images")) {
          callback(["../albums/test-simple/red.jpg", "[(255,0,0)]"]);
          return;
        }
        if (sql.includes("FROM images") && sql.includes("WHERE path IN")) {
          callback(imageRow("../albums/test-simple/red.jpg", "[(255,0,0)]"));
        }
      },
    };

    const results = await fetchColorSimilarResults({
      database: database as any,
      color: [255, 0, 0],
      page: 0,
      pageSize: 10,
    });

    expect(results.data).toHaveLength(1);
    expect(typeof results.data[0]?.colorMatchScore).toBe("number");
    expect(results.data[0]?.similarity).toBeUndefined();
  });
});

describe("exec", () => {
  it("resolves with rows collected from the callback", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        callback([
          "path/a.jpg",
          "/album/a#a.jpg",
          "a.jpg",
          "",
          "",
          "tag",
          "[(0,0,0)]",
          "Alt",
          "",
          "",
          "",
          "",
        ]);
        callback([
          "path/b.jpg",
          "/album/b#b.jpg",
          "b.jpg",
          "",
          "",
          "tag",
          "[(0,0,0)]",
          "Alt",
          "",
          "",
          "",
          "",
        ]);
      },
    };

    const result = await searchInternals.exec(database as any, "SELECT 1", []);

    expect(result.data).toHaveLength(2);
    expect((result.data[0] as unknown as string[])[0]).toBe("path/a.jpg");
    expect((result.data[1] as unknown as string[])[0]).toBe("path/b.jpg");
  });

  it("rejects when db.exec throws", async () => {
    const boom = new Error("SQLITE_ERROR: no such table: images");
    const database = {
      exec: () => {
        throw boom;
      },
    };

    await expect(searchInternals.exec(database as any, "SELECT 1", [])).rejects.toThrow(
      "no such table: images",
    );
  });
});

describe("geocode facet precision", () => {
  const makeDb = (hasGeoColumn: boolean) => ({
    exec: ({ sql, callback }: ExecArgs) => {
      if (sql.includes("pragma_table_info('metadata')") && hasGeoColumn) {
        callback([1]);
      }
    },
  });

  it("detects the geo_city column and caches the probe", () => {
    const withCol = makeDb(true);
    const withoutCol = makeDb(false);
    expect(searchInternals.hasStructuredGeocode(withCol as any)).toBe(true);
    expect(searchInternals.hasStructuredGeocode(withoutCol as any)).toBe(false);
    // cached: mutating exec to throw must not change the memoised answer
    (withCol as any).exec = () => {
      throw new Error("should not be called again");
    };
    expect(searchInternals.hasStructuredGeocode(withCol as any)).toBe(true);
  });

  it("matches the dedicated column exactly when present", () => {
    const clause = searchInternals.buildFacetWhereClause(
      [{ facetId: "city", value: "Tokyo" }] as any,
      true,
    );
    expect(clause.sql).toContain("SELECT path FROM metadata WHERE geo_city = ?");
    // region "Tokyo" is a different column — city and region no longer collide
    expect(clause.sql).not.toContain("geo_region");
    expect(clause.bind).toEqual(["Tokyo"]);
  });

  it("falls back to the any-line blob match on an old DB", () => {
    const clause = searchInternals.buildFacetWhereClause(
      [{ facetId: "city", value: "Tokyo" }] as any,
      false,
    );
    expect(clause.sql).toContain("images.geocode LIKE ?");
  });

  it("counts region/subregion from the columns, not blob position", async () => {
    // The blob would positionally yield region "PositionalRegion"; the columns
    // say something different, proving the counts read the columns.
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("pragma_table_info('metadata')")) {
          callback([1]);
          return;
        }
        callback([
          "Image Make: X",
          "TheCity\nPositionalRegion\nTheCountry", // blob (fallback source)
          "2024-01-01",
          "TheCity", // geo_city
          "RealRegion", // geo_region (admin1)
          "RealSubregion", // geo_subregion (admin2)
          "TheCountry", // geo_country
        ]);
      },
    };
    const sections = await fetchSearchFacetSections({ database: database as any });
    expect(sections.find((s) => s.facetId === "region")?.options).toEqual([
      { value: "RealRegion", count: 1 },
    ]);
    expect(sections.find((s) => s.facetId === "subregion")?.options).toEqual([
      { value: "RealSubregion", count: 1 },
    ]);
  });
});

describe("browse and slideshow queries", () => {
  it("maps tags, random rows, slideshow rows, and a random seed photo", async () => {
    const calls: Array<{ sql: string; bind?: Array<string | number> }> = [];
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        calls.push({ sql, bind });
        if (sql.includes("FROM tags")) {
          callback(["harbor", 4]);
        } else if (sql.includes("ORDER BY RANDOM()") && sql.includes("SELECT images.path")) {
          callback(imageRow("../albums/test-simple/random.jpg"));
        } else if (sql.includes("SELECT path, exif, geocode, colors")) {
          callback(["../albums/test-simple/slide.jpg", "exif", "city", "[(1,2,3)]"]);
        } else if (sql.includes("SELECT path, exif, geocode")) {
          callback(["../albums/test-simple/seed.jpg", "seed exif", "seed city"]);
        }
      },
    };

    await expect(fetchTags({ database: database as any, page: 1, pageSize: 20 })).resolves.toEqual({
      data: [{ tag: "harbor", count: 4 }],
      next: undefined,
      prev: undefined,
    });
    await expect(
      fetchRandomResults({
        database: database as any,
        pageSize: 1,
        excludePaths: ["excluded.jpg"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ path: "../albums/test-simple/random.jpg", snippet: "Alt" }),
    ]);
    await expect(
      fetchSlideshowPhotos({ database: database as any, filter: "test-simple" }),
    ).resolves.toEqual([
      {
        path: "../albums/test-simple/slide.jpg",
        exif: "exif",
        geocode: "city",
        colors: "[(1,2,3)]",
      },
    ]);
    await expect(
      fetchRandomPhoto({ database: database as any, filter: "test-simple" }),
    ).resolves.toEqual([
      { path: "../albums/test-simple/seed.jpg", exif: "seed exif", geocode: "seed city" },
    ]);

    expect(calls.find(({ sql }) => sql.includes("FROM tags"))?.bind).toEqual([0, 20, 20]);
    expect(calls.some(({ sql }) => sql.includes("WHERE path NOT IN (?)"))).toBe(true);
    expect(calls.filter(({ bind }) => bind?.includes("../albums/test-simple/%"))).toHaveLength(2);
  });

  it("supports defaults and an empty random exclusion list", async () => {
    const calls: Array<{ sql: string; bind?: Array<string | number> }> = [];
    const database = {
      exec: ({ sql, bind }: ExecArgs) => {
        calls.push({ sql, bind });
      },
    };
    await fetchRandomResults({ database: database as any, pageSize: 3 });
    await fetchSlideshowPhotos({ database: database as any });
    expect(calls[0]?.sql).not.toContain("WHERE path NOT IN");
    expect(calls[0]?.bind).toEqual([3]);
    expect(calls[1]?.bind).toEqual(["../albums/%/%"]);
  });
});

describe("guess-game queries", () => {
  it("counts eligible countries and sorts them by photo count", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        ["City\n1\nRegion\nJapan", "Town\n2\nRegion\nFrance", "\n3\n\n"].forEach((geocode) =>
          callback([geocode]),
        );
        for (let index = 0; index < 3; index += 1) callback(["City\n1\nRegion\nJapan"]);
        for (let index = 0; index < 2; index += 1) callback(["Town\n2\nRegion\nFrance"]);
      },
    };
    await expect(fetchGuessRegions({ database: database as any })).resolves.toEqual([
      { country: "Japan", count: 4 },
      { country: "France", count: 3 },
    ]);
  });

  it("fetches random and deterministically seeded photo sets", async () => {
    const randomDatabase = {
      exec: ({ callback, bind }: ExecArgs) => {
        expect(bind).toEqual(["../albums/test-simple/%", "Japan", "Japan", 2]);
        callback(["b.jpg", "b exif", "b geo"]);
      },
    };
    await expect(
      fetchGuessPhotos({
        database: randomDatabase as any,
        count: 2,
        filter: "test-simple",
        region: "Japan",
      }),
    ).resolves.toEqual([{ path: "b.jpg", exif: "b exif", geocode: "b geo" }]);

    const seededDatabase = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("SELECT path FROM images")) {
          callback(["a.jpg"]);
          callback(["b.jpg"]);
          callback(["c.jpg"]);
          return;
        }
        callback(["c.jpg", "c exif", "c geo"]);
        callback(["a.jpg", "a exif", "a geo"]);
      },
    };
    const first = await fetchGuessPhotos({
      database: seededDatabase as any,
      count: 2,
      seed: "round-one",
    });
    const second = await fetchGuessPhotos({
      database: seededDatabase as any,
      count: 2,
      seed: "round-one",
    });
    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
  });

  it("returns no seeded photos when there are no candidates", async () => {
    const database = { exec: () => {} };
    await expect(
      fetchGuessPhotos({ database: database as any, count: 4, seed: "empty" }),
    ).resolves.toEqual([]);
  });

  it("returns no regions when their query fails", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const database = {
      exec: () => {
        throw new Error("regions unavailable");
      },
    };
    await expect(fetchGuessRegions({ database: database as any })).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith("Failed to fetch guess regions", expect.any(Error));
    error.mockRestore();
  });

  it("shuffles deterministically without changing the source", () => {
    const source = [1, 2, 3, 4, 5];
    const first = seededShuffle(source, "same seed");
    expect(seededShuffle(source, "same seed")).toEqual(first);
    expect(seededShuffle(source, "different seed")).not.toEqual(first);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect(seededShuffle([], "empty")).toEqual([]);
  });
});

describe("query error contracts", () => {
  const failingDatabase = () => ({
    exec: () => {
      throw new Error("SQLITE_ERROR: storage unavailable");
    },
  });

  it.each([
    [
      "keyword",
      () =>
        fetchResults({ database: failingDatabase() as any, query: "cat", page: 0, pageSize: 2 }),
    ],
    [
      "similar",
      () =>
        fetchSimilarResults({
          database: failingDatabase() as any,
          path: "cat.jpg",
          page: 0,
          pageSize: 2,
        }),
    ],
    [
      "colour",
      () =>
        fetchColorSimilarResults({
          database: failingDatabase() as any,
          color: [1, 2, 3],
          page: 0,
          pageSize: 2,
        }),
    ],
    [
      "semantic",
      () =>
        fetchSemanticResults({
          database: failingDatabase() as any,
          textQuery: "cat",
          textVector: [1],
          page: 0,
          pageSize: 2,
        }),
    ],
    [
      "hybrid",
      () =>
        fetchHybridResults({
          database: failingDatabase() as any,
          textQuery: "cat",
          textVector: [1],
          page: 0,
          pageSize: 2,
        }),
    ],
    ["tags", () => fetchTags({ database: failingDatabase() as any, page: 0, pageSize: 2 })],
    ["recent", () => fetchRecentResults({ database: failingDatabase() as any, pageSize: 2 })],
    [
      "memories",
      () => fetchMemoryCandidates({ database: failingDatabase() as any, todayDate: "2026-01-01" }),
    ],
    ["random", () => fetchRandomResults({ database: failingDatabase() as any, pageSize: 2 })],
    ["slideshow", () => fetchSlideshowPhotos({ database: failingDatabase() as any })],
    ["random photo", () => fetchRandomPhoto({ database: failingDatabase() as any })],
    ["guess photos", () => fetchGuessPhotos({ database: failingDatabase() as any, count: 2 })],
  ])("rejects a failed %s query", async (_name, request) => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(request()).rejects.toThrow("storage unavailable");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("search API pure query helpers", () => {
  it("parses database EXIF defensively", () => {
    expect(searchInternals.parseDbExifString("")).toEqual({});
    const parsed = searchInternals.parseDbExifString(
      [
        "Image Make: FUJIFILM",
        "Image Model: X-T5",
        "EXIF FocalLength: 23",
        "EXIF FNumber: invalid",
        "EXIF ExposureTime: 0.01",
        "EXIF ISOSpeedRatings:",
        "EXIF DateTimeOriginal: 2024:01:02 03:04:05",
        "EXIF OffsetTime: +08:00",
        "",
      ].join("\n"),
    );
    expect(parsed).toMatchObject({
      Make: "FUJIFILM",
      Model: "X-T5",
      FocalLength: 23,
      FNumber: undefined,
      ExposureTime: 0.01,
      ISO: undefined,
      DateTimeOriginal: "2024:01:02 03:04:05",
      OffsetTime: "+08:00",
    });
  });

  it("builds every supported facet clause and ignores invalid selections", () => {
    const clause = searchInternals.buildFacetWhereClause(
      [
        { facetId: "hour", value: "09:00" },
        { facetId: "focal-length-35mm", value: "<24mm · ultra-wide" },
        { facetId: "focal-length-actual", value: "100mm+ · long tele" },
        { facetId: "aperture", value: "around f/4" },
        { facetId: "year", value: "2024" },
        { facetId: "lens", value: "XF23mm" },
        { facetId: "camera", value: "FUJIFILM X-T5" },
        { facetId: "camera", value: "Mavica" },
        { facetId: "unknown", value: "ignored" },
        { facetId: "hour", value: "invalid" },
        { facetId: "iso", value: "invalid" },
      ],
      true,
    );
    expect(clause.sql).toContain("<= ?");
    expect(clause.sql).toContain(">= ?");
    expect(clause.sql).toContain("substr(");
    expect(clause.sql).toContain(" OR ");
    expect(clause.sql).toContain(" AND ");
    expect(clause.bind).toContain("%EXIF LensModel:XF23mm%");
    expect(clause.bind).toContain("%Image Make:FUJIFILM%");
    expect(clause.bind).not.toContain("ignored");
    expect(
      searchInternals.buildFacetWhereClause([{ facetId: "unknown", value: "x" }], true),
    ).toEqual({ sql: "", bind: [] });
  });

  it("handles cosine edge cases, snippet fallbacks, and tied fusion ranks", () => {
    expect(searchInternals.cosineSimilarity([], [])).toBe(0);
    expect(searchInternals.cosineSimilarity([1], [1, 2])).toBe(0);
    expect(searchInternals.cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(searchInternals.cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(searchInternals.getResultSnippet({ snippet: "snippet" } as any)).toBe("snippet");
    expect(searchInternals.getResultSnippet({ alt_text: "alt" } as any)).toBe("alt");
    expect(searchInternals.getResultSnippet({ subject: "subject" } as any)).toBe("subject");
    expect(searchInternals.getResultSnippet({ tags: "tags" } as any)).toBe("tags");

    expect(
      searchInternals.fuseRankingsWithRrf({
        keywordResults: [{ path: "keyword", bm25: -1 }],
        vectorResults: [{ path: "vector", similarity: 0.8 }],
      }),
    ).toEqual([
      expect.objectContaining({ path: "vector", similarity: 0.8 }),
      expect.objectContaining({ path: "keyword", bm25: -1 }),
    ]);
    expect(
      searchInternals.fuseRankingsWithRrf({
        keywordResults: [
          { path: "first", bm25: -1 },
          { path: "second", bm25: -2 },
        ],
        vectorResults: [],
      }),
    ).toHaveLength(2);
    expect(
      searchInternals.compareFusedResults(
        { path: "left", rrfScore: 1 },
        { path: "right", rrfScore: 1, similarity: 0.5 },
      ),
    ).toBeGreaterThan(0);
    expect(
      searchInternals.compareFusedResults(
        { path: "left", rrfScore: 1, similarity: 0.5 },
        { path: "right", rrfScore: 1 },
      ),
    ).toBeLessThan(0);
  });

  it("short-circuits empty path and facet lookups and paginates exec results", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        callback(["one"]);
        callback(["two"]);
      },
    };
    await expect(searchInternals.fetchResultsByPaths(database as any, [])).resolves.toEqual([]);
    await expect(searchInternals.fetchFacetMatchedPaths(database as any, [])).resolves.toEqual(
      new Set(),
    );
    await expect(
      searchInternals.exec(database as any, "SELECT 1", [], { page: 2, pageSize: 2 }),
    ).resolves.toMatchObject({ prev: 1, next: 3 });
  });

  it("treats a failed structured-geocode probe as a legacy database", () => {
    const database = {
      exec: () => {
        throw new Error("old schema");
      },
    };
    expect(hasStructuredGeocode(database as any)).toBe(false);
  });
});

describe("legacy facet catalogue", () => {
  it("derives numeric, camera, lens, year, and positional place options", async () => {
    const firstExif = [
      "Image Make: FUJIFILM",
      "Image Model: X-T5",
      "EXIF LensModel: XF23mm",
      "EXIF FocalLength: 23",
      "EXIF FocalLengthIn35mmFilm: 35",
      "EXIF FNumber: 4",
      "EXIF ISOSpeedRatings: 400",
      "EXIF DateTimeOriginal: 2024:01:02 09:04:05",
      "EXIF OffsetTime: +08:00",
    ].join("\n");
    const secondExif = firstExif.replace("XF23mm", "XF35mm").replace("X-T5", "X-T4");
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("pragma_table_info('metadata')")) return;
        callback([firstExif, "Tokyo\nKanto\nTokyo\nJapan", "2024-01-02"]);
        callback([firstExif, "Tokyo\nKanto\nTokyo\nJapan", "2023-01-02"]);
        callback([secondExif, "Osaka\nKansai\nOsaka\nJapan", "2022-01-02"]);
        callback([secondExif, "Kyoto\nKansai\nKyoto\nJapan", "2022-02-02"]);
        callback(["", ""]);
      },
    };
    const sections = await fetchSearchFacetSections({
      database: database as any,
      activeTerms: [" harbor ", "harbor", ""],
      selectedFacets: [{ facetId: "year", value: "2024" }],
    });
    expect(sections.find((section) => section.facetId === "camera")?.options[0]).toEqual({
      value: "FUJIFILM X-T4",
      count: 2,
    });
    expect(sections.find((section) => section.facetId === "lens")?.options).toEqual([
      { value: "XF23mm", count: 2 },
      { value: "XF35mm", count: 2 },
    ]);
    expect(
      sections.find((section) => section.facetId === "year")?.options.map((item) => item.value),
    ).toEqual(["2024", "2023", "2022"]);
    expect(sections.find((section) => section.facetId === "city")?.options[0]).toEqual({
      value: "Tokyo",
      count: 2,
    });
    expect(sections.find((section) => section.facetId === "hour")?.options).toContainEqual({
      value: "09:00",
      count: 4,
    });
  });

  it("falls back to null when structured place columns contain no value", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("pragma_table_info('metadata')")) {
          callback([1]);
          return;
        }
        callback(["", "", ""]);
      },
    };
    await expect(fetchSearchFacetSections({ database: database as any })).resolves.toEqual([]);
  });
});

describe("keyword and refinement edge cases", () => {
  it("handles colour matches, empty colour sets, facets, and browse ordering", async () => {
    const sqlCalls: string[] = [];
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        sqlCalls.push(sql);
        if (sql.includes("pragma_table_info('metadata')")) return;
        if (sql.includes("SELECT images.path, images.colors")) {
          callback(["red.jpg", "[(255,0,0)]"]);
          return;
        }
        callback(imageRow("red.jpg", "[(255,0,0)]"));
      },
    };
    const coloured = await fetchResults({
      database: database as any,
      query: "",
      page: 0,
      pageSize: 3,
      colorSearch: [255, 0, 0],
      colorTolerance: 1,
    });
    expect(coloured.data[0]).toEqual(
      expect.objectContaining({ matchingColor: [255, 0, 0], colorMatchScore: 100 }),
    );
    expect(sqlCalls.some((sql) => sql.includes("ORDER BY COALESCE"))).toBe(true);

    const emptyCalls: string[] = [];
    const emptyDatabase = {
      exec: ({ sql, callback }: ExecArgs) => {
        emptyCalls.push(sql);
        if (sql.includes("pragma_table_info('metadata')")) return;
        if (sql.includes("SELECT images.path, images.colors")) {
          callback(["bad.jpg", "not a palette"]);
        }
      },
    };
    await fetchResults({
      database: emptyDatabase as any,
      query: "",
      page: 0,
      pageSize: 3,
      colorSearch: [255, 0, 0],
    });
    expect(emptyCalls.some((sql) => sql.includes("1 = 0"))).toBe(true);

    const facetCalls: string[] = [];
    const facetDatabase = {
      exec: ({ sql }: ExecArgs) => {
        facetCalls.push(sql);
      },
    };
    await fetchResults({
      database: facetDatabase as any,
      query: "",
      page: 0,
      pageSize: 3,
      selectedFacets: [{ facetId: "year", value: "2024" }],
    });
    expect(facetCalls.some((sql) => sql.includes("WHERE ("))).toBe(true);

    const unfilteredCalls: string[] = [];
    await fetchResults({
      database: {
        exec: ({ sql }: ExecArgs) => {
          unfilteredCalls.push(sql);
        },
      } as any,
      query: "",
      page: 0,
      pageSize: 3,
    });
    expect(unfilteredCalls.at(-1)).not.toContain("WHERE (");
  });

  it("returns early when refinement has no candidate or active context", async () => {
    const database = { exec: () => {} };
    await expect(
      fetchRefinementTagCounts({
        database: database as any,
        activeTerms: ["harbor"],
        candidateTags: [" harbor ", ""],
      }),
    ).resolves.toEqual({});
    await expect(
      fetchRefinementTagCounts({
        database: database as any,
        activeTerms: [],
        candidateTags: ["night"],
      }),
    ).resolves.toEqual({});
  });

  it("skips invalid and out-of-tolerance palettes", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("pragma_table_info('metadata')")) return;
        if (sql.includes("SELECT images.path, images.colors")) {
          callback(["invalid.jpg", '[["x","y","z"]]']);
          callback(["blue.jpg", "[(0,0,255)]"]);
        }
      },
    };
    await expect(
      fetchColorSimilarResults({
        database: database as any,
        color: [255, 0, 0],
        maxDistance: 0,
        page: 0,
        pageSize: 3,
      }),
    ).resolves.toMatchObject({ data: [] });
  });
});

describe("vector pagination and missing details", () => {
  it("supports page and offset navigation for similarity results", async () => {
    await expect(
      fetchSimilarResults({
        database: makeDatabase() as any,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ prev: undefined, next: 1 });
    await expect(
      fetchSimilarResults({
        database: makeDatabase() as any,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 1,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ prev: 0 });
    await expect(
      fetchSimilarResults({
        database: makeDatabase() as any,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 1,
        offset: 1,
      }),
    ).resolves.toMatchObject({ prev: 0 });
  });

  it("returns no similarity result for a missing or non-array seed embedding", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("PRAGMA table_info")) callback([0, "embedding_json"]);
        if (sql.includes("WHERE path = ?") && bind?.[0] === "object.jpg") {
          callback(["object.jpg", "model", 1, '{"value":1}']);
        }
      },
    };
    await expect(
      fetchSimilarResults({
        database: database as any,
        path: "missing.jpg",
        page: 0,
        pageSize: 2,
      }),
    ).resolves.toMatchObject({ data: [] });
    await expect(
      fetchSimilarResults({
        database: database as any,
        path: "object.jpg",
        page: 0,
        pageSize: 2,
      }),
    ).resolves.toMatchObject({ data: [] });
  });

  it("drops ranked candidates whose image details disappeared", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("PRAGMA table_info")) callback([0, "embedding_json"]);
        if (sql.includes("WHERE path = ?")) callback(["seed.jpg", "model", 1, "[1]"]);
        if (sql.includes("WHERE model_id = ?")) callback(["gone.jpg", "model", 1, "[1]"]);
      },
    };
    await expect(
      fetchSimilarResults({ database: database as any, path: "seed.jpg", page: 0, pageSize: 2 }),
    ).resolves.toMatchObject({ data: [] });
  });

  it("supports a zero similarity offset and an empty hybrid keyword ranking", async () => {
    await expect(
      fetchSimilarResults({
        database: makeDatabase() as any,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({ prev: undefined, next: 1 });
    await expect(
      fetchHybridResults({
        database: makeDatabase() as any,
        textQuery: "semantic only",
        keywordQuery: " | ",
        textVector: [1, 0, 0],
        page: 0,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: expect.any(Array) });
  });
});

describe("vector filtering and pagination", () => {
  const vectorDatabase = (includeDetails: boolean) => ({
    exec: ({ sql, callback }: ExecArgs) => {
      if (sql.includes("pragma_table_info('metadata')")) return;
      if (sql.includes("PRAGMA table_info(embeddings)")) {
        callback([0, "embedding_json"]);
        return;
      }
      if (sql.includes("SELECT images.path, images.colors")) {
        callback(["a.jpg", "[(255,0,0)]"]);
        callback(["b.jpg", "[(255,0,0)]"]);
        return;
      }
      if (sql.includes("FROM embeddings") && sql.includes("WHERE model_id")) {
        callback(["a.jpg", "google/siglip-base-patch16-224", 2, "[1,0]"]);
        callback(["b.jpg", "google/siglip-base-patch16-224", 2, "[0.8,0.2]"]);
        callback(["c.jpg", "google/siglip-base-patch16-224", 2, "[0,1]"]);
        return;
      }
      if (sql.includes("bm25(images)")) {
        callback(["a.jpg", -2]);
        callback(["b.jpg", -1]);
        callback(["c.jpg", -0.5]);
        return;
      }
      if (sql.includes("SELECT images.path") && !sql.includes("images.colors")) {
        callback(["a.jpg"]);
        callback(["b.jpg"]);
        return;
      }
      if (includeDetails && sql.includes("WHERE path IN")) {
        callback(imageRow("a.jpg", "[(255,0,0)]"));
        callback(imageRow("b.jpg", "[(255,0,0)]"));
        callback(imageRow("c.jpg", "[(0,0,255)]"));
      }
    },
  });

  it("composes semantic colour filters and exposes vector pagination", async () => {
    const page = await fetchSemanticResults({
      database: vectorDatabase(true) as any,
      textQuery: "red",
      textVector: [1, 0],
      colorSearch: [255, 0, 0],
      colorTolerance: 1,
      selectedFacets: [{ facetId: "year", value: "2024" }],
      page: 0,
      pageSize: 1,
    });
    expect(page).toMatchObject({ prev: undefined, next: 1 });
    expect(page.data[0]).toEqual(expect.objectContaining({ matchingColor: [255, 0, 0] }));

    await expect(
      fetchSemanticResults({
        database: vectorDatabase(true) as any,
        textQuery: "red",
        textVector: [1, 0],
        page: 1,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ prev: 0, next: 2 });
  });

  it("composes hybrid colour filters and drops unresolved details", async () => {
    const page = await fetchHybridResults({
      database: vectorDatabase(true) as any,
      textQuery: "red",
      textVector: [1, 0],
      colorSearch: [255, 0, 0],
      colorTolerance: 1,
      page: 0,
      pageSize: 1,
    });
    expect(page).toMatchObject({ prev: undefined, next: 1 });
    expect(page.data[0]).toEqual(expect.objectContaining({ matchingColor: [255, 0, 0] }));

    await expect(
      fetchHybridResults({
        database: vectorDatabase(false) as any,
        textQuery: "red",
        textVector: [1, 0],
        page: 1,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: [], prev: 0, next: 2 });
  });

  it("drops unresolved semantic and colour detail rows", async () => {
    await expect(
      fetchSemanticResults({
        database: vectorDatabase(false) as any,
        textQuery: "red",
        textVector: [1, 0],
        page: 0,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: [] });
    await expect(
      fetchColorSimilarResults({
        database: vectorDatabase(false) as any,
        color: [255, 0, 0],
        page: 1,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: [], prev: 0 });
    await expect(
      fetchColorSimilarResults({
        database: vectorDatabase(false) as any,
        color: [255, 0, 0],
        page: 0,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: [], next: 1 });
  });

  it("returns an empty hybrid page if detail lookup loses the embeddings table", async () => {
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("PRAGMA table_info")) {
          throw new Error("no such table: embeddings");
        }
        if (sql.includes("bm25(images)")) callback(["a.jpg", -1]);
        if (sql.includes("WHERE path IN")) throw new Error("no such table: embeddings");
      },
    };
    await expect(
      fetchHybridResults({
        database: database as any,
        textQuery: "red",
        textVector: [1],
        page: 0,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ data: [] });
  });
});

describe("browse snippet fallbacks", () => {
  it("falls back through subject, tags, and filename", async () => {
    const rows = [
      imageRow("subject.jpg").map((value, index) =>
        index === 7 ? "" : index === 8 ? "Subject" : value,
      ),
      imageRow("tags.jpg").map((value, index) => (index === 7 || index === 8 ? "" : value)),
      imageRow("filename.jpg").map((value, index) =>
        index === 5 || index === 7 || index === 8 ? "" : value,
      ),
    ];
    const database = {
      exec: ({ sql, callback }: ExecArgs) => {
        if (sql.includes("pragma_table_info")) return;
        rows.forEach((row) => callback(row));
      },
    };
    const recent = await fetchRecentResults({ database: database as any, pageSize: 3 });
    const random = await fetchRandomResults({ database: database as any, pageSize: 3 });
    expect(recent.map((row) => row.snippet)).toEqual(["Subject", "tag", "filename.jpg"]);
    expect(random.map((row) => row.snippet)).toEqual(["Subject", "tag", "filename.jpg"]);
  });

  it("defaults a missing memory date and uses its final snippet fallbacks", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        const row = imageRow("memory.jpg");
        row[5] = "";
        row[7] = "";
        row[8] = "";
        callback(row.slice(0, 9));
      },
    };
    await expect(
      fetchMemoryCandidates({ database: database as any, todayDate: "2026-01-01" }),
    ).resolves.toEqual([expect.objectContaining({ isoDate: "", snippet: "memory.jpg" })]);
  });
});
