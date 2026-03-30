import {
  fetchColorSimilarResults,
  fetchMemoryCandidates,
  fetchSearchFacetSections,
  fetchHybridResults,
  fetchRandomPhoto,
  fetchRecentResults,
  fetchRefinementTagCounts,
  fetchSemanticResults,
  fetchSimilarResults,
  searchInternals,
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

      if (
        sql.includes("FROM embeddings") &&
        sql.includes("WHERE model_id = ?")
      ) {
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
    expect(results.data[1]?.path).toBe(
      "../albums/test-simple/DSCF2581-2_2.jpg",
    );
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
      exec: ({ sql, bind, callback }: ExecArgs) => {
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
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (sql.includes("FROM embeddings") && sql.includes("WHERE path = ?")) {
          callback([
            "../albums/test-simple/DSCF0506-2.jpg",
            "google/siglip-base-patch16-224",
            3,
            JSON.stringify([1, 0, 0]),
          ]);
          return;
        }

        if (
          sql.includes("FROM embeddings") &&
          sql.includes("WHERE model_id = ?")
        ) {
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

describe("fetchColorSimilarResults", () => {
  it("filters color results by selected facets", async () => {
    const database = {
      exec: ({ sql, bind, callback }: ExecArgs) => {
        if (
          sql.includes("SELECT images.path, images.colors FROM images") &&
          sql.includes("images.geocode LIKE ? OR images.geocode LIKE ?")
        ) {
          expect(bind).toEqual(["%\nTokyo\n%", "%\nTokyo"]);
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            "[(255,0,0), (0,0,0)]",
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

        if (
          sql.includes("FROM embeddings") &&
          sql.includes("WHERE model_id = ?")
        ) {
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
          expect(bind).toEqual([`- {path album_relative_path} : "harbor"`]);
          callback([
            "../albums/test-simple/DSCF0593.jpg",
            0.9,
          ]);
          callback([
            "../albums/test-simple/DSCF2581-2_2.jpg",
            0.5,
          ]);
          return;
        }

        if (
          sql.includes("FROM embeddings") &&
          sql.includes("WHERE model_id = ?")
        ) {
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

        if (
          sql.includes("FROM embeddings") &&
          sql.includes("WHERE model_id = ?")
        ) {
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
            `- {path album_relative_path} : "bird"`,
            `- {path album_relative_path} : "harbor"`,
            "night",
            `- {path album_relative_path} : "bird"`,
            `- {path album_relative_path} : "night"`,
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
            `- {path album_relative_path} : "harbor"`,
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
          "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
          "2024-03-22",
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

    expect(
      sections.find((section) => section.facetId === "camera")?.options,
    ).toEqual([{ value: "FUJIFILM X-T5", count: 1 }]);
    expect(
      sections.find((section) => section.facetId === "region")?.options,
    ).toEqual([{ value: "Tokyo", count: 1 }]);
    expect(
      sections.find((section) => section.facetId === "subregion")?.options,
    ).toEqual([{ value: "Tokyo", count: 1 }]);
    expect(
      sections.find((section) => section.facetId === "city")?.options,
    ).toEqual([{ value: "Shinjuku-ku", count: 1 }]);
    expect(
      sections.find((section) => section.facetId === "year")?.options,
    ).toEqual([{ value: "2024", count: 1 }]);
    expect(
      sections.find((section) => section.facetId === "hour")?.options,
    ).toEqual([{ value: "17:00", count: 1 }]);
    expect(
      calls.some(({ bind }) =>
        bind?.includes(`- {path album_relative_path} : "harbor"`),
      ),
    ).toBe(true);
    expect(
      calls.some(
        ({ sql, bind }) =>
          sql.includes("images.geocode LIKE ? OR images.geocode LIKE ?") &&
          bind?.includes("%\nJapan"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        ({ bind }) =>
          bind?.includes("%Image Model:FUJIFILM X-T5%") &&
          bind?.includes("%Image Make:FUJIFILM%"),
      ),
    ).toBe(true);
  });
});

describe("fetchRandomPhoto", () => {
  it("returns an empty array when the database has no matching rows", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        // return no rows
      },
    };

    const result = await fetchRandomPhoto({ database: database as any });

    expect(result).toEqual([]);
  });
});

describe("exec", () => {
  it("resolves with rows collected from the callback", async () => {
    const database = {
      exec: ({ callback }: ExecArgs) => {
        callback(["path/a.jpg", "/album/a#a.jpg", "a.jpg", "", "", "tag", "[(0,0,0)]", "Alt", "", "", "", ""]);
        callback(["path/b.jpg", "/album/b#b.jpg", "b.jpg", "", "", "tag", "[(0,0,0)]", "Alt", "", "", "", ""]);
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

    await expect(
      searchInternals.exec(database as any, "SELECT 1", []),
    ).rejects.toThrow("no such table: images");
  });
});
