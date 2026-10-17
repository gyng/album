// Extracts a poster frame for every video in every album — local files and
// YouTube externals alike — before the build and before the Python indexer runs.
//
// Unlike the image pass this is not only a warm-up: the poster frame is the
// only pixel source a video has, so it is what the indexer captions, embeds and
// colour-samples, and what search tiles, map markers and the album page's
// `<video poster>` display. A failure is still non-fatal — the album page plays
// the clip regardless, and the indexer reports any video it could not read.
//
// The YouTube half reaches the network only when its cache is cold, so repeat
// builds (and offline builds after one successful pass) never call out.

const fs = require("node:fs");
const path = require("node:path");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const { listAlbumFiles, runPool, PHOTO_EXTENSIONS } = require("./prepare-optimised-images.cjs");
const {
  ensureVideoPoster,
  posterPathsFor,
  readVideoPosterSidecar,
} = require("../services/videoPoster.ts");
const { reconcileInferredLocation } = require("../services/clipLocation.ts");
const { readMovieExif } = require("../services/movieExif.ts");
const { ensureYoutubePoster } = require("../services/youtubeExternal.ts");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const MANIFEST_V2_NAME = "album.json";

const isVideoFile = (filename) => VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
const isPhotoFile = (filename) => PHOTO_EXTENSIONS.has(path.extname(filename).toLowerCase());

// A photograph's wall clock and place, for inferring where a clip without one
// was shot. `reviveValues: false` keeps the wall clock the string the camera
// wrote: revived, it becomes a Date in this machine's zone.
const readPhotoPlaceWithExifr = async (photoPath) => {
  try {
    const exif = await require("exifr").parse(photoPath, {
      pick: [
        "DateTimeOriginal",
        "GPSLatitude",
        "GPSLatitudeRef",
        "GPSLongitude",
        "GPSLongitudeRef",
      ],
      reviveValues: false,
    });
    if (
      typeof exif?.DateTimeOriginal !== "string" ||
      !Number.isFinite(exif.latitude) ||
      !Number.isFinite(exif.longitude) ||
      (exif.latitude === 0 && exif.longitude === 0)
    ) {
      return null;
    }
    return {
      capturedAtLocal: exif.DateTimeOriginal,
      latDeg: exif.latitude,
      lngDeg: exif.longitude,
    };
  } catch {
    return null;
  }
};

// Externals are declared per album in the v2 manifest. A malformed manifest is
// a content problem, not a build failure: the album pages report it themselves.
const listYoutubeExternals = ({ albumsDir, includeTestAlbums }) => {
  if (!fs.existsSync(albumsDir)) {
    return [];
  }

  return fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .filter((entry) => includeTestAlbums || !entry.name.startsWith("test-"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((album) => {
      const manifestPath = path.join(albumsDir, album.name, MANIFEST_V2_NAME);
      if (!fs.existsSync(manifestPath)) {
        return [];
      }

      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } catch (err) {
        console.warn(`Ignoring unreadable manifest ${manifestPath}: ${err.message}`);
        return [];
      }

      const externals = Array.isArray(manifest?.externals) ? manifest.externals : [];
      return externals
        .filter((external) => external?.type === "youtube" && typeof external.href === "string")
        .map((external) => ({ albumName: album.name, external }));
    });
};

const prepareVideoPosters = async ({
  albumsDir = path.resolve(__dirname, "..", "..", "albums"),
  publicAlbumsDir = path.resolve(__dirname, "..", "public", "data", "albums"),
  // ffmpeg already saturates the machine on a single 4K clip, so the pool is
  // deliberately narrower than the image pass's.
  jobs = 2,
  includeTestAlbums = process.env.ALBUM_INCLUDE_TEST_ALBUMS === "1",
  generatePoster = (videoPath) =>
    ensureVideoPoster(videoPath, {
      publicAlbumsDir,
      sizes: imageOptimisationConfig.sizes,
      avif: imageOptimisationConfig.avif,
      // A clip's own wall clock and coordinates live in its embedded EXIF, which
      // ffprobe does not expose; injected rather than imported because this
      // module takes no relative runtime import.
      readMovieExif,
    }),
  generateExternalPoster = (external, albumName) =>
    ensureYoutubePoster(external, {
      albumName,
      publicAlbumsDir,
      resolvePaths: posterPathsFor,
      sizes: imageOptimisationConfig.sizes,
      avif: imageOptimisationConfig.avif,
    }),
  readPhotoPlace = readPhotoPlaceWithExifr,
} = {}) => {
  const startedAt = Date.now();
  const videos = listAlbumFiles({ albumsDir, includeTestAlbums, matches: isVideoFile });
  const externals = listYoutubeExternals({ albumsDir, includeTestAlbums });
  const summary = {
    videosDiscovered: videos.length,
    postersExtracted: 0,
    postersCached: 0,
    externalsDiscovered: externals.length,
    externalPostersFetched: 0,
    externalPostersCached: 0,
    variantsEncoded: 0,
    locationsInferred: 0,
    failures: [],
    jobs,
    durationMs: 0,
  };

  await runPool(videos, jobs, async ({ albumName, filename, source }) => {
    try {
      const result = await generatePoster(source);
      if (result.extracted) {
        summary.postersExtracted += 1;
      } else {
        summary.postersCached += 1;
      }
      summary.variantsEncoded += result.variantsEncoded ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failures.push({ albumName, filename, source, message });
      console.warn(`Could not extract a poster frame for ${source}: ${message}`);
    }
  });

  // A clip without a place of its own borrows the nearest geotagged photograph
  // of its album (services/clipLocation.ts). Re-checked on every run against
  // the photographs as they are now, so it follows their edits; an album's
  // photographs are read once, and only for an album that has such a clip.
  const albumPlaces = new Map();
  const placesOf = (albumName) => {
    if (!albumPlaces.has(albumName)) {
      const albumDir = path.join(albumsDir, albumName);
      const photos = fs
        .readdirSync(albumDir)
        .filter(isPhotoFile)
        .sort((a, b) => a.localeCompare(b));
      albumPlaces.set(
        albumName,
        Promise.all(
          photos.map(async (name) => {
            const place = await readPhotoPlace(path.join(albumDir, name));
            return place ? { name, ...place } : null;
          }),
        ).then((places) => places.filter(Boolean)),
      );
    }
    return albumPlaces.get(albumName);
  };
  for (const { albumName, filename, source } of videos) {
    try {
      const { sidecar: sidecarPath } = posterPathsFor(source, publicAlbumsDir);
      const sidecar = readVideoPosterSidecar(sidecarPath);
      if (!sidecar) continue;
      const recorded =
        sidecar.locationSource === "camera" ||
        (sidecar.locationSource === undefined && typeof sidecar.latDeg === "number");
      if (recorded || !sidecar.capturedAtLocal) continue;
      const reconciled = reconcileInferredLocation(sidecar, await placesOf(albumName));
      if (reconciled !== sidecar) {
        fs.writeFileSync(sidecarPath, `${JSON.stringify(reconciled, null, 2)}\n`);
      }
      if (reconciled.locationSource === "nearby-photo") summary.locationsInferred += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Could not infer a place for ${albumName}/${filename}: ${message}`);
    }
  }

  await runPool(externals, jobs, async ({ albumName, external }) => {
    try {
      const result = await generateExternalPoster(external, albumName);
      if (result.extracted) {
        summary.externalPostersFetched += 1;
      } else {
        summary.externalPostersCached += 1;
      }
      summary.variantsEncoded += result.variantsEncoded ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failures.push({ albumName, filename: external.href, source: external.href, message });
      console.warn(`Could not prepare the external ${external.href}: ${message}`);
    }
  });

  summary.durationMs = Date.now() - startedAt;
  return summary;
};

module.exports = { prepareVideoPosters, VIDEO_EXTENSIONS };

/* istanbul ignore next -- direct CLI dispatch; preparation is tested through its exported API */
if (require.main === module) {
  const jobs = Number(process.env.ALBUM_VIDEO_JOBS ?? 2);
  prepareVideoPosters({ jobs })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
