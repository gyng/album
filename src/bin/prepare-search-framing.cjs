// Index the published source dimensions, which may differ from EXIF after a crop.
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { formatAspectRatio } = require("../util/formatAspectRatio.ts");
const { clipPathOf } = require("../util/videoScenePath.ts");
const { posterPathsFor, readVideoPosterSidecar } = require("../services/videoPoster.ts");

const HEADER_READERS = 16;

/** "Square"/"Portrait"/"Landscape" for a pair of upright pixel dimensions. */
const orientationOf = (width, height) =>
  width === height ? "Square" : width > height ? "Landscape" : "Portrait";

/**
 * Framing for a row with no image header of its own: a clip, indexed through
 * the poster frame the video prepass extracted for it, or an external, which has
 * no file in the album at all. That prepass records the frame's dimensions in
 * the clip's sidecar, and those are the numbers `_build.poster.srcset` is
 * derived from, so the aspect ratio survives even though the media file itself
 * is opaque. A scene has no sidecar of its own, so it reads the clip's; anything
 * without usable dimensions falls back to null.
 */
const posterFraming = (rowPath, publicAlbumsDir) => {
  const sidecar = readVideoPosterSidecar(
    posterPathsFor(clipPathOf(rowPath), publicAlbumsDir).sidecar,
  );
  const { width, height } = sidecar ?? {};
  if (typeof width !== "number" || typeof height !== "number") return null;
  const ratio = formatAspectRatio(width, height);
  if (ratio === "—") return null;
  return { ratio, orientation: orientationOf(width, height) };
};

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
    // Headers are read several at a time: one by one they were most of this
    // step's time on every build. Writes still happen in row order below.
    const metadataByRow = Array.from({ length: rows.length });
    let next = 0;
    const readHeaders = async () => {
      while (next < rows.length) {
        const index = next++;
        const source = path.resolve(__dirname, "..", rows[index].path);
        if (!existsSync(source)) continue;
        metadataByRow[index] = await sharp(source)
          .metadata()
          .catch((error) => ({ error }));
      }
    };
    await Promise.all(Array.from({ length: HEADER_READERS }, readHeaders));
    // The poster cache lives beside the database under public/, so a sidecar is
    // found from the database path rather than from the album source layout.
    const publicAlbumsDir = path.resolve(path.dirname(databasePath), "data", "albums");
    let count = 0;
    for (const [index, row] of rows.entries()) {
      const metadata = metadataByRow[index];
      let framing = null;
      if (metadata) {
        try {
          if (metadata.error) throw metadata.error;
          let { width, height } = metadata;
          if (!width || !height) continue;
          if (metadata.orientation >= 5) [width, height] = [height, width];
          const ratio = formatAspectRatio(width, height);
          if (ratio === "—") continue;
          framing = { ratio, orientation: orientationOf(width, height) };
        } catch {
          // Only a clip fails here, and its framing is the poster's, below.
        }
      }
      // A clip's own file holds no pixels sharp can read — and an external has no
      // file in the album at all — so the poster the prepass recorded stands in.
      framing ??= posterFraming(row.path, publicAlbumsDir);
      if (!framing) {
        // An absent local source gets no framing row; a file that is present but
        // unreadable, with no cached poster, records that it has no framing.
        if (metadata) update.run(row.path, null, null);
        continue;
      }
      update.run(row.path, framing.ratio, framing.orientation);
      count++;
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
