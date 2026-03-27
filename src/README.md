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
- `/search` browser-side search and similarity exploration
- `/slideshow` slideshow with random and similarity playback modes
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

- Keyword search uses FTS5 against Janus-generated metadata.
- Similarity uses the `embeddings` table generated from SigLIP image vectors.
- Database loading is cached in the browser so similarity features do not repeatedly deserialize the same SQLite file.

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
