# AGENTS.md

Personal photo gallery — Next.js 16, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories. Python + various models for embeddings/metadata generation.

> Claude Code also loads `.claude/rules/` for additional scoped detail — other agents use this file only.

## Commands

> A root `./album` CLI and a `Makefile` exist for human convenience — agents should use the direct commands below.
>
> `./album <command>` is the front door: `init`, `doctor`, `dev`, `generate`, `index`, `deploy`, `publish`. It is a thin layer over these same npm scripts and the `index/*.sh` scripts, adding preflight checks and help. Its dispatcher lives in `src/bin/album.cjs` with commands under `src/bin/album/`.
>
> **Deploys are prebuilt — `./album deploy` (or `publish`), never plain `vercel deploy`.** The build runs here and uploads with `--prebuilt`, because building in Vercel's container cannot work: `sqlite3` ships a prebuilt binary linked against GLIBC 2.38 and the image's libm is older, so `next build` dies collecting page data for `/album/[[...slug]]`. `src/vercel.json` blocks both routes into that failure — Git deployments are disabled, and the build command runs `bin/assert-local-build.cjs` first, which exits non-zero under `/vercel/`.

- **Tests:** `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural flag)
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/` — runs oxlint, biome, both `tsc` configs (including the framework-neutral screen graph via `tsconfig.portable.json`), and the formatting check (`oxfmt --check` via `format:check`). Note `npm run lint:fix` only fixes oxlint/biome findings — run `npm run format:write` separately to fix formatting failures
- **GitHub authentication:** sandboxed `gh` commands may falsely report that the configured token is invalid. Retry the same read-only authentication check with sandbox escalation before asking the user to re-authenticate.

## Structure
- `src/components/` — React components with co-located `.module.css`; complex components have `.test.tsx`, not all
- `src/components/platform/` — injectable renderer ports for links, document metadata, navigation, and public configuration; Next's implementation lives only in `platform/next/`
- `src/pages/` — thin Next.js route/build `.tsx` adapters; do not put rendered screen implementations or application-owned styles here
- `src/screens/` — framework-neutral route-level React screens (`map`, `search`, `explore`, `timeline`, `slideshow`, `design`, etc.) with screen-owned CSS Modules
- `src/app/` — build-only Next.js route adapters for stable data URLs; do not put application UI here
- `src/util/` — pure utility functions (no React)
- `src/services/` — build-time data: album/photo loading, serialisation, EXIF extraction (Node only, never imported client-side)
- `src/services/pageData/` — route-sized, framework-neutral loaders used by page build adapters
- `../albums/` — album source directories (sibling to `src/`); each album is a folder of images with an optional `album.json` (v2 manifest)
- `src/components/search/` — search page, SQLite API layer, facet panel, result tiles
- `src/components/mapRoute.ts` — all route/journey logic
- `index/` — Python indexing pipeline (Gemma 4 captions, SigLIP, EXIF, geocoding → SQLite)

Data-backed display pages use `getStaticProps`; client-only pages are statically optimised without it. The App Router is used only for build-generated payloads at stable URLs, currently `/data/map-search-index.json`; it is not a runtime application API. Client state is UI-only (filters, view toggles).

## Conventions
- **British English** in all user-facing copy and comments: colour, centre, favourite, licence
- **Copy earns its place.** User-facing text must say something the interface cannot. No instructions for interactions a reader discovers by trying (a picture that turns by itself does not need "drag to turn it"), no caption restating what is beside it, no section description paraphrasing its own title. If a sentence can be deleted without losing information, delete it — prefer nothing to filler
- **EXIF timestamps are camera-local wall-clock time, end to end.** The build pipeline serialises them as naive ISO (`YYYY-MM-DDTHH:MM:SS`, no zone — see `dateToNaiveIso` in `src/util/exifTime.ts`); derive day/hour/year via `parseExifLocalDateTime`/`exifDayKey`, never via `toISOString()`/UTC getters. Never apply `OffsetTime` to a *displayed* time — it only names the zone the wall clock is already in, so shifting by it moves a photo off the hour it was taken
- **Three timestamp helpers, and picking the wrong one is silent.** `exifWallClockTimestamp` anchors the wall clock to UTC: correct for ordering photos and for the span between two of them, where the zone cancels out, and **not comparable with `Date.now()`**. `exifRelativeTimestamp` is the only thing relative labels ("3 hours ago") may use — it recovers the true instant from `OffsetTime` where recorded (the one legitimate use of that tag, since converting to an instant changes no displayed clock) and falls back to the viewer's zone for the few without one. Mixing the first with `Date.now()` shifts the result by the reader's own offset: a photo taken at 16:55 in UTC+8 once read as taken nine minutes in the *future*
- **The zone comes from the coordinates, not from the camera.** `derive_zone` in `index/index.py` looks the photo's location up with `timezonefinder` and resolves the offset for that photo's own date through `zoneinfo`, so DST is per-photo (Melbourne indexes as both `+11:00` and `+10:00`). It lands in `metadata.tz_name`/`tz_offset`, reaches `_build.tags` through the `LEFT JOIN` in `deserialize.ts`, and **wins over the camera's `OffsetTime`** in `Photo.tsx` and the map/timeline loaders. This precedence is measured, not stylistic: the X100T records a wrong offset on every frame and the X-T5 on 18% of them, while their wall clocks are demonstrably right — 44 sunrise/sunset photos put the sun within ±6° of the horizon under the derived zone and nowhere near it under the recorded one. Deriving raised coverage from 56% to 99.9% and corrected 144 photos, and it changes no wall clock: the zone is a label, and `update-gps` re-derives it without touching `iso8601`. Deriving is **best-effort and never fatal** — `timezonefinder` is an ordinary dependency, but if it cannot be imported or built, `_timezone_finder` warns once per run and every photo indexes with a null zone rather than the run dying. That is deliberate: captions and embeddings are hours of GPU time and are not discarded over a label. The write is a `COALESCE`, so a degraded re-run preserves zones already derived instead of erasing them
- CSS Modules only — no inline styles except for dynamic values (colours, widths from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`

## Framework boundary
- Application components must not import `next/link`, `next/head`, or `next/router` directly. Use `AppLink`, `DocumentHead`, and the navigation hooks exported by `src/components/platform/`; `_app.tsx` installs `NextPlatformProvider`
- Renderer integrations implement `PlatformAdapter` and install it with `PlatformProvider`; the contract includes links, head rendering, reactive navigation, public database URLs, and deferred client components. `BrowserPlatformProvider` from `components/platform/browser` supplies the native History API plus client-gated `React.lazy` registry; Next installs its own provider. Lightweight links/navigation/head have unprovided browser fallbacks, but any screen using deferred components requires a provider
- Browser-portable screens and their runtime dependency graph must not reference Next, Node built-ins, `process`, `Buffer`, `__dirname`, or `__filename`. Values that vary *per host* — site origin and the public database URLs, which differ between a Vercel preview, production and the E2E build — come from `usePublicConfig`, never directly from environment variables. Values that are *authored once per fork* — site name, description, social links, map provider key, theme colour — come from `lib/siteConfig`, which imports `site.config.json` and touches no environment. `PublicConfig` deliberately carries only the three host-varying fields; do not grow it with branding
- Keep `getStaticProps`, `getStaticPaths`, `_app`, and `_document` confined to `src/pages/`. Rendered implementations live in `src/screens/` and use ordinary typed functions rather than `NextPage`. Put data construction in `src/services/pageData/` so it can be called without Next.js
- Co-locate CSS Modules with their screen or component. Renderer entries import the reusable global `styles/globals.css` and `styles/maplibre-overrides.css`; the `pages/` route tree must not own application styles
- `components/AppRuntime.tsx` owns the renderer-neutral application shell (error boundary, query client, viewport metadata, and service-worker registration). Renderer entry points install a `PlatformProvider` outside it and inject renderer-specific telemetry explicitly
- HTML entry adapters must install `THEME_BOOTSTRAP_SCRIPT` from `util/themeBootstrap.ts` inline before application markup; it is the shared pre-paint theme initialiser used by Next's `_document`
- Keep `public/sw.js` renderer-neutral: classify generated scripts, styles, and fonts by request destination, never by framework-owned URL prefixes such as `/_next/`. `/vendor/` is the exception and is **network-first**: MapLibre's worker modules live together beneath a dependency-versioned path so an old controlling service worker misses its cache after an upgrade; network-first also repairs a truncated cached copy. A bad worker fails quietly and totally — the worker fetches the tiles, so the map reaches `data-map-status="ready"` and never `loaded`, with a blank basemap
- The installed slideshow PWA precaches its HTML plus discovered generated JS/CSS, install icons, and best-effort default SQLite databases. All same-origin `.sqlite` URLs use network-first runtime caching so renderer-configured database paths also restart offline; configured slideshow query URLs fall back to the cached `/slideshow` document. Its `navigate-existing` launch handler reuses an installed window but always returns it to the slideshow launch URL; do not use `focus-existing` without also implementing `launchQueue`. The service worker deliberately does not intercept images, audio, video, or remaining `/data/` requests: the browser HTTP cache owns album media so Firefox avoids Cache Storage response overhead and compressed media is not duplicated into a potentially multi-gigabyte origin cache. Activation deletes the retired `snapshots-pwa-images` cache. The shell and databases still restart offline, but individual slideshow photos are only best-effort browser-cache hits and are not guaranteed offline. Wake-lock settling is exposed as `data-wake-settled` on the "Slideshow diagnostics" element; tests that depend on wake-lock state should await it rather than sleeping — that group stays mounted even when nothing inside it is shown, precisely so it can carry that signal. The shell's corner status pill (and the panel behind it) is **opt-in**: hidden unless `readStatusPillVisible` says otherwise, toggled from `/slideshow/diagnostics`, and synced through the `storage` event so a running kiosk picks it up without a reload. Tests that drive the panel must seed `slideshow-status-pill` themselves. `/slideshow/diagnostics` is the full-page form of that panel, reached from the slideshow toolbar's session dock; it is a precached shell document (readable offline) and owns no live state — the shell mirrors its status into `localStorage` via `writeShellStatus` alongside the event log and heartbeat, which is the only channel between the two documents. Slideshow URL params (including `topic=`, which seeds similar mode from a semantic text query) are documented in the comment block in `src/screens/slideshow/SlideshowScreen.tsx`
- `AppRuntime` registers `/sw.js?v=<build version>` with `updateViaCache: "none"`; the worker derives its cache generation from that URL and deletes older `snapshots-pwa-*` generations on activation. Preserve this link so code deploys cannot accumulate stale hashed chunks
- `npm run prepare:pwa-icons` derives the 192px, 512px, and Apple touch PNGs from `public/pwa-icon.svg`; edit only the canonical SVG, not the generated PNGs
- Shared page-data and map/timeline view contracts belong in `src/util/pageDataTypes.ts`; import them from that canonical module rather than re-exporting types from components. Services must never import React, Next.js, components, or component-owned types
- `useUrlSearchParams` excludes dynamic route parameters, rejects ambiguous repeated scalar values through `getSearchParam`, and exposes `ready`. Gate the initial mount of stateful children on `ready` when their reducer/state is seeded from the URL
- Client-only application wrappers (`*Deferred.tsx` and `DynamicSearchWithCoi`) resolve components through `useClientComponents`. Next's literal, statically analysed `next/dynamic(() => import(...))` calls all live in `platform/next/nextClientComponents.tsx`; the native fallback uses client-gated `React.lazy`
- Keep framework-generated data behind stable application URLs rather than `/_next/data/...` or `__NEXT_DATA__`. Fetch those URLs through utility functions, not from components directly
- `src/components/platform/boundary.test.ts` enforces the allowed Next.js runtime imports and dependency direction. `next/link`, `next/head`, and `next/router` belong together in `platform/next/NextPlatformProvider.tsx`; `next/dynamic` belongs in `platform/next/nextClientComponents.tsx`. Update the allowlist only when adding a deliberate renderer adapter
- `exifr` must remain in `serverExternalPackages` in `next.config.js`; bundling it into the App route selects the wrong runtime branch and produces an empty map index
- `robots.txt`, feeds, and sitemaps are generated static assets via `src/bin/generate-feeds.cjs`, not framework routes
- Videos and YouTube externals reach search, the map and the timeline through the poster frames written by `prepare-video-posters.cjs`; run `npm run prepare:posters` before indexing. `services/videoPoster.ts` and `services/youtubeExternal.ts` are loaded directly by that CJS script through Node's TypeScript stripping, so neither may gain a runtime relative import — `youtubeExternal.ts` takes `posterPathsFor` as an injected `resolvePaths` for exactly this reason
- `prepare-optimised-images.cjs` reads every variant back and compares a 4×4 reduction against its source before renaming it into place, retrying once. An encoder returning success while writing a complete, decodable, *garbage* file is a failure mode that has happened and shipped; nothing else in the pipeline can see it. Tolerance is 20 per channel — a good encode measures 0–5 even when upscaling, the corrupt one measured ~90
- Keep `tsconfig.json` framework-neutral. Normal and E2E Next builds use `tsconfig.next.json` and `tsconfig.e2e.json` respectively; put Next's TypeScript plugin and generated-route includes there so builds do not rewrite the shared config
- `tsconfig.portable.json` compiles the screen/component graph without Next, Node, or build-time service types. Keep it passing and keep its exclusions narrow; `components/platform/next/` and the explicitly Node-only embedding stats utility do not belong in the portable graph

## Testing

**Jest** — unit/integration tests, run from `src/`:
- Config: `src/jest.config.mjs`; test environment is `node`
- Playwright tests in `src/tests/` are excluded from Jest automatically
- Screen behaviour tests import from `src/screens/`; import `src/pages/` only when testing a Next route adapter such as `getStaticProps` or `getStaticPaths`

**Playwright** — e2e tests, run from `src/`:
```
npm run test:e2e                                # build + start server + run all tests (Chromium only locally)
npm run test:e2e -- ./tests/smoke.spec.ts --project=chromium   # single file
npm run test:e2e:reuse -- ./tests/smoke.spec.ts                # reuse already-running dev server
```
- Config: `src/playwright.config.ts`; tests live in `src/tests/*.spec.ts`
- Normal local runs: Chromium only, deterministic fixture preparation, fresh production server
- CI: full Chromium suite plus smoke coverage in Firefox and WebKit, fresh server always
- Use `test:e2e:reuse` only when a server is already running — do not use it to skip the build
- **Specs that drive a control navigate with `gotoHydrated`** (`tests/hydrated.ts`), which waits for `html[data-app-hydrated]` — set by `AppRuntime` in a mount effect. Server-rendered markup looks interactive long before React attaches, and a control driven in that window takes a value hydration then discards: the theme picker failed exactly that way, asked for "slate" and reporting "dark". Nothing in the application reads the attribute
- **`typecheck:tests` (in `npm run lint`) is the only thing that typechecks test files.** `tsconfig.typecheck.json` excludes them and the Next builds only see what they import, so nine type errors had accumulated — two naming things that no longer exist (a `galleryStyleId` that left with the metered provider, a `modelId` that moved). A test asserting a removed key asserts nothing
- **The managed server's port is `43110`, not 3000**, and `PLAYWRIGHT_PORT` overrides it. A taken port becomes a free one via `bin/pickFreePort.cjs` rather than a stopped suite — but only once: the picked port is handed to the workers through `PLAYWRIGHT_E2E_PORT`, because every worker re-evaluates the config and picking per process gave each a different port. 3000 is where every other project's dev server lives, and under WSL a *Windows* process holding it collides through localhost forwarding — a conflict `ss` inside the distro cannot see, so it surfaces as a bare `EADDRINUSE` and the suite refuses to start. `test:e2e:reuse` defaults to 3000 instead, because that is what `npm run dev` serves; `PLAYWRIGHT_BASE_URL` still overrides everything
- `npm run prepare:e2e-fixtures` recreates isolated core and embeddings databases (`src/public/e2e-search*.sqlite`) using the production schema split; normal E2E builds never read or overwrite the local indexed databases
- **CI album data:** only `albums/test-*` directories are checked into git (real albums are gitignored). Playwright tests must use `test-simple`, `test-manifest`, or `test-manifest-v2` — never hardcode real album names like `snapshots` or `24japan`
- **Test albums are hidden from normal builds:** `albums/test-*` only appear when `ALBUM_INCLUDE_TEST_ALBUMS=1` (set by `build:e2e`). For `test:e2e:reuse` against a dev server, start it with `ALBUM_INCLUDE_TEST_ALBUMS=1 npm run dev`

**Python (indexer)** — unittest, run from `index/`:
```
./do-test-index.sh          # runs index.test.py via uv
./create-test-db.sh         # rebuild committed fixture DBs; requires inference deps
```
- Tests live in `index/index.test.py`; uses `unittest` + Click's `CliRunner`
- The default suite is model-free and safe for CI; never enable `INDEX_RUN_MODEL_INFERENCE` in normal CI
- `create-test-db.sh` rebuilds the committed/working SQLite fixtures when needed

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
- The map is behind a provider-neutral port. Application components import **only** from `src/components/map` (`MapView`, `useMap`, `Marker`, `Popup`, `DataLayer`, and the neutral `LngLat`/`Bounds`/`PointFeature`/`LineFeature` types). `react-map-gl` is gone
- MapLibre lives **only** in `src/components/map/adapters/maplibre/`, and `src/components/map/port.ts` has no imports at all. `src/components/map/boundary.test.ts` enforces both — nothing outside `components/map/` may import the adapter, and nothing outside the adapter may import `maplibre-gl`. It is not an allowlist; migrate the consumer instead
- GL style-spec never crosses the port. Describe bulk data with `DataLayer` (neutral points/lines, clustering, halo, dash, taper) rather than a source plus layer objects
- **Bulk markers must stay on the GPU.** ~1400 photos as DOM markers cost ~35.5ms/frame and all of the main-thread blocking; as one `DataLayer` marker count stops affecting frame time at all. DOM `Marker`s are only for the thumbnail zooms, where **every photo in view gets one** — thinning them by screen density was tried, measured and rejected on how it looked, so a dense city really does pay for ~164 markers at ~0.09ms each per frame (MapLibre reschedules every marker every frame; see plan-003 before proposing it again). Marker mounting is staggered (`useStaggeredMarkerMounts`) and marker images have no second visibility gate: `MARKER_RENDER_PADDING_PX` must stay above `MARKER_PREVIEW_EXTENT_PX`, since a marker's box is only its pin and its thumbnail hangs ~139px above. See `docs/plan-003-map-abstraction.md` for the measurements
- A GPU layer has no DOM, so it carries no roles, labels, focus or tap targets. `MapPhotoMarkers` compensates with a visually-hidden focusable list and a coarse-pointer hit layer — keep both working when changing that path
- `useMap()` returns the `MapInstance` directly (not `{ current }`) and only inside `<MapView>` children — use small child components for imperative work (`MapAutoFit` is the pattern)
- Children mount as soon as the map object exists, not on `load`, so a failed style or dead tile worker degrades to controls over a blank basemap rather than deleting the map UI. e2e liveness therefore asserts `data-map-status="loaded"`, never the presence of a child
- Give `DataLayer` an explicit `order` where stacking matters; without one, draw order follows mount history
- Route overlay is SVG (screen-space), projected via the port's `project()`
- The basemap is the reader's choice: `util/mapStyles.ts` holds the curated styles and the preference (a small external store, because a `localStorage` write raises no event in its own tab). **There is no metered provider.** Every style is either OpenFreeMap's own catalogue or a document this site serves from `public/map-styles/`, so no basemap can go dark because a quota ran out or a key was restricted to another domain, and a fork needs no credential to get a map. A theme with an obvious map of its own supplies the default (terminal opens on CRT, slate on blueprint, ink on sketch); a reader's stored choice outranks it, and light and dark stay on the configured default because they are the schemes people read in. `MapStyleToggle` picks — in the nav, between the map's search field and the site theme picker (`themeAdjacentItem`) — and `MapWorld` reads it through `useMapStyleName`. Note the cost of that placement: on a ~390px viewport the two selects together are wider than the nav row, so they wrap to a band of their own and the map carries three bands of chrome. Every option is the same provider and key as the default, so no option adds a credential or an attribution obligation — the map renders whatever attribution the loaded style declares. `Map.tsx` and `StatsWorldMap` keep their own deliberate styles
- **"Match theme" is a choice, not the absence of one.** `AUTO_MAP_STYLE` is stored like any basemap and is what the picker opens on; `useMapStyleChoice` is what the control binds to and `useMapStyleName` resolves it through `defaultMapStyleForTheme`. Nothing stored means the same thing, so a reader who pins a basemap can go back — before, following the theme was the empty slot and there was no row to return to. Another tab clearing the preference restores following the theme, not the configured default
- **The railway is on the map, and the metro is a separate network.** `composeMapStyle`'s `rail` option draws `class=rail` and `class=transit` as two layers (`metro` colours the second), above the roads and including tunnels — the Tokyo Metro is almost entirely underground, so filtering brunnels erases it. The metro has its own zoom ramp because it has its own floor: **the tiles carry no subway below z14** (measured against the tiles — a Tokyo z13 tile has eleven railways and no subway, its z14 child has eight; Singapore's MRT appears only at z14). The copied gallery cartography draws heavy rail, light rail and trams and *no subways at all* — its "Minor rail" layer filters on `subclass` — so `withTransit` in `prepare-map-styles.cjs` injects a Metro layer beneath the first symbol layer. It runs **after** each tint, coloured from that theme's own ink: tinting a fixed colour pulled the line into the ground, and on ember it came out dark brown on dark brown
- **Watercolour is composed, not transplanted.** The copied document's whole look came from a raster texture tileset this fork does not have; what survived was a flat cream blob at city zoom and a muddy wash in the middle of Osaka. It is built from the palette now, like the other made-here styles: washed ground, a sea that pools at a **blurred** coast (`coast.blur`, which is what makes a wash read as paint), the streets left as paper with their casing carrying the grid, grain over the sheet. `watercolour.template.json` and its sprite are gone, and the `watercolour` theme opens on it again rather than borrowing sketch
- **The gallery style's names are quietened in one place.** `quietenGalleryChrome` in `prepare-map-styles.cjs` greys the ward/city, town, suburb and road-name layers, mutes the points of interest (a station, a park and a clinic arrived at full saturation from z13, and red is the photo pins' own colour — each keeps its hue and loses its saturation, icons included at a lower opacity), and **drops** the shield layers outright — a motorway shield is a road sign on a map whose subject is the photographs, and in Tokyo it renders the raw OSM `ref` ("C1;409", two route numbers and the semicolon between them). A Tokyo ward is `place=city`, so 港区 comes off "City labels", not "Place labels"; quietening only the latter is why it stayed bold and black through two attempts
- **`--map-bottom-chrome` is how the map's bottom edge stays clear.** `MapScreen` sets it when the date panel is open, and everything along that edge reads it: MapLibre's own control containers and `MapRecencyLegend`, which positions itself by hand and so was the one thing left under the histogram. A custom property inherits through the map's DOM, which is what lets a legend in another module follow without either file knowing the other's classes
- **A style that gives the small streets a weight of their own draws them only there.** `composeMapStyle` takes the minor classes out of the ink layer whenever `minorRoad` is set: painting a quieter line *over* the full-weight one cannot make a street quieter, because the ink underneath shows through at any opacity — sketch at z12 was one mesh whatever the minor colour was. The **casing** deliberately keeps them, since it is what carries the grid on styles where the small streets are lighter than their ground (watercolour)
- **`trace` is a basemap nobody picks.** White linework on pure black, for the slideshow's inset, where `mix-blend-mode: screen` drops the ground and leaves the lines on the photograph. It replaced a light provider style that was being `filter: invert(1)`-ed to fake this — invert a near-white map and its white roads go black, and black screens to nothing. Its group is `internal`, which keeps it out of `MAP_STYLE_NAMES` so the picker never offers it and a stored preference naming it is rejected: with no photograph under it, it is a black rectangle
- **The slideshow's press is the gesture, not a replay of it.** `data-pressed` goes on the layer under the finger at `pointerdown` and comes off when the contact ends (release *or* cancel, so a gesture the browser takes away cannot leave the photograph pushed in); the release is also what advances, so the bounce and the next load are one event. It replaced a 200ms dip fired *after* release on its own clock — a slow press got no answer at all and a quick one got an answer that had already finished. The release curve lives on `scale` in the base layer rules, deliberately not as a blanket `transition-timing-function`, which would re-time the cross-fade too
- **A drag uncovers where it is going.** `[data-drag-peek]` sits under the layer stack with the neighbour photograph — `bufferedPhotoSrc` for a leftward drag, `previousSeed`'s for a rightward one — and its opacity rides `--drag-peek-progress`, so a spring-back takes it away. Only while the gesture is live: once it settles, the incoming layer *is* the picture. Before it, dragging revealed the page behind the slide, which is a black void
- **A basemap may supply the pins' two ends.** `recencyRampFor`/`pinHaloFor` in `util/mapColor.ts` give `crt`, `neon` and `blueprint` ramps of their own, because a phosphor tube has one colour and a cyanotype one ink — fourteen hundred red-to-blue dots on either read as a fault rather than as data. The *encoding* never changes: older is still paler, and lightness is the ordered channel that survives going monochrome. `MapWorld` passes the ramp to both `stylePhotosByRecency` and `MapRecencyLegend`, or the legend would explain a ramp the map is not drawing
- Map search metadata is build-generated at `/data/map-search-index.json`. Fetch it with `fetchMapSearchIndex`; preserve `cache: "no-store"`, the response's `must-revalidate` header, and the service worker's network-first handling so deployments cannot leave a stale index cached indefinitely

## Site configuration (src/site.config.json)
Everything that identifies *this* instance lives in one committed JSON file, read by two thin modules: `src/lib/siteConfig.ts` for TypeScript and `src/bin/siteConfig.cjs` for `next.config.js` and the bin scripts, which cannot import `.ts`.
- The TypeScript reader uses an **annotated** assignment (`const siteConfig: SiteConfig = raw`), so a missing or mistyped key fails `npm run typecheck`. Never weaken it to `as SiteConfig`
- `test/branding.test.ts` walks the AST and fails if the configured site name appears in a source literal outside `lib/siteConfig.ts`. Because the needle comes from configuration, it guards forks too
- Page titles go through `formatPageTitle()` in `lib/seo.ts` — never write the site name into a screen
- `manifest.webmanifest` and `social-preview.svg` are **generated** from this file by `prepare:feeds` and gitignored; edit the configuration, not the output. `sw.js` stays static and is cross-checked against the config by `test/pwa-manifest.test.ts`
- `map.defaultStyle` is the basemap a reader who has never chosen one opens on. It names a style from `util/mapStyles.ts`; there is no provider key to configure, because there is no metered provider
- **`paths.albumsDir` is a data-format constant, not a free choice.** The search database keys photos by that prefix (`../albums/<album>/<file>`) and `deserialize.ts` looks rows up by that exact string. An absolute value is rejected at load; a mismatched relative one is reported once per build with a sample indexed path, because it is otherwise completely silent — every lookup misses and the build succeeds with no tags, alt text, geocodes or colours

## Design tokens (src/styles/globals.css)
Always use tokens — never raw px values or colours.
- **Themes:** system/light/dark plus named palettes `paper`, `ink`, `slate`. Registry in `src/util/theme.ts`; each named theme is a `:root:where(.theme-*)` token-override block in `globals.css` applied alongside its base scheme class (`light`/`dark`). Preference persists as `localStorage.theme` (legacy `darkMode` still read), applied pre-paint in `_document.tsx` and reactively by `ThemeToggle` (a select in the nav). `?theme=` URL param accepts any theme name.
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
- `Pill` / `PillButton` / `pillStyles` — rounded nav link / action button; `variant="surface"` (default) or `"ghost"`; use `pillStyles` for composing with `AppLink`
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
uv sync                 # install lightweight indexing/test dependencies
uv sync --extra inference # add Torch and Transformers for model runs
uv run ruff check --fix . # lint
uv run ruff format .      # format
```

**Run** (use the shell scripts, which handle the DB split and copy):
```
cd src && npm run prepare:posters   # FIRST: extract video poster frames
cd index
./do-full-index.sh          # full hybrid index → produces both DBs
./do-embeddings-index.sh    # refresh embeddings only, keep existing search.sqlite
```

**Videos are indexed through a poster frame.** `npm run prepare:posters` (also run
by `predev` and `build:prepare`) extracts one frame per local clip into the
album's own `.resized_images` cache under the *video's* filename — so every
existing `@<size>.avif` URL builder addresses it without knowing videos exist —
plus a full-size JPEG and a sidecar in `.resized_videos`. The sidecar carries the
clip's camera-local wall clock, ISO 6709 coordinates and duration, because a
poster has no EXIF of its own. YouTube externals get the same treatment from
their oEmbed title and thumbnail, under the synthetic name `<video id>.youtube`;
the network is only touched when that cache is cold. A video with no poster yet
is reported by `index` and skipped, never indexed blind — run the prepass and
index again. `metadata.media_kind` and `metadata.duration_seconds` are what the
search tiles, map popup and timeline read to mark a result as playable.

**A long clip is also indexed a minute at a time.** The prepass extracts a frame
per minute (capped at 60 per clip, stretching the interval beyond that) and lists
the offsets in the sidecar; the indexer turns each into a scene row named
`clip.mov@t120`. Scenes are deliberately **embedding-only**: SigLIP vectors and a
locatable row, but no caption, no colours and no searchable text, so captioning
an hour of footage never costs an hour of GPU and scenes cannot flood keyword,
facet or colour results. `rankEmbeddingsByVector` collapses a clip's scenes to
its best-matching moment, and `withoutScenes` keeps them out of the slideshow
pool, memories and the random draws — they are moments, not photographs. A scene
result links to `/album/<album>?t=<seconds>#<clip>`, which `seekLinkedMoment`
uses to seek the video. `metadata.scene_seconds`/`scene_of` record where a scene
sits and which clip it belongs to.

**Output databases** (both copied to `src/public/` after indexing):
- `search.sqlite` — FTS5 content, tags, metadata, colours; loaded on first search use
- `search-embeddings.sqlite` — embeddings table only; loaded lazily for semantic/similarity search; falls back to `search.sqlite` if absent

**What it does per image:**
1. Reads EXIF (via `exifread`) — camera make/model, lens, focal length, GPS, timestamp
2. Reverse-geocodes GPS coords to city/country (in-process k-d tree, no API)
3. Runs the configured caption backend (**Gemma 4 E4B GGUF** via a resident `llama-server`) — produces `tags` and `alt_text` as JSON (see `index/README.md` for backends; the retired `identified_objects`/`themes`/`subject` fields are parsed only for legacy DBs)
4. Runs **SigLIP v1** (`google/siglip-base-patch16-224`, GPU) — embeddings compatible with the browser text encoder; required for semantic search
5. Optionally runs **SigLIP v2** (`google/siglip2-base-patch16-224`, GPU) — higher-quality embeddings for image-to-image similarity only (incompatible with the browser text encoder)
6. Extracts dominant colour palette via `fast_colorthief` (Rust, runs concurrently with GPU work)
7. Writes everything into `search.sqlite` in a single batch transaction; `do-full-index.sh` then splits out the embeddings table into `search-embeddings.sqlite`

**Model profiles:**
- `captions` — tags/alt text only (no embeddings)
- `siglip2` — both SigLIP v1 + v2 embeddings, no VLM tags
- `hybrid` — both (default for production)

**Database schema** (FTS5 + plain tables):
- `images` — FTS5 virtual table: `path`, `geocode`, `exif`, `tags`, `colors`, `alt_text`, `subject`
- `metadata` — `path`, `lat_deg`, `lng_deg`, `iso8601`, `media_kind` ("photo"/"video"), `duration_seconds`
- `embeddings` — `path`, `model_id`, `embedding_dim`, `embedding_blob` (int8-quantised), `embedding_scale` (per-vector dequantisation factor); readers (`api.ts`, `computeEmbeddingStats.ts`) also accept the legacy `embedding_json` format from older DBs
- `tags` — denormalised tag frequency counts
- `image_tags` — `path`, `tag`, `source`; the authoritative per-image tags (`tags` counts are rebuilt from this, never from the lossy `images.tags` column)
- `pipeline_state` — `path`, `stage`, source digest, pipeline version, and model provenance; drives incremental stage refresh and the in-place caption-provenance migration

**Key behaviours:**
- Incremental: already-indexed paths are skipped (one bulk `SELECT` into a set, then O(1) checks)
- `colors` stored as serialised RGB tuples; `parseColorPalette` in `src/util/colorDistance.ts` deserialises them at build time
- FTS5 uses `porter trigram` tokeniser — supports both stemmed keyword and substring search
- Page size 4096 (SQLite default) and journal mode `delete`; opening an old DB (JSON embeddings / 1024-byte pages) with any command that calls `setup_tables` — e.g. `backfill` — migrates and VACUUMs it in place

## The explore cloud (`src/components/EmbeddingSpace.tsx`)
Every embedded photograph, placed by its SigLIP vector and drawn on a canvas. Three pieces, all generated at build time:
- **The projection.** `util/embeddingSpace.ts` takes the vectors to three dimensions by power iteration (no covariance matrix — 768×768 doubles to answer one question). Its seed is deterministic, so a build that runs twice publishes the same pose rather than a rotated one every reader downloads again; each axis is orthogonalised against those already taken, or the third component on a near-planar collection converges on noise pointing back into the first two. Axes are stretched towards filling the cube (capped at 3×) because the components come out ordered by variance and a faithful cloud is a pancake — the stretch is reported as `axisScale`, and the flat view undoes it, since a 2D scatter should show the proportions its components actually have. Dropping the third axis *is* the two-component projection
- **The contact sheet.** `npm run prepare:embedding-atlas` (in `build:prepare`, after `prepare:posters`) packs every optimised variant into one 2048px sheet of 48px cells — 474KB and one request against roughly 150MB and fifteen hundred. It reads `public/data/albums/*/.resized_images/*@800.avif` but keys each cell by `paths.albumsDir`, the same data-format constant the search database uses, because that key is what the payload joins on. The layout is sorted by path: an atlas that reshuffled itself would invalidate half a megabyte of cache on every build. Output is gitignored
- **The payload.** `app/data/embedding-space.json/route.ts` is a build adapter, like the map search index: points, clusters, `axisScale` and the atlas manifest at a stable URL, fetched with `no-store`, and read only through `util/embeddingSpaceData.ts`. Each point carries its cell, its four most telling tags, its three nearest neighbours *in the full 768 dimensions* (a projection puts unrelated photographs side by side, so a line drawn from screen positions would be about the projection), and which k-means clump it fell in

Invariants worth keeping:
- A canvas has no children, so the photographs in it get the same visually-hidden focusable list the map's GPU pins get, and a clump's name is a real `<button>` positioned over the canvas from the draw loop rather than text painted into it
- Every name is reset to hidden at the start of each frame; one the frame never reaches keeps whatever style it was born with, fully opaque in the corner
- The wheel listener is attached by hand to the stage (React registers `onWheel` passively, so it cannot take the gesture) and only claims it while there is room to zoom — at either limit the page scrolls again. `touch-action: pan-y` for the same reason
- A finger has no hover: the pointer position is taken on `pointerdown` and kept after it lifts, the first tap looks and the second opens, and that decision runs on `pointerup` for touch and `click` for a mouse
- A press that travelled more than a few pixels is a turn, not a click
- Depth fades against the cloud's own front and back, not absolute distance, or the fade changes meaning with every zoom

## CI (`.github/workflows/ci.yml`)
Runs on PRs to `main`, pushes to `main` and `release/*`, and manual dispatch.

**Jobs:**
- `test` — `npm ci` + `npm run test:ci` from `src/` (Node 24, ubuntu-latest)
- `test-geotag` — geotag Vitest suite + typecheck from `tools/geotag/`
- `test-index` — model-free Python index suite
- `playwright` — full Chromium suite plus Firefox/WebKit smoke tests with artifact upload (`playwright-report/`, 30-day retention)

**Notes:**
- Each job uses its package's own working directory and lockfile
- Playwright caches browser downloads and always installs the required system dependencies
- No deploy/build job — CI is test-only

## Do not modify
- `src/util/lol2album.js`, `src/util/convertlol.js` — one-off migration scripts
- `src/services/buildTiming.ts` — build instrumentation only, no logic
- v1 album manifest (`manifest.json`) — deprecated, handled in `getAlbum` for legacy support only; new album config uses `album.json` (v2)
