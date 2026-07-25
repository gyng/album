---
description: Rules for the map port, its MapLibre adapter, and map components
globs:
  [
    "src/components/map/**",
    "src/components/MapWorld*",
    "src/components/MapPhoto*",
    "src/components/mapRoute*",
    "src/screens/map/**",
  ]
---

- The map is behind a provider-neutral port. Application components import **only** from
  `src/components/map` — `MapView`, `useMap`, `Marker`, `Popup`, `DataLayer`, and the neutral
  `LngLat` / `Bounds` / `PointFeature` / `LineFeature` types. `react-map-gl` is gone; we own the
  binding
- MapLibre lives **only** in `src/components/map/adapters/maplibre/`, and `port.ts` has no imports
  at all. `src/components/map/boundary.test.ts` enforces both directions and is deliberately not
  an allowlist — if it fails, migrate the consumer onto the port rather than exempting it
- GL style-spec never crosses the port. Describe bulk data with `DataLayer` (neutral points and
  lines, clustering, halo, dash, `lineWidthAlong`) instead of a source plus layer objects
- **Bulk markers stay on the GPU.** One `DataLayer` draws every photo in a single pass; ~1400 as
  DOM markers cost ~35.5ms per frame and every long task on the page. DOM `Marker`s are only for the
  thumbnail zooms, and there every photo in view gets one: thinning them by screen density was
  built, measured and then rejected on looks, so the per-frame marker cost at a dense pose is
  accepted (MapLibre reschedules every marker every frame — plan-003 has the numbers)
- **Nothing gates a marker's image except the bounds it mounted in.** An `IntersectionObserver`
  used to, and unloaded pictures with half of themselves still on screen: `rootMargin` expands the
  viewport, but the map container clips first. `MARKER_RENDER_PADDING_PX` therefore has to exceed
  `MARKER_PREVIEW_EXTENT_PX` — a marker's own box is just its pin, while its thumbnail hangs ~139px
  above it. Measurements are in `docs/plan-003-map-abstraction.md`
- A GPU layer has no DOM, so it has no roles, labels, keyboard focus or tap targets.
  `MapPhotoMarkers` compensates with a visually-hidden focusable list and a coarse-pointer hit
  layer whose radius degrades continuously with density. Both are load-bearing accessibility —
  keep them working
- `useMap()` returns the `MapInstance` directly (not `{ current }`), and only inside `<MapView>`
  children — use small child components for imperative map work (`MapAutoFit` is the pattern)
- Children mount as soon as the map object exists, **not** on `load`, so a failed style or dead
  tile worker degrades to controls over a blank basemap instead of deleting the whole map UI.
  e2e liveness therefore asserts `data-map-status="loaded"` and never the presence of a child —
  a canvas and children both exist while the map renders nothing
- Give `DataLayer` an explicit `order` wherever stacking matters (`LAYER_ORDER` in `MapWorld` is
  the example); without one, draw order follows mount history
- Popups do not take focus on open (the adapter sets `focusAfterOpen: false`), because the port
  promises a popup its opener owns
- Route overlay is SVG (screen-space), not a MapLibre layer — projected via the port's `project()`
- `mapRoute.ts` owns all route/journey logic: `RoutePoint`, `buildMapRoute`, `splitRouteByDay`
