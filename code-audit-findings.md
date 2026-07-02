# Code audit findings — July 2026

Full-codebase correctness audit (src TS/TSX, Python indexer, bin scripts, CI config).
Seven parallel subsystem reviews; every high-severity finding was independently
re-verified against the code, and several were confirmed against the live deployment
or a running dev server. Severity: **high** = user-visible breakage or data loss,
**medium** = wrong behaviour in a real scenario, **low** = edge case / latent.

Counts: **9 high · 1 systemic theme · ~28 medium · ~35 low**

---

## High severity

### H1. Similar-mode kiosk freezes permanently after an in-place DB refresh (regression from 76e81d2)
`src/pages/slideshow/index.tsx:914,960-966` + `src/components/useSlideshowCadence.ts:94`

The pool-load effect re-fires when `database` changes (the 10-minute kiosk poll →
`refreshDatabase(true)`). It does `dispatchHistory({ type: "reset" })` — wiping the
current slide — but only re-commits a photo for `random`/`weighted` mode or when
nothing was on screen. In `similar` mode with a slide showing, nothing is committed,
`currentPhotoPath` becomes null, the page drops to the "Preparing slideshow…" boot
screen, and the cadence timer (`if (isPaused || !hasCurrentPhoto) return`) never
re-arms. Frozen until human input. This is exactly the flow commit 76e81d2 ("Keep
slideshow alive across data refreshes") was meant to protect — the pre-refactor code
swapped the pool without resetting history.

### H2. Production ships `buildVersion: ""` — kiosk deploy detection is dead (live bug)
`src/bin/write-build-manifest.cjs:31-40`

`gitSha = options.gitSha ?? process.env.VERCEL_GIT_COMMIT_SHA ?? getGitSha(...)` uses
`??`, which doesn't guard empty string. The wizard's `vercel pull` writes
`VERCEL_GIT_COMMIT_SHA=""` into `.vercel/.env.production.local`, so `gitSha` becomes
`""` (skipping the git fallback) and `buildVersion = … ?? gitSha ?? builtAt` resolves
to `""` (the `builtAt` fallback never fires). **Confirmed live:**
`https://photos.awoo.party/version.json` currently serves `{"buildVersion": ""}`.
`decideBuildUpdate` (`src/util/kioskRefresh.ts:30-36`) requires a non-empty latest
version, so the slideshow's build-update detection silently never triggers.
Fix: wrap the whole `gitSha` chain in `nonEmpty()`.

### H3. `metadata.iso8601` has never been populated — key mismatch (live: 1489/1489 NULL)
`index/index.py:2875` vs `:2973,:3029`

`analyse_image` returns the timestamp under `"datetime"`, but both insert paths read
`analysed.get("iso8601")` — a key that never exists. Every row's `iso8601` is NULL
(confirmed against the live `search.sqlite`; mismatch dates to 2023). Date search only
works because `src/components/search/api.ts:111` falls back to string-parsing the
`exif` text column. Note: fixing the key exposes L-idx1 below (local time stamped `Z`).

### H4. `prune` deletes every row when the glob matches nothing — no empty-set guard
`index/index.py:2451-2462`, enabled by `index/do-full-index.sh` (missing `cd "$(dirname "$0")"`)

`find_files` returns `[]` silently for a nonexistent directory, so
`to_delete = [p for p in paths if p not in files]` becomes *all paths*, and
`do-full-index.sh` chains index→prune unconditionally. If `../albums` is unmounted or
the script is run from the wrong cwd (it's the **only** index script missing
`cd "$(dirname "$0")"` — the enabling half), the canonical incremental DB — days of
GPU work, gitignored, no committed backup — is emptied. The smoke test then blocks
publishing, but the damage is already done.
Fix: refuse to prune when `len(files) == 0` (or above a deletion-ratio threshold), and
add the `cd` line to `do-full-index.sh`.

### H5. Videos with missing metadata fail `next build` (`undefined` in SSG props)
`src/services/video.ts:198-212`, `src/services/deserialize.ts:108-117`, `src/services/album.ts:218-244`

`getOriginalVideoTechnicalData` resolves explicitly-`undefined` fields
(`originalDate`, `bitrateKbps`, …); `deserializeVideoBlock` puts a possibly-`undefined`
`date` into block data; `appendExternalBlocks` does the same for manifest externals.
These flow into album-page props, and Next runs `isSerializableProps` for SSG **at
build time** — any explicit `undefined` aborts the build ("Error serializing
`.album.blocks[N].data.date`"). Current albums survive only because camera MOVs happen
to carry all fields; one WhatsApp/screen-recording export (no `creation_time`) breaks
the build.

### H6. Unknown `/album/*` URLs return 500 instead of the styled 404 on Vercel
`src/pages/album/[[...slug]].tsx:175-178,190-198`

`getStaticPaths` uses `fallback: true`, so unknown slugs invoke `getStaticProps` in a
lambda — where `getAlbumNames()` reads `../albums`, which isn't deployed to Vercel
(`generate-feeds.cjs` exists precisely because of this). The read throws → 500,
defeating the explicit intent of the guard comment at lines 171-174. All valid albums
are known at build time; `fallback: false` gives the intended 404 for free.

### H7. Visual-sameness stats mix SigLIP v1 and v2 embedding spaces (and double-count every photo)
`src/util/computeEmbeddingStats.ts:298-303`

The embeddings query has no `model_id` filter, and the shipped
`search-embeddings.sqlite` contains both v1 and v2 rows (1489 each, both 768-dim), so
`parsedRows` holds every photo twice and all downstream maths runs over the mixed
population. Measured on a 300-photo sample from the live DB: the two spaces are
near-orthogonal (same-photo v1·v2 ≈ −0.08…+0.09), so cross-space pairs never *win*
nearest-neighbour — the damage is distributional, not pairwise:

- `sampleSize` reports ~2× the real photo count ("across 2,978 embedded photos").
- Every headline percentage is the 50/50 average of two models that disagree against
  the absolute thresholds: measured distinct% (<0.75) = **26.3 blended vs 16.0
  v2-only** (implied v1-only ≈ 37); repeatedMotif% (≥0.9) = 4.5 blended vs 6.3 v2-only.
- The centroid sums vectors from two orthogonal cones — a chimera in neither space;
  average/outlier grids rank v1 and v2 rows on different scales and can show the same
  photo twice (no path dedupe after `photoLookup.get`).
- k-means "eras" cluster along the model split (within-space similarity ~0.6–0.9 vs
  cross-space ~0), and era counts/shares double-count photos.
- `lookDrift` similarity is diluted toward the average of the two models' drift.

Nothing crashes because both models emit 768-dim L2-normalised vectors — the numbers
just look plausible. Fix: pick one model (prefer v2 per project docs for
image-to-image, fall back to v1) and add `AND model_id = ?`. Note this is a
per-consumer filtering fix only — the dual-model DB layout is correct and required
(v1 for the browser text encoder's semantic search, v2 for image-to-image quality).
Related low finding: `fetchEmbeddingByPath` (`api.ts:797-804`) picks the seed row's
model arbitrarily; live similar-search stays self-consistent because the scan inherits
the seed's model (`api.ts:1046`), but the ranking space — and hence result ordering
and "% match" scale — can silently flip between v1 and v2 after a reindex/vacuum.
Fix alongside H7 by preferring v2 explicitly there too.

### H8. Search shows a definitive "No results" while the 52 MB embeddings DB is downloading
`src/components/search/useSearchResultsState.ts:81`, `src/components/search/api.ts:1029,1094,1184,1257,1292,1370-1373`

`hasVectorDatabase = Boolean(embeddingsDatabase || database)` lets vector queries run
before the embeddings DB exists; the fallback `embeddingsDatabase ?? database` hits the
main DB, which (split build) has **no `embeddings` table**; `isMissingEmbeddingsTableError`
converts that to a *successful empty result*. Cold-cache visitors on `/search?similar=…`
or any default-mode (hybrid) query see "No results for X" for the whole download — and
hybrid discards the already-successful keyword ranking instead of degrading to
keyword-only. Fix: treat "embeddings DB still loading" as pending, not empty; in hybrid,
fall back to the keyword ranking.

### H9. Timeline deep links self-destruct on full page load (reproduced live)
`src/pages/timeline/index.tsx:109-115,338-347`

The URL-sync effect isn't gated on `router.isReady`. On hydration of this SSG page
`router.query` is `{}`, so `selectedDate` defaults to the latest date and the effect
immediately `replaceRoute`s with the empty query snapshot — wiping the real params
before Next populates them. Reproduced: `GET /timeline?date=2011-04-05` ends at
`/timeline?date=<today>`; `?filter_album=…&date=…` loses the album filter entirely
(every share/bookmark/refresh of a `Nav.tsx` album-timeline link).
Fix: gate the effect and the initial-state fallback on `router.isReady`.

---

## Systemic: EXIF timestamps are parsed in the build machine's timezone and re-read as UTC

Root cause — `src/services/photo.ts:36-50`: exifr (`reviveValues: true`) parses the
camera's **local wall-clock** `DateTimeOriginal` into a JS Date in the **build
machine's** zone (+08 here); `JSON.parse(JSON.stringify(...))` then renders it as a
UTC `Z` string. Every consumer that slices/derives calendar fields from the UTC
rendering is shifted by the build-machine offset (the code comment already admits
"this is wrong behaviour"). Symptom sites:

- `src/pages/timeline/index.tsx:700` — `toISOString().slice(0,10)` day keys: photos
  taken before 08:00 local land on the **previous day** in the heatmap/day grid, and
  the day heading disagrees with the photo's own EXIF time shown next to it. (medium)
- `src/components/mapRoute.ts:219-226` — `getSegmentKey` day-splitting: route "days"
  split at ~08:00 local, photos after midnight join yesterday's segment. (medium)
- `src/lib/alt.ts:28-38` — alt-text date labels formatted with `timeZone: "UTC"`:
  early-morning photos labelled with the previous date. (low)
- `src/util/photoBuckets.ts:194-202` — `YEAR_FACET`: photos from the first hours of
  1 January attributed to the previous year. (low)
- `src/util/photoBuckets.ts:120-126` — `HOUR_FACET` **double-applies** offsets: parsed
  UTC hour = local − buildOffset, then adds camera `OffsetTime` → correct only when
  build TZ == camera offset; Japan photos indexed on +08 are 1 h late. Also
  `raw.includes("T")` misclassifies local ISO strings as UTC. (medium)
- `src/util/photoBuckets.ts:100-134` — half-hour zones (`+05:30`, `+09:30`): offset
  parses to 5.5, hour becomes fractional, strict `v === h` matches **no bucket** —
  those photos vanish from time-of-day stats. Missing `Math.floor`. (medium)
- `src/util/computeStats.ts:730-747` — weekday/month buckets shifted the same way. (medium)
- `src/util/extractExifFromDb.ts:128-137` — `OffsetTime` applied in the **wrong
  direction** (should subtract, adds) and `"-05:30".split(":").map(Number)` loses the
  sign on minutes (adds −5 h **+30 min**). Affects slideshow details/time-aware
  weighting and search tile dates. Code self-flags "needs verification". (medium)
- `index/index.py:2861-2875` — indexer stamps camera-local time with a `Z` suffix
  ("# assume TZ = Z") even though `OffsetTime` is captured; latent until H3 is fixed. (low)
- `src/components/Albums.tsx:16-18` — year label uses build TZ on server, viewer TZ on
  client: hydration mismatch near New Year. (low)

Fix direction: pick one convention — treat stored `DateTimeOriginal` as camera-local
wall time end-to-end (derive day/hour/year keys from the wall-clock string, never from
a UTC re-rendering) and apply `OffsetTime` only when converting to true UTC for
cross-photo ordering.

---

## Medium severity

### Slideshow
- **Vector remix skips the most-similar photos** — `src/pages/slideshow/index.tsx:736`
  passes `page: 1` to 0-based paging (`api.ts:1053`; the trail path correctly uses
  `page: 0`), discarding the top `desiredCount*4` ranked results; the "% match" badge
  (`slideshowRemix.ts:66-67`) then reports rank ~5 as the top match.
- **`slideshowError` is invisible once a slide is on screen** — set on fullscreen/
  clipboard/pool failures (`slideshow/index.tsx:861,870,1289-1297,1536`) but rendered
  only inside the `currentPhotoPath === null` boot branch (`:1710-1716`). No toast in
  the main UI.
- **Failed in-place DB refresh is never retried** — `slideshow/index.tsx:286-296`
  records `lastDbVersionRef.current = version.raw` *before* `refreshDatabase(true)` is
  known to succeed; a Wi-Fi blip during the re-fetch pins the kiosk to stale data until
  the next re-index or the 7-day reload.

### Map
- **Antimeridian**: `MapWorld.tsx:104-108` (`MapAutoFit`), `Map.tsx:76-88` (`MapFlyer`),
  `guess/GuessMap.tsx:63-72` all do naive min/max `fitBounds` — photos at ±179°
  produce a near-360° viewport. `mapRoute.ts:83-86` + `MapWorld.tsx:433-440` draw
  Pacific-crossing legs the long way round (both GeoJSON and SVG overlay). The
  viewport-culling code at `MapWorld.tsx:834-838` already handles wrapping correctly —
  the standard exists in-repo.
- **Slideshow mini-map camera restarts every second** — `SlideshowBottomBar.tsx:76-81,
  128-143` rebuilds `slidePhotoMeta`/`allCoords` every render (parent re-renders at
  1 Hz from the clock tick), defeating `MMap`'s `React.memo` (`Map.tsx:174`, whose own
  comment cites exactly this tick) and re-firing `flyTo`/`fitBounds` (800 ms ease per
  1000 ms tick); user pans are yanked back within 1 s. Memoise on the slide key.
- **Two URL writers on `/map` desync** — `MMap` syncs camera via
  `window.history.replaceState` (`MapWorld.tsx:1092-1099`), invisible to Next's router;
  `handleTimeRangeCommit` (`pages/map/index.tsx:94-105`) rebuilds the URL from stale
  `router.query`, dropping/reverting `lat/lon/zoom` on slider commit.

### Search
- **Untrimmed keyword terms** — `api.ts:858` splits on `|` without trim/lowercase
  (every other keyword path trims): `cat, night` builds FTS phrase `" night"`, missing
  field-initial matches; facet counts (trimmed) disagree with the grid.
- **Dead NULL guard in `LOCAL_HOUR_SQL`** — `api.ts:143-144`: `NULLIF(x,'') = ''` can
  never be true, so 665 no-`OffsetTime` photos the JS facet deliberately excludes are
  included by SQL (counts vs results mismatch), and 18 undated photos match the 00:00
  bucket via `CAST(substr('',12,2) AS INTEGER) = 0`.
- **Semantic + colour filter shows "0%" badges** — `api.ts:1239-1244` sets `similarity`
  to the raw 0–1 cosine while also setting `matchingColor`; `SearchResultTile.tsx:53-64`
  takes the colour branch and renders `Math.round(0.31)` → "0%".
- **`colors`/geocode coordinates are FTS-searchable** — `api.ts:387-389` excludes only
  `path`/`album_relative_path`/`exif`; numeric queries ("108", "747") match RGB tuples
  (verified against a real trigram table) and the raw tuple fragment becomes the tile's
  snippet/alt text; "139" matches everything near longitude 139.
- **Main DB fetch failure → infinite spinner** — `Search.tsx:187` ignores the `error`
  and `retry` slots from `useDatabase()`; a 404 leaves the progress bar spinning forever
  (the embeddings DB error *is* rendered, `Search.tsx:812-816`).
- **Mid-download network error hangs the load** — `useDatabase.tsx:100-116`: the
  progress-wrapping stream never calls `controller.error(...)` and the read loop has no
  rejection handler; `response.arrayBuffer()` never settles and the hung promise stays
  cached in `databasePromises`.
- **Dead embedding worker is never reset** — `textEmbeddings.ts:82-96` rejects pending
  requests on worker `error` but keeps the module-level `worker` reference; after a
  chunk-404 (post-redeploy) every later semantic/hybrid query hangs with no error.

### Publish wizard / feeds (src/bin)
- **Dead field `mixedEmbeddingModels`** — `publish-wizard.cjs:64` reads a field the
  report never contains (renamed to `staleEmbeddingCount`), and omits stale counts —
  so after a model switch the wizard prints "Skipping index update" even though the
  execution plan prompted (and the user consented to) a re-index. Three divergent
  `hasIndexChanges` definitions exist (`publish-wizard-lib.cjs:317-322,1017-1020`).
- **Vercel auth preflight never runs in `--interactive` mode** —
  `publish-wizard-lib.cjs:369-374`: `getVercelPreflightCommand` needs
  `plan.runBuild || plan.runDeploy`, but interactive mode decides those *later* — a
  logged-out user runs a multi-hour index, then fails at `vercel pull`; exactly what
  the "Check Vercel before publish indexing" commit was meant to prevent.
- **Deleting a whole album directory is invisible** — `publish-wizard-lib.cjs:688-690,
  755-759` computes `removedPhotos` only per *existing* album dir; a deleted album's
  rows ship in the search DB indefinitely (searchable, broken links) because prune
  never runs.
- **`.jpeg` deadlock** — wizard counts `.jpeg` as photos (`publish-wizard-lib.cjs:9`)
  but the indexer glob (`do-full-index.sh`, `*.jpg`) never indexes them →
  `missingPhotoPaths` blocker → every publish exits 1 until rename or `--force`.
- **Sitemap `<loc>` not XML-escaped** — `generate-feeds.cjs:152` (and the parallel
  `src/lib/sitemap.ts:13`): `encodeURI` passes `&` through; an album named `food & drink`
  invalidates the entire sitemap. `escapeXml` exists in the same file (used for RSS).
- **Stale per-album feeds never cleaned** — `generate-feeds.cjs:377-388` only writes
  feeds for current albums; renamed/deleted albums' `public/album/<slug>/feed.xml`
  ships frozen forever.
- **`og:image` is site-relative** — `pages/album/[[...slug]].tsx:97,111` passes
  `/data/albums/...` into `Seo.tsx`; OG requires absolute URLs, so album shares render
  without the cover preview. Wrap in `getCanonicalUrl` (the default image already does).

### Components
- **ThemeToggle wrong after "Reset to system default"** (verified live) —
  `ThemeToggle.tsx:114-115,124`: `getFallbackDarkMode()` reads `document.body.classList`
  during the render triggered by the reset (before the effect removes classes), so the
  button claims dark while the page is light; and `onClick`'s `!(darkMode ?? true)`
  assumes unset = dark, so a system-light user's first click is a visual no-op.
- **CalendarHeatmap keeps the build-date "today" ring after hydration** —
  `CalendarHeatmap.tsx:439-441` + memo at `:217`: SSG HTML marks the build day; React
  doesn't patch attribute mismatches on hydration, and the later client re-render
  produces prop-identical output so the memo bails — the stale ring/future cells
  persist for the deploy's lifetime.

### Python indexer
- **One corrupt image discards the whole GPU run** — `index.py:897,1638,1641-1643,1732`:
  colour futures are `.result()`ed (re-raising) only after all Janus/SigLIP passes, and
  the first commit happens later still; a single truncated JPEG throws with zero rows
  committed.
- **Degenerate GPS rationals (`0/0`) crash assembly** — `convert_to_degress` unguarded
  at `index.py:961-967,2827-2829` (`ZeroDivisionError`); the geocode call site wraps it,
  the `analyse_image` call site doesn't.
- **VLM JSON validated for key presence only** — `index.py:305-313`:
  `"identified_objects": null` / non-string `alt_text` pass validation, then crash the
  batch insert (`:2868,:3010,:1301`), rolling back the 64-image transaction.
- **Caption "retry" is 19 identical generations** — `index.py:320-349` re-generates
  with `do_sample=False` (`:476,:545`, deterministic); attempts 3–20 are byte-identical.
  The failed image is then written with empty tags and permanently skipped by the
  row-existence check (`:1578-1581`).
- **Modified files are never re-indexed** — `index.py:1574-1593` skips on path presence
  alone (no mtime/size/hash); a re-exported photo keeps stale caption/colours/embeddings
  forever.

---

## Low severity

### Map
- `MapWorld.tsx:782-797` — `dateStats.oldest`/`newest` are swapped (descending sort,
  `oldest = at(0)`); double-inversion keeps colours in range, but undated photos resolve
  to the wrong end, and `range === 0` (burst/all-same-timestamp) yields
  `hsl(NaN,…)`/`hueRotate(NaNdeg)` — pin colouring silently dies.
- `MapWorld.tsx:1234,1304`, `Photo.tsx:113` — falsy checks (`decLat && decLng`) drop
  photos at exactly latitude/longitude 0 (culling at `:831` uses `== null` correctly).
- `dms2deg.ts:8` — no `Number.isFinite` guard: NaN from malformed EXIF passes the
  `!== null` guards downstream and reaches MapLibre (`Invalid LngLat` throw).
- `MapWorld.tsx:1267-1275` + `time.ts:12-14` — dateless popup renders literal
  "Invalid Date" (twice).
- `pages/map/index.tsx:65,94-105` — debounced URL-sync timer not cleared on unmount:
  navigate within 300 ms of a slider commit and `router.replace` injects `from`/`to`
  into the *next* page's URL.
- `MapWorld.tsx:1070-1080` — camera params skipped at sentinel values (lat 0 / zoom 1),
  leaving stale URL values.

### Slideshow
- `useSlideshowCadence.ts:67-90` — first-slide auto-align ignores the `alignCadence`
  toggle (align off + delay 15 min, open at 10:29:58 → first slide lasts 2 s).
- `useWakeLock.ts:57-88` — double-acquire race leaks an untracked sentinel (screen
  stays awake after Escape-nav); a stale sentinel's release event flips `isActive`
  false while a newer lock is held.
- `slideshow/index.tsx:2078,2121` — 1 s image-error retry timer never cancelled:
  can double-advance past a photo the user just navigated to.
- `slideshowGesture.ts:99-111,178-194` — vertical release commits at 48 px but the
  armed cue/haptic fires at 72 px: 48–72 px pulls remix "un-armed".
- `slideshow/index.tsx:1026-1030` — similar-trail queue rows drop `colors`, so the
  dominant-colour remix strategy silently never fires in similar mode.
- `SlideshowToolbar.tsx:486-509` — long-press timer not cleared on unmount (`alert`
  can fire over the wrong screen).

### Search
- `api.ts:191-194` vs `:749-761` — geocode facet filters match any line, counts are
  positional: City "Tokyo" also matches region-Tokyo photos (99 extra in live DB).
- `api.ts:666-677` — colour tolerance tested on the prominence-weighted winner, not
  the closest palette entry; `minColorDistance` in `colorDistance.ts` is unused here.
- `api.ts:427-430` — `options?.page &&` treats page 0 as falsy so `next` is never set
  on the first page; the fallback (`useSearchResultsState.ts:230-233`) then fabricates
  a "More…" button whenever results are an exact multiple of 48.
- `colorDistance.ts:77-83` — 3-digit hex (`#abc`, which `HexColorInput` emits) parses
  to NaN and is silently ignored.
- `api.ts:797-804` — `fetchEmbeddingByPath` has no `model_id` filter/ORDER BY: with v1
  and v2 rows present, similar-search's embedding space depends on physical row order.
- `SearchFacetPanel.tsx:244-247`, `SearchRefinementSection.tsx:44-47` — initial tag
  pills show `count - 1` with no explanatory comment (doesn't reconcile with the table
  value or real FTS counts; confirm intent or fix).

### Services / pages / SEO
- `album.ts:65-67` — video branch of `getBlockDate` lacks the photo branch's NaN guard:
  one malformed manifest date scrambles block order.
- `album.ts:247-252,262-269` — cover matched via `src.includes(cover)`: `"1.jpg"`
  matches `11.jpg`; `deserialize.ts:209` marks any filename *containing* "cover".
- `photo.ts:13,67` — `OPTIMISED_SIZES.sort()` mutates the exported constant.
- `serialize.ts:17-24` — `serializePhotoBlock` mutates its input (`delete` on shared
  `formatting` reference); latent (tests only).
- `album.ts:85-96` — `latest = 0` sentinel treats pre-1970 (scanned film) dates as
  missing.
- `pages/index.tsx:63-67` — cover block duplicated in props when the cover is also the
  first photo (double data, duplicate ids; benign today).
- Unencoded slugs/filenames in generated URLs: `timeline/index.tsx:706`,
  `map/index.tsx:310`, `generate-feeds.cjs:250,280` — a filename with `%` throws
  `URIError` in the album page's `decodeURIComponent` hash-scroll
  (`[[...slug]].tsx:41`); `albums/türkiye` gets byte-different canonical vs sitemap
  URLs (`lib/seo.ts:22-25` no encoding vs `encodeURI`).
- `Seo.tsx` — JSON-LD injected without `<` escaping (`</script>` in an album title
  escapes the element); standard fix `JSON.stringify(x).replace(/</g,"\\u003c")`.
- `lib/rss.ts`, `lib/sitemap.ts`, `services/albumFeed.ts` — dead duplicates of
  `generate-feeds.cjs`, imported only by tests, already diverged (green tests cover
  code that never ships; the sitemap `&` bug lives in both copies). Delete or re-point
  tests at the real generator.
- `generate-feeds.cjs:249-253,294-303` — all YouTube/external items in one album share
  the same GUID (`/album/<slug>`); readers dedupe and drop all but one.
- `time.ts:16` — `navigator.language` read during SSG; works on Node ≥21 only (global
  navigator); Node 20 build would throw. Guard with `typeof navigator !== "undefined"`.

### Components
- `ThemeToggle.tsx:141-144` + `_document.tsx:41` — "system default" state is
  unreachable across reloads: the pre-paint script falls back to `applyTheme("dark")`.
- `Photo.tsx:452-454` + ExifTable truthiness at `:186` — exposure compensation `0`
  (very common) hides the row.
- `Nav.tsx:79` — skip link targets `#main-content`, which exists nowhere; works only
  via the JS onClick fallback.
- `VideoBlock.tsx:286-292` — IntersectionObserver re-`play()`s a video the user
  explicitly paused every time it re-enters the viewport.
- `ui/SegmentedToggle.tsx:12-17` — arrow keys move selection but not focus: focus is
  left on a `tabIndex={-1}`, `aria-checked=false` button.

### bin / indexer
- `cleanup-optimised-media.cjs:54-56` — cache names split on `@`: `me@beach.jpg` is
  deleted and re-encoded every build.
- `cleanup-optimised-media.cjs:33-38` — `ctimeMs` in the staleness check: a
  `chmod`/`chown`/rsync over `albums/` invalidates the entire media cache (hours of
  re-encoding). Also a TOCTOU between `existsSync`/`unlinkSync` under concurrent builds.
- `publish-wizard-lib.cjs:735-742` — `getIndexerModelInfo` swallows all failures →
  embedding checks silently disabled with no warning.
- `publish-wizard-lib.cjs:550-555` — Invalid EXIF date escalates to an "unreadable
  photo" hard blocker (its `.toISOString()` throws into the unreadable catch) instead
  of the benign missing-date warning.
- `warm-build-benchmark.cjs:57-63,268` — unguarded `JSON.parse` of the budget file
  *after* the runs but *before* results are written: a stray comma destroys a 30-minute
  benchmark.
- `index.py:1196-1224,1329-1336` — `tags` counts never decrement on delete/prune;
  drifting counts can make the smoke test pick a tag with zero remaining images.
- `index.py:1005,1064` vs `do-full-index.sh` ordering — DB left in WAL mode after
  `prune`; only the smoke test's incidental `setup_tables` restores `delete` mode
  before `shutil.copy2` (which doesn't copy `-wal`). Reordering the script would
  publish a broken DB. Also `PRAGMA page_size=1024` is set *after* table creation
  (never takes effect on a fresh DB), and the published embeddings DB is 4096-byte
  pages.
- `do-embeddings-index.sh:6,49` — publishes from a second source of truth
  (`all-embeddings.sqlite`, months stale) and its guard permits a silent 10% row
  regression.

---

## Checked and found sound

- MapLibre undefined-paint-property rule, `useMap()` placement, map listener cleanup,
  SVG overlay invalidation on move/zoom/resize, haversine wrap-safety.
- No SQL injection anywhere (all user values bound; interpolated fragments are
  compile-time constants); the 900-path colour cap is enforced at the only IN-clause
  entry point; colour composes correctly with text/facets in all three fetch paths;
  worker request/response correlation; react-query keys cover stale-result races;
  DB init dedupe under StrictMode; embedding normalisation on both sides.
- Slideshow crossfade double-rAF race, queue/history invariants, URL round-trip,
  remix-grid reveal paths, `useLocalStorage` synchronous read.
- Indexer: SigLIP v1/v2 separation in both DBs, colour tuple format vs
  `parseColorPalette`, flock lifecycle.
- `backup-publish-assets.cjs` (copy-only, atomic DB replace makes races moot),
  `check-node-version.cjs`, cleanup naming/sizes vs generators, RSS text escaping,
  fast-track preflight ordering, exit-code propagation.
- CI workflow, Playwright/Jest configs.

## Documentation drift (AGENTS.md)

- Says "Next.js 14" — app is on Next 16 / React 19.
- Says search runs via sql.js / sql.js-httpvfs HTTP range reads — the frontend now
  fully downloads via `@sqlite.org/sqlite-wasm` (`useDatabase.tsx`); the 1024-byte
  page-size rationale is stale (and not actually in effect, see above).
