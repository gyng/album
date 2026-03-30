# AGENTS.md

Personal photo gallery — Next.js 14, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories. Python + various models for embeddings/metadata generation.

> Claude Code also loads `.claude/rules/` for additional scoped detail — other agents use this file only.

## Commands

> A root `Makefile` exists for human convenience — agents should use the direct commands below.

- **Tests:** `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural flag)
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/`

## Structure
- `src/components/` — React components with co-located `.module.css`; complex components have `.test.tsx`, not all
- `src/pages/` — Next.js pages (`/map`, `/search`, `/explore`, `/timeline`, `/slideshow`)
- `src/util/` — pure utility functions (no React)
- `src/services/` — build-time data: album/photo loading, serialisation, EXIF extraction (Node only, never imported client-side)
- `../albums/` — album source directories (sibling to `src/`); each album is a folder of images with an optional `album.json` (v2 manifest)
- `src/components/search/` — search page, SQLite API layer, facet panel, result tiles
- `src/components/mapRoute.ts` — all route/journey logic
- `index/` — Python indexing pipeline (Janus, SigLIP, EXIF, geocoding → SQLite)

All pages use `getStaticProps` — data is computed at build time, no runtime API. Client state is UI-only (filters, view toggles).

## Conventions
- **British English** in all user-facing copy and comments: colour, centre, favourite, licence
- CSS Modules only — no inline styles except for dynamic values (colours, widths from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`

## Testing

**Jest** — unit/integration tests, run from `src/`:
- Config: `src/jest.config.mjs`; test environment is `node`
- Playwright tests in `src/tests/` are excluded from Jest automatically

**Playwright** — e2e tests, run from `src/`:
```
npm run test:e2e                                # build + start server + run all tests (Chromium only locally)
npm run test:e2e -- ./tests/smoke.spec.ts --project=chromium   # single file
npm run test:e2e:reuse -- ./tests/smoke.spec.ts                # reuse already-running dev server
```
- Config: `src/playwright.config.ts`; tests live in `src/tests/*.spec.ts`
- Locally: Chromium only, reuses existing server if running
- CI: all browsers (Chromium, Firefox, WebKit), fresh server always
- Use `test:e2e:reuse` only when a server is already running — do not use it to skip the build
- **CI album data:** only `albums/test-*` directories are checked into git (real albums are gitignored). Playwright tests must use `test-simple`, `test-manifest`, or `test-manifest-v2` — never hardcode real album names like `snapshots` or `24japan`

**Python (indexer)** — unittest, run from `index/`:
```
./do-test-index.sh          # runs index.test.py via uv
./create-test-db.sh         # builds fixture SQLite DBs needed by some tests
```
- Tests live in `index/index.test.py`; uses `unittest` + Click's `CliRunner`
- `create-test-db.sh` must be run first if fixture DBs (`testexists.sqlite`, `test-simple.sqlite`) are missing

**General:**
- Run tests after every refactor before committing
- Red-green TDD — write the failing test first
- Prefer unit > integration > e2e
- No perf changes without profiling evidence first

## Map
- MapLibre via `react-map-gl/maplibre`; `MMap` is the main component
- Omit MapLibre paint properties entirely (spread `{}`) instead of passing `undefined` — MapLibre throws on undefined values
- `useMap()` only works inside children of `<MapLibreMap>` — use small child components for imperative map calls
- Route overlay is SVG (screen-space), projected via `map.project()`

## Design tokens (src/styles/globals.css)
Always use tokens — never raw px values or colours.
- Spacing: `--m` 4 / `--m-s` 8 / `--m-m` 12 / `--m-l` 20 / `--m-xl` 40 (px)
- Font sizes: `--fs-s` 11 / `--fs-sm` 14 / `--fs-m` 18 / `--fs-l` 24 / `--fs-xl` 64 (px)
- Colours: `--c-bg`, `--c-font`, `--c-bg-contrast-light`, `--c-bg-contrast-dark`, `--c-accent`

## Search
- SQLite runs in-browser via sql.js (WASM)
- Two-phase: JS colour pre-filter → SQL text/facet filter — never do colour filtering in SQL
- Colour-matched paths capped at 900 before building SQL `IN` clause (SQLite bind-parameter limit)
- Colour filter composes with text search and facets — not a separate mode
- Semantic search runs `Xenova/siglip-base-patch16-224` (SigLIP **v1**, ONNX, q4) in a web worker; v1 is used because the v2 model is too large to ship to the browser — do not upgrade without a viable ONNX-quantised v2 alternative
- **Image embeddings in the DB must be SigLIP v1** (`google/siglip-base-patch16-224`) for semantic search; v2 embeddings are in a different embedding space and only work for image-to-image similarity
- COI headers required for SharedArrayBuffer; search page is wrapped in `WithCoi`

## Indexing pipeline (index/index.py)
The search database (`src/public/search.sqlite`) is built offline by a Python CLI before `npm run build`.

**Setup** (Python 3.12, managed by [uv](https://docs.astral.sh/uv/)):
```
cd index
uv sync                 # install dependencies (including Janus from git)
uv run ruff --fix       # lint
uv run black .          # format
```
Note: `janus` is installed from the `deepseek-ai/Janus` git repo, not PyPI — first `uv sync` will clone it.

**Run** (use the shell scripts, which handle the DB split and copy):
```
cd index
./do-full-index.sh          # full hybrid index → produces both DBs
./do-embeddings-index.sh    # refresh embeddings only, keep existing search.sqlite
```

**Output databases** (both copied to `src/public/` after indexing):
- `search.sqlite` — FTS5 content, tags, metadata, colours; loaded on first search use
- `search-embeddings.sqlite` — embeddings table only; loaded lazily for semantic/similarity search; falls back to `search.sqlite` if absent

**What it does per image:**
1. Reads EXIF (via `exifread`) — camera make/model, lens, focal length, GPS, timestamp
2. Reverse-geocodes GPS coords to city/country (in-process k-d tree, no API)
3. Runs **Janus-Pro-1B** (VLM, GPU) — produces `identified_objects`, `themes`, `alt_text`, `subject` as JSON
4. Runs **SigLIP v1** (`google/siglip-base-patch16-224`, GPU) — embeddings compatible with the browser text encoder; required for semantic search
5. Optionally runs **SigLIP v2** (`google/siglip2-base-patch16-224`, GPU) — higher-quality embeddings for image-to-image similarity only (incompatible with the browser text encoder)
6. Extracts dominant colour palette via `fast_colorthief` (Rust, runs concurrently with GPU work)
7. Writes everything into `search.sqlite` in a single batch transaction; `do-full-index.sh` then splits out the embeddings table into `search-embeddings.sqlite`

**Model profiles:**
- `janus` — tags/text only (Janus VLM, no embeddings)
- `siglip2` — both SigLIP v1 + v2 embeddings, no VLM tags
- `hybrid` — both (default for production)

**Database schema** (FTS5 + plain tables):
- `images` — FTS5 virtual table: `path`, `geocode`, `exif`, `tags`, `colors`, `alt_text`, `subject`
- `metadata` — `path`, `lat_deg`, `lng_deg`, `iso8601`
- `embeddings` — `path`, `model_id`, `embedding_dim`, `embedding_json`
- `tags` — denormalised tag frequency counts

**Key behaviours:**
- Incremental: already-indexed paths are skipped (one bulk `SELECT` into a set, then O(1) checks)
- `colors` stored as serialised RGB tuples; `parseColorPalette` in `src/util/colorDistance.ts` deserialises them at build time
- FTS5 uses `porter trigram` tokeniser — supports both stemmed keyword and substring search
- Page size set to 1024 bytes and journal mode to `delete` for efficient HTTP range reads via sql.js-httpvfs in the browser

## CI (`.github/workflows/ci.yml`)
Runs on PRs to `main`, pushes to `main` and `release/*`, and manual dispatch.

**Jobs:**
- `test` — `npm ci` + `npm run test:ci` from `src/` (Node 24, ubuntu-latest)
- `playwright` — full Playwright suite (all browsers) with artifact upload (`playwright-report/`, 30-day retention)
- `test-index` — **currently disabled** (commented out); Janus git dependency fails on GHA due to SSH auth

**Notes:**
- Both JS jobs set `working-directory: ./src`
- Playwright installs browsers via `npx playwright install --with-deps` (not cached)
- No deploy/build job — CI is test-only

## Do not modify
- `src/util/lol2album.js`, `src/util/convertlol.js` — one-off migration scripts
- `src/services/buildTiming.ts` — build instrumentation only, no logic
- v1 album manifest (`manifest.json`) — deprecated, handled in `getAlbum` for legacy support only; new album config uses `album.json` (v2)
