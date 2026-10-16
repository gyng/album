const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
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

// A clip's own file holds no pixels sharp can read, so its framing comes from
// the poster frame the video prepass extracted — and the prepass records that
// frame's dimensions in the clip's sidecar next to the database's album cache.
const videoFixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "search-framing-video-"));
  const databasePath = path.join(directory, "search.sqlite");
  const video = path.join(directory, "albums", "trip", "clip.mp4");
  const sidecar = path.join(
    directory,
    "data",
    "albums",
    "trip",
    ".resized_videos",
    "clip.mp4@poster.json",
  );
  const db = new DatabaseSync(databasePath);
  db.exec(
    "CREATE TABLE images(path TEXT); CREATE TABLE metadata(path TEXT PRIMARY KEY, weather_json TEXT)",
  );
  mkdirSync(path.dirname(video), { recursive: true });
  writeFileSync(video, "not an image");
  // A scene lives in the archive under the clip's name plus its offset and has
  // no file of its own; its framing is the clip's.
  const insert = db.prepare("INSERT INTO images VALUES (?)");
  insert.run(video);
  insert.run(`${video}@t60`);
  return { directory, databasePath, video, sidecar, db };
};

it("indexes a clip and its scenes from the framing the poster prepass recorded", async () => {
  const { directory, databasePath, video, sidecar, db } = videoFixture();
  try {
    mkdirSync(path.dirname(sidecar), { recursive: true });
    writeFileSync(sidecar, JSON.stringify({ mediaKind: "video", width: 1920, height: 1080 }));

    await prepareSearchFraming(databasePath);

    const framing = db.prepare("SELECT aspect_ratio, orientation FROM metadata WHERE path = ?");
    expect(framing.get(video)).toEqual({ aspect_ratio: "16:9", orientation: "Landscape" });
    expect(framing.get(`${video}@t60`)).toEqual({ aspect_ratio: "16:9", orientation: "Landscape" });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("leaves framing empty when a clip has no poster in the cache", async () => {
  const { directory, databasePath, video, db } = videoFixture();
  try {
    await prepareSearchFraming(databasePath);

    expect(
      db.prepare("SELECT aspect_ratio, orientation FROM metadata WHERE path = ?").get(video),
    ).toEqual({ aspect_ratio: null, orientation: null });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
