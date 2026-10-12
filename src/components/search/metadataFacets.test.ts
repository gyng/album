import { DatabaseSync } from "node:sqlite";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { fetchSearchFacetSections, searchInternals } from "./api";
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
