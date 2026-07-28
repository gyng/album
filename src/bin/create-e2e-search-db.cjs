#!/usr/bin/env node

const { DatabaseSync } = require("node:sqlite");
const { existsSync, mkdirSync, renameSync, rmSync } = require("node:fs");
const path = require("node:path");

const pathArgument = (args, flag, fallback) => {
  const flagIndex = args.indexOf(flag);
  return path.resolve(flagIndex >= 0 && args[flagIndex + 1] ? args[flagIndex + 1] : fallback);
};

const parseArgs = (args) => ({
  outputPath: pathArgument(
    args,
    "--output",
    path.join(__dirname, "..", "public", "e2e-search.sqlite"),
  ),
  embeddingsOutputPath: pathArgument(
    args,
    "--embeddings-output",
    path.join(__dirname, "..", "public", "e2e-search-embeddings.sqlite"),
  ),
  force: args.includes("--force"),
});

const coordinateRef = (value, negative, positive) => (value < 0 ? negative : positive);

const encodeEmbedding = (embedding) => {
  const maxMagnitude = Math.max(...embedding.map((value) => Math.abs(value)));
  const scale = maxMagnitude === 0 ? 1 : maxMagnitude / 127;
  const quantised = Int8Array.from(
    embedding.map((value) => Math.max(-127, Math.min(127, Math.round(value / scale)))),
  );
  return { blob: Buffer.from(quantised.buffer), scale };
};

const createE2eSearchDatabases = ({ outputPath, embeddingsOutputPath, force = false }) => {
  if (existsSync(outputPath) && existsSync(embeddingsOutputPath) && !force) {
    return { created: false, outputPath, embeddingsOutputPath };
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  mkdirSync(path.dirname(embeddingsOutputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const temporaryEmbeddingsPath = `${embeddingsOutputPath}.tmp-${process.pid}`;
  rmSync(temporaryPath, { force: true });
  rmSync(temporaryEmbeddingsPath, { force: true });

  const db = new DatabaseSync(temporaryPath);
  const embeddingsDb = new DatabaseSync(temporaryEmbeddingsPath);
  db.exec(`
  PRAGMA page_size = 4096;
  CREATE VIRTUAL TABLE images USING fts5(
    path,
    album_relative_path,
    filename,
    geocode,
    exif,
    tags,
    colors,
    alt_text,
    subject,
    tokenize='porter trigram'
  );
  CREATE TABLE tags (tag TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE metadata (
    path TEXT PRIMARY KEY,
    lat_deg REAL,
    lng_deg REAL,
    iso8601 TEXT,
    geo_city TEXT,
    geo_region TEXT,
    geo_subregion TEXT,
    geo_country TEXT,
    media_kind TEXT NOT NULL DEFAULT 'photo',
    duration_seconds REAL,
    scene_seconds REAL,
    scene_of TEXT
  );
`);
  embeddingsDb.exec(`
  PRAGMA page_size = 4096;
  CREATE TABLE embeddings (
    path TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedding_dim INTEGER,
    embedding_blob BLOB,
    embedding_scale REAL,
    PRIMARY KEY(path, model_id)
  );
  CREATE INDEX idx_embeddings_path ON embeddings(path);
`);

  const photos = [
    {
      filename: "DSCF0506-2.jpg",
      date: "2019-11-06T10:48:19",
      location: [36.578858, 137.595973, "Kamiichi", "Toyama", "Nakaniikawa Gun", "Japan"],
      tags: "japan, mountain, snow",
      alt: "Snowy mountains above Kamiichi in Japan.",
      subject: "snowy mountain",
    },
    {
      filename: "DSCF0593.jpg",
      date: "2019-11-07T14:12:00",
      location: [36.567263, 137.666282, "Ōmachi", "Nagano", "Ōmachi-shi", "Japan"],
      tags: "japan, mountain, landscape",
      alt: "A mountain landscape near Ōmachi, Japan.",
      subject: "mountain landscape",
    },
    {
      filename: "DSCF2485-2.jpg",
      date: "2020-02-08T09:15:00",
      location: [1.335485, 103.816907, "Hillcrest Park", "", "", "Singapore"],
      tags: "singapore, city, street",
      alt: "A quiet street in Singapore.",
      subject: "city street",
    },
    {
      filename: "DSCF2581-2_2.jpg",
      date: "2020-02-09T17:40:00",
      location: [1.371483, 103.7822, "Bukit Panjang New Town", "", "", "Singapore"],
      tags: "singapore, nature, park",
      alt: "Greenery in Bukit Panjang, Singapore.",
      subject: "urban greenery",
    },
    {
      filename: "DSCF2768.JPG",
      date: "2020-02-10T11:20:00",
      location: [1.3521, 103.8198, "Singapore", "", "", "Singapore"],
      tags: "singapore, garden, trees",
      alt: "Trees in a Singapore garden.",
      subject: "garden trees",
    },
    // The album's committed clip, indexed through the poster frame the prepass
    // extracts from it — this is what gives the e2e suite a real video result to
    // assert a play badge on.
    {
      filename: "DSCF0159.MOV",
      date: "2026-02-27T10:52:10",
      location: [36.567263, 137.666282, "Ōmachi", "Nagano", "Ōmachi-shi", "Japan"],
      tags: "japan, night, lights",
      alt: "Night lights, out of focus.",
      subject: "night lights",
      mediaKind: "video",
      durationSeconds: 13.013,
    },
  ];

  const insertImage = db.prepare(`
  INSERT INTO images (
    path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const insertMetadata = db.prepare(`
  INSERT INTO metadata (
    path, lat_deg, lng_deg, iso8601, geo_city, geo_region, geo_subregion, geo_country,
    media_kind, duration_seconds
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const insertEmbedding = embeddingsDb.prepare(`
  INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale)
  VALUES (?, ?, ?, ?, ?)
`);

  const embeddingVectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0.25, 0.75, 0],
    [-0.5, 0.5, 0],
    [0.9, 0.1, 0],
    [0.1, 0.2, 0.9],
  ];

  db.exec("BEGIN");
  embeddingsDb.exec("BEGIN");
  photos.forEach((photo, index) => {
    const photoPath = `../albums/test-simple/${photo.filename}`;
    const [lat, lng, city, region, subregion, country] = photo.location;
    const geocode = [country === "Japan" ? "JP" : "SG", city, region, subregion, country]
      .filter(Boolean)
      .join("\n");
    const exifDate = photo.date.replace(/-/g, ":").replace("T", " ");
    const exif = [
      "Image Make:FUJIFILM",
      "Image Model:X100T",
      "EXIF FocalLength:23",
      `EXIF DateTimeOriginal:${exifDate}`,
      `GPS GPSLatitude:[${Math.abs(lat)}, 0, 0]`,
      `GPS GPSLatitudeRef:${coordinateRef(lat, "S", "N")}`,
      `GPS GPSLongitude:[${Math.abs(lng)}, 0, 0]`,
      `GPS GPSLongitudeRef:${coordinateRef(lng, "W", "E")}`,
    ].join("\n");
    const colors = JSON.stringify([
      [48 + index * 10, 64 + index * 8, 92 + index * 6],
      [160, 174, 190],
      [105, 116, 128],
    ]);

    insertImage.run(
      photoPath,
      `/album/test-simple#${photo.filename}`,
      photo.filename,
      geocode,
      exif,
      photo.tags,
      colors,
      photo.alt,
      photo.subject,
    );
    insertMetadata.run(
      photoPath,
      lat,
      lng,
      photo.date,
      city,
      region,
      subregion,
      country,
      photo.mediaKind ?? "photo",
      photo.durationSeconds ?? null,
    );
    const encodedEmbedding = encodeEmbedding(embeddingVectors[index]);
    insertEmbedding.run(
      photoPath,
      "google/siglip2-base-patch16-224",
      3,
      encodedEmbedding.blob,
      encodedEmbedding.scale,
    );
  });

  const tagCounts = new Map();
  for (const photo of photos) {
    for (const tag of photo.tags.split(",").map((value) => value.trim())) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const insertTag = db.prepare("INSERT INTO tags (tag, count) VALUES (?, ?)");
  for (const [tag, count] of [...tagCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    insertTag.run(tag, count);
  }
  db.exec("COMMIT");
  embeddingsDb.exec("COMMIT");
  db.close();
  embeddingsDb.close();

  if (force) {
    // Windows does not replace an existing destination via renameSync. Remove
    // only the dedicated E2E outputs after both replacement DBs are complete.
    rmSync(outputPath, { force: true });
    rmSync(embeddingsOutputPath, { force: true });
  }
  renameSync(temporaryPath, outputPath);
  renameSync(temporaryEmbeddingsPath, embeddingsOutputPath);
  return { created: true, outputPath, embeddingsOutputPath };
};

const run = (
  args = process.argv.slice(2),
  log = console.log,
  create = createE2eSearchDatabases,
) => {
  const result = create(parseArgs(args));
  log(
    result.created
      ? `Created deterministic E2E search databases at ${result.outputPath} and ${result.embeddingsOutputPath}`
      : `Using existing E2E search databases at ${result.outputPath} and ${result.embeddingsOutputPath}`,
  );
  return result;
};

module.exports = {
  coordinateRef,
  createE2eSearchDatabases,
  encodeEmbedding,
  parseArgs,
  run,
};

/* istanbul ignore next -- direct CLI dispatch; run is tested independently */
if (require.main === module) {
  run();
}
