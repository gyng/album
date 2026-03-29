This is the frontend for the album site: a statically exported Next.js app backed by a browser-loaded SQLite search index.

## Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
npm run benchmark:warm
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Useful routes:

- `/` albums index
- `/search` browser-side keyword, semantic, hybrid, and similarity search
- `/slideshow` slideshow with shuffle, recent-weighted, and similarity playback modes
- `/map` world and album mapping views

The frontend expects the generated search indexes at:

- `public/search.sqlite` for keyword/browse metadata
- `public/search-embeddings.sqlite` for semantic and similarity search

Rebuild them from [index/README.md](../index/README.md).

To run the local guided publish flow for new photos:

```bash
npm run publish:wizard
npm run publish:wizard -- --fast-track
npm run publish:wizard -- --interactive
npm run publish:wizard -- --dry-run
```

The wizard scans albums, reports GPS/EXIF/index health for new photos, runs indexing, verifies the resulting SQLite DB, and can then continue to build and deploy.

Fast-track is now the default behavior, so `npm run publish:wizard` asks the index/build/deploy questions before indexing starts and then proceeds unattended. Use `--interactive` if you want the older step-by-step prompting.

## Search Database

The search UI, album details similarity grid, and slideshow similarity mode use browser-loaded SQLite databases.

- `search.sqlite` holds FTS5 content, browse metadata, tags, and map/timeline fields.
- `search-embeddings.sqlite` holds the image embeddings used by semantic and similarity features.
- Keyword search uses FTS5 against Janus-generated metadata, EXIF text, filenames, and geocoded locations.
- Semantic search embeds the query text in a web worker and compares it against stored image vectors.
- Hybrid search fuses the keyword and semantic rankings with Reciprocal Rank Fusion.
- Similarity uses the embeddings database for image-to-image ranking.
- Database loading is cached in the browser so pages do not repeatedly deserialize the same SQLite files.

When search is already in similarity mode, the source thumbnail can launch a similar-trail slideshow directly with `/slideshow?mode=similar&seed=<path>`.

## How Search And Embeddings Work

The app stays fully static. There is no API route or search server involved.

1. The Python indexer writes a core browse DB plus an embeddings DB for the frontend.
2. The frontend opens `search.sqlite` with SQLite WASM directly in the browser.
3. Keyword mode and browse surfaces issue local FTS5 and metadata queries against the core DB.
4. Semantic and similarity features lazily open `search-embeddings.sqlite` when needed.
5. Semantic mode warms a SigLIP text encoder in a worker, shows model-load progress in the search UI, embeds the query, and ranks image embeddings with cosine similarity.
6. Hybrid mode runs both paths and merges the rankings with RRF so exact textual hits and semantically similar photos can both score well.

The result is a static deployment with richer search behavior, while keeping the heavier embeddings download off the critical path for keyword and browse flows.

## Warm Build Benchmarking

To profile warm builds under the current Next 16 + Turbopack pipeline:

```bash
npm run benchmark:warm
```

This keeps the existing resized asset caches in place, clears `.next` before each run, executes repeated production builds, and writes a benchmark artifact to `.warm-build-benchmark.json`.

Cached resized-image and resized-video housekeeping still lives outside page generation, but `npm run build` and `npm run build:profile` now invoke it once before `next build`. That cleanup also drops cached outputs whose source file has been edited in place and is newer than the cached variant. You can still run it manually when image/video size settings change or after large media deletions:

```bash
npm run cleanup:media-cache
```

The benchmark runner also compares the median timings against `warm-build-budget.json` and prints warnings when a metric regresses beyond the configured absolute or percentage tolerance.

To make budget regressions fail with a non-zero exit code instead of warning only:

```bash
npm run benchmark:warm:strict
```

For a single profiled build without the repeat runner:

```bash
npm run build:profile
```

That writes build-only timing metrics to `.next/album-build-profile.json` unless `ALBUM_BUILD_PROFILE_OUTPUT` is set.

## Tests

```bash
npm test
npm run test:e2e
npm run test:e2e -- ./tests/slideshow-keyboard.spec.ts --project=chromium
npm run test:e2e:reuse -- ./tests/slideshow-keyboard.spec.ts --project=chromium
```

Use `npm run test:e2e` when you want Playwright to build the app and manage its own local server.

Use `npm run test:e2e:reuse` only when you already have a server running locally and you explicitly want Playwright to reuse it.

## Notes

- The app ships as static files; there is no search backend.
- The core search DB loads on first search/browse use; the embeddings DB loads lazily for semantic and similar-photo features.
- Some focused tests target Firefox because it surfaced browser-history and storage issues earlier than Chromium.

See the root [README.md](../README.md) for album generation and deployment steps.
