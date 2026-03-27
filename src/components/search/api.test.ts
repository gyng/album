import { fetchSimilarResults } from "./api";

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

    expect(results.data).toHaveLength(2);
    expect(results.data[0].path).toBe("../albums/test-simple/DSCF0593.jpg");
    expect(results.data[1].path).toBe("../albums/test-simple/DSCF2581-2_2.jpg");
    const firstSimilarity = Number(results.data[0].similarity ?? 0);
    const secondSimilarity = Number(results.data[1].similarity ?? 0);
    expect(firstSimilarity).toBeGreaterThan(secondSimilarity);
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
