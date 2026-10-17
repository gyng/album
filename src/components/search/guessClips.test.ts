import { DatabaseSync } from "node:sqlite";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { fetchGuessPhotos, fetchGuessRegions } from "./api";

// A clip's place is in `metadata`, not in EXIF text — its EXIF in the index is
// "{}" — so a game that drew rounds by "exif mentions GPSLatitude" never dealt
// a clip at all. Its minute moments carry the clip's place and must not each
// become a round of their own.
describe("Guess with clips", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE VIRTUAL TABLE images USING fts5(path, exif, geocode); CREATE TABLE metadata(path TEXT, lat_deg REAL, lng_deg REAL, scene_of TEXT)",
  );
  const insert = (path: string, exif: string, lat: number | null, sceneOf: string | null) => {
    sqlite.prepare("INSERT INTO images VALUES (?, ?, ?)").run(path, exif, "Minato\nTokyo\nJapan");
    sqlite.prepare("INSERT INTO metadata VALUES (?, ?, ?, ?)").run(path, lat, lat, sceneOf);
  };
  for (let i = 0; i < 3; i += 1) {
    insert(`../albums/tokyo/${i}.jpg`, '{"GPSLatitude":[35,39,37]}', 35.66, null);
  }
  insert("../albums/tokyo/clip.mov", "{}", 35.66, null);
  insert("../albums/tokyo/clip.mov@t60", "{}", 35.66, "../albums/tokyo/clip.mov");
  insert("../albums/tokyo/nowhere.jpg", "{}", null, null);

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

  afterAll(() => sqlite.close());

  it("deals a geotagged clip, with its place, and never its moments", async () => {
    const rows = await fetchGuessPhotos({ database, count: 10 });
    const paths = rows.map((row) => row.path).sort();

    expect(paths).toEqual([
      "../albums/tokyo/0.jpg",
      "../albums/tokyo/1.jpg",
      "../albums/tokyo/2.jpg",
      "../albums/tokyo/clip.mov",
    ]);
    expect(rows.find((row) => row.path === "../albums/tokyo/clip.mov")).toMatchObject({
      latDeg: 35.66,
      lngDeg: 35.66,
    });
  });

  it("counts a clip towards the regions a game can be played in", async () => {
    await expect(fetchGuessRegions({ database })).resolves.toEqual([
      { country: "Japan", count: 4 },
    ]);
  });
});
