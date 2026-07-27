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
const { listAlbumFiles, runPool } = require("./prepare-optimised-images.cjs");
const { ensureVideoPoster, posterPathsFor } = require("../services/videoPoster.ts");
const { ensureYoutubePoster } = require("../services/youtubeExternal.ts");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const MANIFEST_V2_NAME = "album.json";

const isVideoFile = (filename) => VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());

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
    }),
  generateExternalPoster = (external, albumName) =>
    ensureYoutubePoster(external, {
      albumName,
      publicAlbumsDir,
      resolvePaths: posterPathsFor,
      sizes: imageOptimisationConfig.sizes,
      avif: imageOptimisationConfig.avif,
    }),
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
