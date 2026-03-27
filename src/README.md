This is the frontend for the album site: a statically exported Next.js app backed by a browser-loaded SQLite search index.

## Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Useful routes:

- `/` albums index
- `/search` browser-side keyword, semantic, hybrid, and similarity search
- `/slideshow` slideshow with shuffle, recent-weighted, and similarity playback modes
- `/map` world and album mapping views

The frontend expects the generated SQLite index at `public/search.sqlite`. Rebuild it from [index/README.md](../index/README.md).

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

The search UI, album details similarity grid, and slideshow similarity mode all use the same browser-loaded SQLite database.

- Keyword search uses FTS5 against Janus-generated metadata, EXIF text, filenames, and geocoded locations.
- Semantic search embeds the query text in a web worker and compares it against stored image vectors.
- Hybrid search fuses the keyword and semantic rankings with Reciprocal Rank Fusion.
- Similarity uses the same `embeddings` table for image-to-image ranking.
- Database loading is cached in the browser so similarity features do not repeatedly deserialize the same SQLite file.

When search is already in similarity mode, the source thumbnail can launch a similar-trail slideshow directly with `/slideshow?mode=similar&seed=<path>`.

## How Search And Embeddings Work

The app stays fully static. There is no API route or search server involved.

1. The Python indexer writes `public/search.sqlite` with FTS tables, metadata tables, and an `embeddings` table.
2. The frontend opens that SQLite file with SQLite WASM directly in the browser.
3. Keyword mode issues local FTS5 queries.
4. Semantic mode warms a SigLIP text encoder in a worker, shows model-load progress in the search UI, embeds the query, and ranks image embeddings with cosine similarity.
5. Hybrid mode runs both paths and merges the rankings with RRF so exact textual hits and semantically similar photos can both score well.

The result is a static deployment with richer search behavior, at the cost of an up-front DB download and an on-demand text-model download the first time semantic or hybrid search is used.

## Tests

```bash
npm test
npx playwright test tests/search-functionality.spec.ts --project=chromium
npx playwright test tests/slideshow-functionality.spec.ts --project=chromium
```

## Notes

- The app ships as static files; there is no search backend.
- Large search DB downloads are expected on first load.
- Some focused tests target Firefox because it surfaced browser-history and storage issues earlier than Chromium.

See the root [README.md](../README.md) for album generation and deployment steps.
