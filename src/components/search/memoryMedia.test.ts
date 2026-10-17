import { DatabaseSync } from "node:sqlite";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { fetchMemoryCandidates } from "./api";

// "On this day" tiles showed a clip as a still: unlike the recent and random
// rows, memory candidates never learnt which rows were videos. They are the
// whole dated archive, past any IN-list a separate lookup could bind, so the
// kind comes with the query itself.
it("marks the clips among this day's memories", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE VIRTUAL TABLE images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject); CREATE TABLE metadata(path TEXT, iso8601 TEXT, media_kind TEXT, duration_seconds REAL)",
  );
  for (const [path, kind, duration] of [
    ...Array.from({ length: 1200 }, (_, i) => [`../albums/trip/${i}.jpg`, "photo", null] as const),
    ["../albums/trip/clip.mov", "video", 7.2] as const,
  ]) {
    sqlite.prepare("INSERT INTO images(path, filename) VALUES (?, ?)").run(path, path);
    sqlite
      .prepare("INSERT INTO metadata VALUES (?, '2019-10-17T10:00:00', ?, ?)")
      .run(path, kind, duration);
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
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const memories = await fetchMemoryCandidates({ database, todayDate: "2026-10-17" });
    const clip = memories.find((row) => row.path === "../albums/trip/clip.mov");
    expect(clip).toMatchObject({ mediaKind: "video", durationSeconds: 7.2 });
    expect(memories.find((row) => row.path === "../albums/trip/0.jpg")?.mediaKind).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
    sqlite.close();
  }
});
