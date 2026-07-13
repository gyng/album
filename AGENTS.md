# AGENTS.md

Personal photo gallery — Next.js 16, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories. Python + various models for embeddings/metadata generation.

> Claude Code also loads `.claude/rules/` for additional scoped detail — other agents use this file only.

## Commands

> A root `Makefile` exists for human convenience — agents should use the direct commands below.

- **Tests:** `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural flag)
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/`

## Structure
- `src/components/` — React components with co-located `.module.css`; complex components have `.test.tsx`, not all
- `src/pages/` — Next.js pages (`/map`, `/search`, `/explore`, `/timeline`, `/slideshow`, `/design`)
- `src/util/` — pure utility functions (no React)
- `src/services/` — build-time data: album/photo loading, serialisation, EXIF extraction (Node only, never imported client-side)
- `../albums/` — album source directories (sibling to `src/`); each album is a folder of images with an optional `album.json` (v2 manifest)
- `src/components/search/` — search page, SQLite API layer, facet panel, result tiles
- `src/components/mapRoute.ts` — all route/journey logic
- `index/` — Python indexing pipeline (Janus, SigLIP, EXIF, geocoding → SQLite)

All pages use `getStaticProps` — data is computed at build time, no runtime API. Client state is UI-only (filters, view toggles).

## Conventions
- **British English** in all user-facing copy and comments: colour, centre, favourite, licence
- **EXIF timestamps are camera-local wall-clock time, end to end.** The build pipeline serialises them as naive ISO (`YYYY-MM-DDTHH:MM:SS`, no zone — see `dateToNaiveIso` in `src/util/exifTime.ts`); derive day/hour/year via `parseExifLocalDateTime`/`exifDayKey`, never via `toISOString()`/UTC getters, and never apply `OffsetTime` arithmetic (it only names the zone the wall clock is already in)
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
- Run the smallest relevant checks after each refactor, then the full required
  gates before committing
- Use red-green-refactor for new behaviour and bug fixes: first write the smallest
  test that fails for the right reason, then implement, then improve the design
- Choose the lowest test layer that can prove the behaviour without reimplementing
  it in the test:
  1. **Unit tests** for pure transformations, state machines, parsing, ranking,
     formatting, and edge cases
  2. **Component/integration tests** for user interactions, accessibility state,
     and boundaries between a small number of modules
  3. **E2E tests** only for critical journeys, browser integration, routing,
     persistence, and failures that lower layers cannot represent faithfully
- Keep the pyramid broad at the unit layer, selective at integration, and very
  small at E2E; do not repeat the same assertion at every layer
- Assert observable outcomes and public contracts: rendered state, accessible
  state, data passed across a boundary, URL changes, or network effects. Avoid
  asserting implementation details, private helpers, CSS class names, or mock
  call sequences unless those are the contract under test
- Do not add tests that merely freeze prose, punctuation, placeholders, or other
  editorial copy. Exact wording belongs in a test only when it is itself a
  requirement (for example legal text, a protocol value, or an accessible name
  that clients depend on). Copy edits should usually update existing selectors,
  not create new test cases
- Prefer role- and label-based queries for controls. If harmless copy changes
  repeatedly break a behavioural test, give the control a stable accessible name
  or query a more durable semantic state; do not fall back to arbitrary DOM shape
- Mock slow or external boundaries, not the behaviour being tested. A test should
  fail when the user-visible behaviour regresses, not when an internal refactor
  preserves it
- Every test should have a clear regression story. Remove tests whose only value
  is increasing counts, duplicating stronger coverage, or confirming framework
  behaviour
- Keep E2E cases independent, deterministic, and free of arbitrary sleeps. Do not
  use retries to excuse flakiness; diagnose the cause
- No perf changes without profiling evidence first

## Map
- MapLibre via `react-map-gl/maplibre`; `MMap` is the main component
- Omit MapLibre paint properties entirely (spread `{}`) instead of passing `undefined` — MapLibre throws on undefined values
- `useMap()` only works inside children of `<MapLibreMap>` — use small child components for imperative map calls
- Route overlay is SVG (screen-space), projected via `map.project()`

## Design tokens (src/styles/globals.css)
Always use tokens — never raw px values or colours.
- Spacing: `--m` 4 / `--m-s` 8 / `--m-m` 12 / `--m-l` 20 / `--m-xl` 40 / `--m-2xl` 64 (px)
- Font sizes: `--fs-xs` 10 / `--fs-s` 11 / `--fs-sm` 14 / `--fs-m` 18 / `--fs-l` 24 / `--fs-xl` 64 (px)
- Colours: `--c-bg`, `--c-font`, `--c-bg-contrast-light`, `--c-bg-contrast-dark`, `--c-accent`, `--c-overlay-dark`, `--c-border-on-dark`

## Shared components (src/components/ui/)
Design system primitives live in `src/components/ui/` with a barrel export. Import via `import { Heading, Card } from "../ui"` (from components) or `"../../components/ui"` (from pages). The `/design` page is the living catalogue.
- `Thumb` / `Thumb size="small"` — image thumbnail (150px / 112px), sharp corners
- `Heading level={1|2|3}` + `Caption` — consistent heading hierarchy and muted secondary text
- `Card` — bordered surface container, theme-adaptive via color-mix
- `Input` / `Select` — form controls with consistent border, radius, and focus ring; Input supports forwardRef
- `ChartTooltip` — accent-tinted hover tooltip for charts; consumer provides the hover trigger via `[data-tooltip]`
- `SegmentedToggle` — pill-shaped option switcher (generic over value type)
- `Pill` / `PillButton` / `pillStyles` — rounded nav link / action button; `variant="surface"` (default) or `"ghost"`; use `pillStyles` for composing with Next.js `<Link>`
- `OverlayButton` / `OverlayButtonLink` / `overlayButtonStyles` — dark glass button for media overlays; `size="small"` for icon-only
- `Footer` — site footer with standard links (GitHub, Fediverse, Bluesky, Design)
- Stack utilities in `common.module.css`: `.stack` (8px) / `.stackL` (20px) / `.stackXl` (40px) / `.stackPage` (64px)

## Search
- SQLite runs in-browser via sql.js (WASM)
- Two-phase: JS colour pre-filter → SQL text/facet filter — never do colour filtering in SQL
- Colour-matched paths capped at 900 before building SQL `IN` clause (SQLite bind-parameter limit)
- Colour filter composes with text search and facets — not a separate mode
- Semantic search runs `Xenova/siglip-base-patch16-224` (SigLIP **v1**, ONNX, q4) in a web worker; v1 is used because the v2 model is too large to ship to the browser — do not upgrade without a viable ONNX-quantised v2 alternative
- Image/sketch search (`useImageQuery`) runs the same repo's **vision** tower (q4, lazy-loaded on first use) and ranks against the DB's v1 image embeddings via `fetchSemanticResults`; the query is ephemeral (not URL-persisted)
- Text AND image encoders share ONE worker entry (`embedding.worker.ts`) — two near-identical sibling worker files made Turbopack cross-wire the `new Worker(new URL(...))` bindings in production (each client got the other's worker); do not split them again
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
- `embeddings` — `path`, `model_id`, `embedding_dim`, `embedding_blob` (int8-quantised), `embedding_scale` (per-vector dequantisation factor); readers (`api.ts`, `computeEmbeddingStats.ts`) also accept the legacy `embedding_json` format from older DBs
- `tags` — denormalised tag frequency counts

**Key behaviours:**
- Incremental: already-indexed paths are skipped (one bulk `SELECT` into a set, then O(1) checks)
- `colors` stored as serialised RGB tuples; `parseColorPalette` in `src/util/colorDistance.ts` deserialises them at build time
- FTS5 uses `porter trigram` tokeniser — supports both stemmed keyword and substring search
- Page size 4096 (SQLite default) and journal mode `delete`; opening an old DB (JSON embeddings / 1024-byte pages) with any command that calls `setup_tables` — e.g. `backfill` — migrates and VACUUMs it in place

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
