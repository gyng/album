// Index the published source dimensions, which may differ from EXIF after a crop.
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { formatAspectRatio } = require("../util/formatAspectRatio.ts");

async function prepareSearchFraming(databasePath) {
  if (!existsSync(databasePath)) return 0;
  const db = new DatabaseSync(databasePath);
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(metadata)")
        .all()
        .map((row) => row.name),
    );
    for (const name of ["aspect_ratio", "orientation"]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE metadata ADD COLUMN ${name} TEXT`);
    }
    const rows = db.prepare("SELECT path FROM images").all();
    const update = db.prepare(
      "INSERT INTO metadata (path, aspect_ratio, orientation) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET aspect_ratio=excluded.aspect_ratio, orientation=excluded.orientation",
    );
    let count = 0;
    for (const row of rows) {
      const source = path.resolve(__dirname, "..", row.path);
      if (!existsSync(source)) continue;
      try {
        const metadata = await sharp(source).metadata();
        let { width, height } = metadata;
        if (!width || !height) continue;
        if (metadata.orientation >= 5) [width, height] = [height, width];
        const ratio = formatAspectRatio(width, height);
        if (ratio === "—") continue;
        update.run(
          row.path,
          ratio,
          width === height ? "Square" : width > height ? "Landscape" : "Portrait",
        );
        count++;
      } catch {
        // Video paths and absent local sources have no photo framing to index.
        update.run(row.path, null, null);
      }
    }
    return count;
  } finally {
    db.close();
  }
}
if (require.main === module) {
  const databasePath =
    process.argv[2] ??
    path.join(
      __dirname,
      "..",
      "public",
      process.env.ALBUM_INCLUDE_TEST_ALBUMS === "1" ? "e2e-search.sqlite" : "search.sqlite",
    );
  prepareSearchFraming(databasePath)
    .then((count) => console.log(`Prepared search framing for ${count} photos.`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
module.exports = { prepareSearchFraming };
