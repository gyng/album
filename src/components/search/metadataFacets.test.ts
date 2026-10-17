import { DatabaseSync } from "node:sqlite";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { fetchResults, fetchSearchFacetSections, searchInternals } from "./api";
import { weatherFixture } from "../../test/fixtures/weather";
import { weatherFacetValue } from "../../util/metadataFacets";

const createDatabase = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE images(path TEXT, exif TEXT, geocode TEXT); CREATE TABLE metadata(path TEXT, iso8601 TEXT, aspect_ratio TEXT, orientation TEXT, weather_json TEXT)",
  );
  const insert = sqlite.prepare("INSERT INTO metadata VALUES (?, '2026-10-01', ?, ?, ?)");
  for (const [path, ratio, orientation, weather] of [
    [
      "clear-landscape",
      "3:2",
      "Landscape",
      { ...weatherFixture, weather_code: 1, temperature_2m: 29, precipitation: 0, cloud_cover: 24 },
    ],
    [
      "rain-portrait",
      "2:3",
      "Portrait",
      {
        ...weatherFixture,
        weather_code: 61,
        temperature_2m: 10,
        precipitation: 2,
        cloud_cover: 75,
      },
    ],
    [
      "clear-portrait",
      "2:3",
      "Portrait",
      {
        ...weatherFixture,
        weather_code: 1,
        temperature_2m: 30,
        precipitation: null,
        cloud_cover: null,
      },
    ],
    ["missing", "1:1", "Square", null],
  ] as const) {
    sqlite.prepare("INSERT INTO images VALUES (?, '', '')").run(path);
    insert.run(path, ratio, orientation, weather ? JSON.stringify(weather) : null);
  }
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
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      for (const row of statement.all(...bind)) callback(row as unknown as unknown[]);
    },
  } as unknown as Database;
  return { sqlite, database };
};

it("filters weather and framing together with OR inside a facet and AND between facets", () => {
  const { sqlite } = createDatabase();
  try {
    const clause = searchInternals.buildFacetWhereClause(
      [
        { facetId: "weather-condition", value: "Mostly clear" },
        { facetId: "orientation", value: "Portrait" },
        { facetId: "aspect-ratio", value: "3:2" },
        { facetId: "aspect-ratio", value: "2:3" },
      ],
      false,
    );
    expect(
      sqlite.prepare(`SELECT path FROM images WHERE ${clause.sql}`).all(...clause.bind),
    ).toEqual([{ path: "clear-portrait" }]);
  } finally {
    sqlite.close();
  }
});

it("uses the same boundary labels in SQL and Explore and excludes missing weather", () => {
  const { sqlite } = createDatabase();
  try {
    const rows = sqlite
      .prepare("SELECT path, weather_json FROM metadata WHERE weather_json IS NOT NULL")
      .all();
    for (const row of rows)
      for (const facetId of [
        "weather-condition",
        "weather-temperature",
        "weather-cloud",
        "weather-precipitation",
      ]) {
        const value = weatherFacetValue(facetId, row.weather_json);
        if (value === null) continue;
        const clause = searchInternals.buildFacetWhereClause([{ facetId, value }], false);
        const found = sqlite
          .prepare(`SELECT path FROM images WHERE ${clause.sql}`)
          .all(...clause.bind)
          .map((item) => item.path);
        expect(found).toContain(row.path);
        expect(found).not.toContain("missing");
      }
  } finally {
    sqlite.close();
  }
});

it("recalculates metadata facet counts against the other active facets", async () => {
  const { sqlite, database } = createDatabase();
  try {
    const sections = await fetchSearchFacetSections({
      database,
      selectedFacets: [
        { facetId: "orientation", value: "Portrait" },
        { facetId: "weather-condition", value: "Mostly clear" },
      ],
    });
    expect(sections.find((section) => section.facetId === "aspect-ratio")?.options).toEqual([
      { value: "2:3", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "weather-condition")?.options).toEqual([
      { value: "Mostly clear", count: 1 },
      { value: "Rain", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "weather-cloud")).toBeUndefined();
  } finally {
    sqlite.close();
  }
});

// A long clip is indexed a minute at a time, and each moment inherits the
// clip's place, weather and framing. Moments are for semantic search only:
// counted in facets, a half-hour clip filmed in the rain added thirty to
// "Rain", and a facet-only browse returned thirty near-identical tiles.
it("keeps a clip's indexed moments out of facet counts and facet browsing", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE images(path TEXT, album_relative_path TEXT, filename TEXT, geocode TEXT, exif TEXT, tags TEXT, colors TEXT, alt_text TEXT, subject TEXT); CREATE TABLE metadata(path TEXT, iso8601 TEXT, aspect_ratio TEXT, orientation TEXT, weather_json TEXT, scene_of TEXT)",
  );
  const rain = JSON.stringify({ ...weatherFixture, weather_code: 61, precipitation: 2 });
  for (const [path, sceneOf] of [
    ["../albums/trip/clip.mov", null],
    ["../albums/trip/clip.mov@t60", "../albums/trip/clip.mov"],
    ["../albums/trip/clip.mov@t120", "../albums/trip/clip.mov"],
  ] as const) {
    sqlite.prepare("INSERT INTO images VALUES (?, '', '', '', '', '', '', '', '')").run(path);
    sqlite
      .prepare("INSERT INTO metadata VALUES (?, '2026-10-01', '16:9', 'Landscape', ?, ?)")
      .run(path, rain, sceneOf);
  }
  const database = {
    exec: ({
      sql,
      bind = [],
      callback,
    }: {
      sql: string;
      bind?: (string | number)[];
      callback?: (row: unknown[]) => void;
    }) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      const rows = statement.all(...bind) as unknown as unknown[][];
      for (const row of rows) callback?.(row);
      return rows;
    },
  } as unknown as Database;
  try {
    const sections = await fetchSearchFacetSections({ database });
    expect(sections.find((section) => section.facetId === "weather-condition")?.options).toEqual([
      { value: "Rain", count: 1 },
    ]);
    expect(sections.find((section) => section.facetId === "orientation")?.options).toEqual([
      { value: "Landscape", count: 1 },
    ]);

    const browse = await fetchResults({
      database,
      query: "",
      pageSize: 10,
      page: 0,
      selectedFacets: [{ facetId: "weather-condition", value: "Rain" }],
    });
    expect(browse.data.map((row) => row.path)).toEqual(["../albums/trip/clip.mov"]);
  } finally {
    sqlite.close();
  }
});

// What is said in a clip, and what happens in it, is in the search index
// (index/clip_timeline.py): a phrase finds the clip it was said in.
it("finds a clip by what is said in it", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE VIRTUAL TABLE images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject, timeline, tokenize='porter trigram'); CREATE TABLE metadata(path TEXT, iso8601 TEXT)",
  );
  sqlite
    .prepare("INSERT INTO images VALUES (?, '', ?, '', '', '', '', ?, '', ?)")
    .run(
      "../albums/trip/clip.mov",
      "clip.mov",
      "A street at night.",
      "A bus pulls in.\nMind the gap.",
    );
  sqlite
    .prepare("INSERT INTO images VALUES (?, '', ?, '', '', '', '', ?, '', '')")
    .run("../albums/trip/a.jpg", "a.jpg", "A street at night.");
  const database = {
    exec: ({
      sql,
      bind = [],
      callback,
    }: {
      sql: string;
      bind?: (string | number)[];
      callback?: (row: unknown[]) => void;
    }) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      const rows = statement.all(...bind) as unknown as unknown[][];
      for (const row of rows) callback?.(row);
      return rows;
    },
  } as unknown as Database;
  try {
    const found = await fetchResults({ database, query: "mind the gap", pageSize: 10, page: 0 });
    expect(found.data.map((row) => row.path)).toEqual(["../albums/trip/clip.mov"]);
  } finally {
    sqlite.close();
  }
});
