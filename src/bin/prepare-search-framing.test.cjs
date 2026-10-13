const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { prepareSearchFraming } = require("./prepare-search-framing.cjs");
it("indexes published dimensions and rotation, then updates framing after a crop", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "search-framing-"));
  const databasePath = path.join(directory, "search.sqlite");
  const source = path.join(directory, "photo.jpg");
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(
      "CREATE TABLE images(path TEXT); CREATE TABLE metadata(path TEXT PRIMARY KEY, weather_json TEXT)",
    );
    db.prepare("INSERT INTO images VALUES (?)").run(source);
    await sharp({ create: { width: 408, height: 307, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(source);
    await prepareSearchFraming(databasePath);
    expect(db.prepare("SELECT aspect_ratio, orientation FROM metadata").get()).toEqual({
      aspect_ratio: "3:4",
      orientation: "Portrait",
    });
    await sharp({ create: { width: 6, height: 6, channels: 3, background: "red" } })
      .jpeg()
      .toFile(source);
    await prepareSearchFraming(databasePath);
    expect(db.prepare("SELECT aspect_ratio, orientation FROM metadata").get()).toEqual({
      aspect_ratio: "1:1",
      orientation: "Square",
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
