import {
  fetchRecentResults,
  fetchRefinementTagCounts,
  fetchSimilarResults,
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
            "google/siglip2-base-patch16-224",
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
          "google/siglip2-base-patch16-224",
          3,
          JSON.stringify([1, 0, 0]),
        ]);
        callback([
          "../albums/test-simple/DSCF0593.jpg",
          "google/siglip2-base-patch16-224",
          3,
          JSON.stringify([0.9, 0.1, 0]),
        ]);
        callback([
          "../albums/test-simple/DSCF2581-2_2.jpg",
          "google/siglip2-base-patch16-224",
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
});
