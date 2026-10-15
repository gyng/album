import { DatabaseSync } from "node:sqlite";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { fetchRefinementTagCounts } from "./api";

const fixture = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE VIRTUAL TABLE images USING fts5(path, album_relative_path, exif, colors, tags, geocode);
    CREATE TABLE metadata(path TEXT, iso8601 TEXT);`);
  for (const [path, tags, year] of [
    ["one", "cat harbor night", "2024"],
    ["two", "cat harbor", "2025"],
    ["three", "bird night", "2024"],
    ["four", "cat harbor master", "2024"],
  ] as const) {
    sqlite.prepare("INSERT INTO images VALUES (?, '', '', '', ?, 'Japan')").run(path, tags);
    sqlite.prepare("INSERT INTO metadata VALUES (?, ?)").run(path, `${year}-01-01`);
  }
  let tagScans = 0;
  const database = {
    exec: ({
      sql,
      bind = [],
      callback,
    }: {
      sql: string;
      bind?: (string | number)[];
      callback: (row: unknown[]) => void;
    }) => {
      if (sql.includes("json_group_array") || sql.includes("COUNT(*) AS count")) tagScans++;
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      for (const row of statement.all(...bind)) callback(row as unknown as unknown[]);
    },
  } as unknown as Database;
  return { sqlite, database, tagScans: () => tagScans };
};

it("reuses tag matches while applying new terms, phrases and facets exactly", async () => {
  const { sqlite, database, tagScans } = fixture();
  try {
    const candidateTags = ["harbor", "night", "harbor master", "missing", "cat", " NIGHT "];
    expect(
      await fetchRefinementTagCounts({ database, activeTerms: ["cat"], candidateTags }),
    ).toEqual({
      harbor: 3,
      night: 1,
      "harbor master": 1,
      missing: 0,
    });
    const scans = tagScans();
    expect(
      await fetchRefinementTagCounts({
        database,
        activeTerms: ["cat", "harbor"],
        candidateTags,
        selectedFacets: [{ facetId: "year", value: "2024" }],
      }),
    ).toEqual({
      night: 1,
      "harbor master": 1,
      missing: 0,
    });
    expect(tagScans()).toBe(scans);
    expect(
      await fetchRefinementTagCounts({
        database,
        activeTerms: [],
        candidateTags,
        selectedFacets: [{ facetId: "year", value: "2024" }],
      }),
    ).toEqual({
      harbor: 2,
      night: 2,
      "harbor master": 1,
      missing: 0,
      cat: 2,
    });
  } finally {
    sqlite.close();
  }
});

it("does not share cached matches between database generations", async () => {
  const first = fixture();
  const next = fixture();
  try {
    const options = { activeTerms: ["cat"], candidateTags: ["harbor"] };
    expect(await fetchRefinementTagCounts({ database: first.database, ...options })).toEqual({
      harbor: 3,
    });
    next.sqlite.exec("DELETE FROM images WHERE path = 'one'");
    expect(await fetchRefinementTagCounts({ database: next.database, ...options })).toEqual({
      harbor: 2,
    });
  } finally {
    first.sqlite.close();
    next.sqlite.close();
  }
});
