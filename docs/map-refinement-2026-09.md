# Map refinement — 5 September 2026

Scope: reduce redundant work without changing map behaviour, and align native
controls with the application overlay. Earlier uncommitted repository-review
fixes were preserved; committing and publishing were separate follow-up steps.

## Performance

`MapWorld` already prepares every album's route for journeys. Hovering/selecting
a photograph nevertheless called `buildContextRoutePoints`, which filtered the
whole collection and rebuilt that album's route. The screen now selects the
context from its existing prepared route through `selectContextRoutePoints`.
No new global cache, deferred interaction, thinning or visibility gate was added.

Measured before changing the implementation, using the production map's 1,517
photos and its largest album (231 photos). The original implementation came from
`56f9c75`; paired Node 26 runs loaded both implementations in the same process,
then cycled through 200 targets per batch, seven batches per session. The table
shows the median per-call batch mean for simplified context selection. Route
preparation is excluded from the new hover path because the screen already does
it independently, not because it has been moved to an unmeasured new task.

| Paired session | Previous hover calculation | Reused route | Reduction |
| --- | ---: | ---: | ---: |
| First | 0.983ms | 0.345ms | 65% |
| Confirmation | 1.320ms | 0.432ms | 67% |

These are CPU calculation timings, not an overall frame-rate claim. Browser
traces were dominated by the native/WebGL renderer; no rendering-quality or
marker-count tradeoff was made. A separate timestamp-sort precomputation showed
no convincing improvement and was discarded.

Full and simplified route outputs were compared exactly against the original for
every album, and context outputs for every one of the 1,517 photos in both modes.
All matched, including point membership and metadata. Gestures, camera fitting,
URL behaviour, search, selection, ordering and thumbnail thresholds are unchanged.

## Chrome

- One safe-area-aware gutter aligns navigation, the native control rail, scale,
  recency legend and date panel: 20px normally and 12px below 720px.
- Native buttons use the existing 44px tap-target and corner-radius tokens.
  Short landscape layouts put zoom/compass in a row so fullscreen and attribution
  do not overlap. Every control remains present.
- The date panel publishes its border-box height. Its previous ResizeObserver
  update used the content box, losing 18px of padding/border and erasing the
  intended clearance. Scale/attribution now keep an 8px gap as the panel grows
  and shrinks; the recency legend shares that clearance.
- Reduced-motion mode disables the clearance transition. Embedded photo maps
  retain their original layout: the geometry overrides are scoped to MapScreen.

The frontend-design skill guided a restrained alignment pass using the existing
theme, spacing and control tokens rather than introducing a new visual language.

## Verification

- 50 map-related Jest suites / 503 tests passed.
- Lint, app/portable/test typechecks and formatting passed.
- Fresh production build; 24 Chromium browser tests passed, three existing smoke
  skips. Coverage includes real tile-worker rendering, pin selection/dismissal,
  search, basemap persistence, date filtering and embedded-map attribution.
- New layout regressions cover 1440×900, 834×1112, 390×844 and 844×390, including
  date-panel resizing. The initial implementation failed alignment by 35px;
  the short-landscape overlap was separately reproduced and corrected.
- Six iPad-emulated WebKit checks passed against the production build: all four
  layout sizes, the phone appearance row and the date-panel/legend clearance.
- Real-basemap screenshots were inspected in light/dark themes on desktop,
  iPad-sized, phone and short-landscape viewports.
