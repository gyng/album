# Plan: Replacing react-map-gl and Abstracting the Map Provider

> **Status: proposed** — nothing implemented. Three phases, each shipping value on its own.
> Phase 1 removes `react-map-gl`; Phase 2 confines MapLibre behind a port *and* banks the
> marker performance win (they are the same change); Phase 3 is deferred until a real second
> provider exists. Phase 2 must open with a profiling trace — see *Performance evidence*.

## Context

The gallery's maps are built on `react-map-gl` (v8.1.1) over `maplibre-gl` (v5.24.0). Three
things converged to make this worth revisiting.

**MapLibre 6 is blocked.** Upgrading `maplibre-gl` to 6.0.0 was attempted and verified on a
preview deploy (see `docs/` history / the dependency-upgrade commit). Types check and the build
succeeds, but the map never renders: v6's camera/event refactor ([#7800], [#7789]) removed
`map.transform` and turned events into real classes, and `react-map-gl@8.1.1`'s internal
`_onCameraEvent` reads `.center` off an event payload that no longer carries it. The first
`fitBounds` throws and the ErrorBoundary swallows the map. `8.1.1` is the latest release and the
`beta` dist-tag (`8.1.0-alpha.2`) is *older*, so nothing on npm bridges MapLibre 6 today. Owning
the binding is what unblocks it.

**Marker rendering does not scale.** `MapPhotoMarkers` renders one `react-map-gl` `<Marker>` — a
DOM node — per photo. Markers are bounds-filtered (`filterPhotosByBounds`), but at world zoom
every photo is in bounds, so ~1400 DOM markers mount, and because `bounds` is React state updated
on every move, the whole list re-renders and reprojects on each frame of a pan or zoom.

**The coupling is deeper than the binding.** Removing `react-map-gl` alone would not decouple us
from MapLibre: `mapStyle` is a MapLibre style-spec URL, `StatsWorldMap` and `GuessMap` pass raw
GL layer objects through `<Source>`/`<Layer>`, and `MapRouteOverlay` calls `map.project()`
directly.

### What we actually use

Ten non-test files import `react-map-gl/maplibre`. The full surface is small:

| Symbol | Sites | Notes |
| --- | --- | --- |
| `<Map>` (aliased `MapLibreMap`) | 3 | `MapWorld`, `GuessMap`, `StatsWorldMap` |
| `useMap()` | 5 | always consumed as `.current` |
| `<Marker>` | 3 | incl. one-per-photo in `MapPhotoMarkers` |
| `<Source>` / `<Layer>` | 2 / 2 | raw GL style-spec objects |
| `<Popup>` | 2 | context menu, photo popup |
| `MapRef` (type) | 1 | every method we call exists on `maplibregl.Map` |

`<Map>` props in use: `mapStyle`, `initialViewState`, `attributionControl`, `onLoad`,
`onMoveStart`/`onMoveEnd`, `onZoom`/`onZoomStart`/`onZoomEnd`, `onDragStart`, `onWheel`,
`onClick`, `onContextMenu`.

**The key simplification:** we use `react-map-gl` in *uncontrolled* mode only —
`initialViewState` plus imperative `flyTo`/`fitBounds`/`project`. We never bind view state back
into React. `react-map-gl`'s hardest machinery is exactly that bidirectional reconciliation, and
we do not use it, which is what makes reimplementing the binding tractable.

## Scope boundaries

**In scope:** the React binding for MapLibre; a provider-neutral map port; migrating the ten map
components onto it; rendering bulk markers as a GPU layer.

**Out of scope:** upgrading to MapLibre 6 (this plan *unblocks* it, it does not do it); building a
second provider adapter (Phase 3, deferred); changing map styling, tiles, or the MapTiler
account; the geotag tool's own map (`tools/geotag`), which is a separate package.

**Explicit non-goal:** a lowest-common-denominator map API. The port exists to contain MapLibre,
not to make the gallery runnable on Leaflet at the cost of vector tiles and GPU styling.

## Performance evidence

Per `AGENTS.md` ("No perf changes without profiling evidence first"), Phase 2 opens with a trace,
not an assumption. Measure, at world zoom during a sustained pan:

1. React commit time attributable to the marker list (Profiler).
2. Layout/reproject cost of the DOM markers vs MapLibre's own GPU render.
3. Frame time, DOM markers vs a `DataLayer` spike.

The hypothesis is that the ~1400 DOM markers dominate. If the trace says otherwise, Phase 2's
`DataLayer` work is re-scoped to whatever the trace *does* implicate; the abstraction work stands
on its own regardless.

### Measured baseline (production, before any change)

Captured on `photos.awoo.party/map`: 1440×900 viewport, camera reset with
`map.jumpTo({ center: [11.488, 9.124], zoom: 1.83 })` before every run, a 400px horizontal drag
over 1000ms driven from inside `requestAnimationFrame`, frame deltas sampled in the same loop,
`PerformanceObserver({ entryTypes: ["longtask"] })` over the same window, three runs per
condition, medians reported.

| | A: 1444 markers | B: 1444, `display:none` | C: 5 markers |
| --- | --- | --- | --- |
| Marker nodes | 1444 | 1444 | 5 |
| DOM elements | 4,521 | 4,521 | 223 |
| Frames in a 1s pan | 15 | 21 | 30 |
| Mean frame time | **70.0ms** | 50.0ms | **34.5ms** |
| p95 | 100.1ms | 66.7ms | 50.0ms |
| Long tasks | **17** | 16 | **0** |
| Total blocking time | **410ms** | 63ms | **0ms** |

A six-point marker-count sweep (1444 / 935 / 256 / 105 / 39 / 5) fits
**frame time ≈ 39.2ms + 0.0225ms × markers, R² = 0.987** — cost is linear at ~22.5µs per marker
per frame. A `MutationObserver` recorded **1,729 DOM mutations per frame**: every marker's
transform is rewritten on every frame.

**Verdict — hypothesis confirmed.** At world zoom the markers add ~35.5ms per frame, roughly
doubling frame time (15fps vs 30fps), and they are solely responsible for main-thread blocking
(17 long tasks / 410ms TBT with them, zero without). The `display:none` control splits that cost
into ~20ms of layout/paint for the marker DOM and ~15.5ms of pure JS (React re-rendering 1444
`<Marker>`s plus MapLibre's transform writes). A `DataLayer` removes **both** halves, which a
CSS-only or virtualisation-only fix would not.

### Measured result (after the DataLayer change)

Same method, same machine, on a preview deploy of the migrated code.

| | Before: 1444 DOM markers | After: GPU DataLayer |
| --- | --- | --- |
| Marker DOM nodes | 1444 | **0** |
| DOM elements | 4,521 | **195** |
| Mean frame time | 70.0ms | **31.8ms** |
| p95 | 100.1ms | **50.0ms** |
| Frames in a 1s pan | 15 | **32** |
| Long tasks | 17 | **1** (ambient — a 5-marker run showed 19) |
| Total blocking time | 410ms | **0ms** |
| DOM mutations per frame | 1,729 | **1.0** |

**2.20× mean frame time, 2.00× p95, blocking eliminated.** But the headline is not
the ratio — it is that *marker count stopped being a cost at all*. At world zoom with all
1444 points the map runs at **31.8ms**; with 5 points, **32.1ms**; with the photo layer hidden
entirely, **31.4ms**. Those are the same number. Per-photo cost fell from ~22.5µs to ~0.3µs per
frame, and the baseline's fitted line (`39.2ms + 0.0225 × markers`, predicting 71.7ms at 1444)
has collapsed flat — the new full-marker measurement sits *below the old fit's intercept*.

The ~32ms residue is the SwiftShader tile-rasterisation floor, not app code, which is why the
observed speedup is 2.2× rather than the ~4× the old fit implies. Because the after-figure now
sits exactly on that floor, the win on real GPU hardware is **larger** than 2.2×, not smaller.
The map is not "fast" on this machine — 27 of 32 frames still exceed 33ms — but none of that
remaining cost is ours, and none of it responds to further marker work.

Correctness was verified alongside the timing: 1444 features present and rendered worldwide, 191
distinct recency colours applied through data-driven paint, click-to-select still opening the
photo popup, and the DOM-marker fallback still mounting exactly 5 lazy-thumbnail markers for a
narrowed query. Zero console errors.

Two caveats for anyone re-running this. The measuring browser rasterises WebGL through
**SwiftShader (software)**, so the ~34.5ms floor at 5 markers is MapLibre's tile rendering, not
app code; on real GPU hardware that floor collapses and the marker overhead becomes a *larger*
share of frame time, not a smaller one. And batch-to-batch noise is ±8%, so only compare runs
captured in the same batch — after-numbers must be taken the same way, on the same machine, with
the same `jumpTo` reset.

---

## Architecture

```
┌─ App map components (MapWorld, GuessMap, StatsWorldMap, MapRouteOverlay, …) ─┐
│   speak ONLY the neutral vocabulary — no maplibre types                      │
├─ Map port — src/components/map/port.ts + react.tsx ─────────────────────────┤
│   MapView, useMap, Marker, Popup, DataLayer                                  │
│   MapCamera, MapProjection, LngLat/Bounds/PointFeature/LineFeature           │
├─ MapLibre adapter — src/components/map/adapters/maplibre/ ──────────────────┤
│   thin React binding over the GL lib (this replaces react-map-gl)            │
│   translates DataLayer → GL style-spec, camera/projection → GL calls         │
├─ GL engine — seam 1 ────────────────────────────────────────────────────────┤
│   maplibre-gl today; mapbox-gl is a one-file swap (same API family)          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Seam 1 — lib-parameterised engine

The adapter imports the GL library through exactly one module:

```typescript
// src/components/map/adapters/maplibre/engine.ts
export * as gl from "maplibre-gl";
export type { Map as GlMap, Marker as GlMarker } from "maplibre-gl";
```

`maplibre-gl` and `mapbox-gl-js` share an API, so swapping families is a one-file change. This is
free abstraction and worth taking.

### Seam 2 — the map port

App components never touch `maplibregl.*`, GL style-spec layer objects, or `map.project()`. After
Phase 2, MapLibre types appear only inside `adapters/maplibre/`. A lint rule (or an addition to
`components/platform/boundary.test.ts`, which already enforces import direction) should assert
that nothing outside the adapter imports `maplibre-gl`.

## The port interface

```typescript
// src/components/map/port.ts
export type LngLat = { lng: number; lat: number };
export type Bounds = [LngLat, LngLat]; // sw, ne
export type ScreenPoint = { x: number; y: number };

export interface MapCamera {
  getCenter(): LngLat;
  getZoom(): number;
  getBounds(): Bounds;
  flyTo(options: { center: LngLat; zoom?: number; speed?: number }): void;
  fitBounds(
    bounds: Bounds,
    options?: { padding?: number; maxZoom?: number; animate?: boolean },
  ): void;
}

export interface MapProjection {
  project(at: LngLat): ScreenPoint;
  unproject(at: ScreenPoint): LngLat;
}

export interface MapInstance extends MapCamera, MapProjection {
  /** Returns an unsubscribe function. */
  on(event: MapEventName, listener: (event: MapEvent) => void): () => void;
  getContainer(): HTMLElement;
}

/** Neutral data descriptions — deliberately not GL style-spec. */
export type PointFeature = { id: string; at: LngLat; color?: string; radius?: number };
export type LineFeature = { id: string; path: LngLat[]; color: string; width: number };
```

```tsx
// src/components/map/react.tsx — what the app imports
export function MapView(props: {
  styleUrl: string;
  initialView?: { center?: LngLat; zoom?: number };
  onLoad?: (map: MapInstance) => void;
  onMoveEnd?: (view: { center: LngLat; zoom: number }) => void;
  onClick?: (event: { at: LngLat; originalEvent: MouseEvent }) => void;
  onContextMenu?: (event: { at: LngLat; originalEvent: MouseEvent }) => void;
  children?: React.ReactNode;
}): JSX.Element;

export function useMap(): MapInstance | undefined;
export function Marker(props: { at: LngLat; anchor?: Anchor; children: React.ReactNode }): JSX.Element;
export function Popup(props: { at: LngLat; children: React.ReactNode }): JSX.Element;
export function DataLayer(props: {
  id: string;
  points?: PointFeature[];
  lines?: LineFeature[];
  cluster?: boolean;
}): JSX.Element;
```

`DataLayer` is the pivotal primitive. In the MapLibre adapter it becomes a GeoJSON source plus a
circle/symbol/line layer — all points drawn on the GPU in one pass. That is simultaneously the
provider-neutral way to describe bulk data *and* the fix for the DOM-marker bottleneck.

`Marker` stays for the small, rich case: individual DOM markers with lazy-loaded photo
thumbnails, which a GPU layer cannot express.

## Component migration map

| File | Uses today | Migrates to |
| --- | --- | --- |
| `components/MapWorld.tsx` | `<Map>` + all event props | `<MapView>` + neutral events |
| `components/MapPhotoMarkers.tsx` | one `<Marker>` per photo | `<DataLayer points>` for the overview; `<Marker>` only for the zoomed-in image set |
| `components/MapRouteOverlay.tsx` | `map.project()` | `useMap().project()` |
| `components/MapWorldMapChildren.tsx` | `useMap().current.{flyTo,fitBounds,getBounds}` | `MapCamera` |
| `components/MapContextMenu.tsx`, `components/MapPhotoPopup.tsx` | `<Popup>` | neutral `<Popup>` |
| `components/StatsWorldMap.tsx` | raw `<Source>`/`<Layer>` GL specs | `<DataLayer points cluster>` |
| `components/guess/GuessMap.tsx` | `<Marker>`, `<Source>`/`<Layer>` | `<Marker>` + `<DataLayer lines>` |
| `components/MapDirector.tsx` | `useMap` + imperative camera | `MapCamera` |
| `components/Map.tsx` | `useMap`, camera | `MapCamera` |

---

## Phase 1: MapLibre adapter replaces react-map-gl

Build the adapter as a drop-in for the exact `react-map-gl` surface listed above, so consumer
diffs are import-path changes only. No behaviour change, no port yet.

### `src/components/map/adapters/maplibre/` (new)

- `engine.ts` — seam 1, the single GL import.
- `MapView.tsx` — constructs `new gl.Map({ container, style, attributionControl, center, zoom })`
  from `initialViewState`; translates GL events into the callback shapes already in use
  (`viewState` derived from `getCenter()`/`getZoom()`; pass through `lngLat`, `originalEvent`,
  `target`); publishes the map on a React context; renders `children` only after `load` so
  source/layer/marker children never touch an unready map; `ResizeObserver`; `map.remove()` on
  unmount; a StrictMode double-mount guard; an SSR guard (`typeof window`).
- `useMapInstance.ts` — context hook. Returns `{ current: map }` in Phase 1 to match today's
  call sites; Phase 2 narrows it to the neutral `MapInstance`.
- `Marker.tsx` — `new gl.Marker({ element, anchor, offset }).setLngLat(...).addTo(map)`; updates
  position on prop change; removes on unmount; children rendered into the marker element with
  `createPortal`.
- `Source.tsx` / `Layer.tsx` — `addSource`/`setData`/`removeSource` and
  `addLayer`/`setPaintProperty`/`setLayoutProperty`/`removeLayer`.
- `Popup.tsx` — `new gl.Popup().setLngLat(...).setDOMContent(portalTarget).addTo(map)`.
- `index.ts` — barrel re-exporting under the same names `react-map-gl/maplibre` used.

### Migration

Swap the ten imports from `react-map-gl/maplibre` to the new barrel. `MapRef` becomes
`maplibregl.Map` (every method we call — `project`, `flyTo`, `fitBounds`, `getBounds`,
`getContainer`, `getCanvas` — is native). Then `npm rm react-map-gl`.

### Tests

- Retarget the eleven `jest.mock("react-map-gl/maplibre", …)` call sites to the new module.
  Export names are unchanged, so the mocks themselves barely move. jsdom still has no WebGL, so
  mocking remains the right approach at the unit layer.
- New unit tests for adapter lifecycle: marker add/update/remove, source data updates, layer
  paint updates, popup mount/unmount, context propagation.
- Run the full Playwright map suite (world map, guess map, stats map, route overlay, markers,
  context menu) — this is the real safety net for event-shape fidelity.

**Ships:** `react-map-gl` gone, bundle reduced, MapLibre 6 unblocked (we now own the camera/event
translation). The app is still MapLibre-flavoured internally — that is Phase 2.

---

## Phase 2: Map port and the GPU marker layer

Open with the profiling trace described in *Performance evidence*.

### `src/components/map/port.ts`, `src/components/map/react.tsx` (new)

The interfaces above. `react.tsx` re-exports the adapter's implementation; app code imports only
from here.

### Migration order (smallest blast radius first)

1. **Camera and projection.** `MapWorldMapChildren` (`MapAutoFit`, `MapFitOnRequest`,
   `MapBoundsTracker`), `MapDirector`, `Map.tsx`, `MapRouteOverlay`. Mechanical: `useMap().current.flyTo`
   → `useMap().flyTo`, `map.project()` → the neutral projection. Small and well covered by
   existing tests.
2. **`DataLayer` for the declarative layers.** `StatsWorldMap` (clustered points) and `GuessMap`
   (guess→reveal line) move off raw GL specs. Validating `DataLayer` against these two first
   proves the neutral styling covers clustering and data-driven colour before the photo markers
   depend on it.
3. **`DataLayer` for overview photo markers.** `MapPhotoMarkers` renders bulk points through
   `DataLayer` (data-driven recency colour), keeping DOM `<Marker>` only when
   `showMarkerImages`/`previewMarkers` is on and the bounds-filtered set is small. This is the
   performance change.

### Tests

- A **port contract test** every adapter must pass (camera round-trips, projection round-trips,
  event subscribe/unsubscribe, data layer add/update/remove).
- Existing unit tests updated to the neutral API.
- Playwright: re-run the map suite; add a **marker performance trace** (frame time during a
  world-zoom pan) as the gate, with the Phase 2 opening numbers as the baseline.
- A boundary assertion that nothing outside `adapters/maplibre/` imports `maplibre-gl`.

**Ships:** MapLibre confined to the adapter, and the marker performance win with before/after
numbers.

---

## Outcome: MapLibre 6 (the reason Phase 1 existed)

Shipped. `maplibre-gl` is on 6.0.0, and every change needed to get there was confined to
`adapters/maplibre/` — the port and all consumers were untouched, which is the seam doing exactly
what it was built for. The failure that blocked v6 under `react-map-gl` (its `_onCameraEvent`
reading `.center` off a reshaped payload) never reproduced, because the adapter synthesises camera
state from `getCenter()`/`getZoom()`/`getBearing()`/`getPitch()` instead of trusting event shapes.

Three things broke, only one of them interesting:

- `{set,get}{Layout,Paint}Property` became keyed lookups; the adapter reads specs structurally, so
  it needed one cast boundary.
- `GeoJSONSource.setData` is async now and no longer returns the source.
- **The real one, and it was silent.** v6 is ESM-only and resolves its tile worker from
  `import.meta.url` inside its own bundle. Turbopack's production output does not keep that as an
  `http(s)` URL, so the resolver returned `""` — and `new Worker("")` is not an error, it resolves
  against the document. The map loaded *the page itself* as its worker. The worker died parsing
  HTML, zero tiles were requested, `load` never fired, `readyMap` stayed null, and no markers,
  layers or popups ever mounted. Nothing threw; it never even reached the error boundary. Fixed by
  vendoring the worker (`adapters/maplibre/worker.ts` calling `setWorkerUrl`, and
  `bin/prepare-maplibre-vendor.cjs` copying the worker plus `maplibre-gl-shared.mjs` into
  `public/vendor/`).

### The testing gap this exposed

**Typecheck, the 1880 unit tests, and the entire map e2e suite all passed while the map rendered
nothing.** The map specs stub the style to `{ version: 8, sources: {}, layers: [] }` — with no
sources there are no tiles to wait for, so `load` fires whether or not the tile worker works. The
only test that caught it was the slideshow mini-map, which happens to use the real MapTiler style.

Any map spec that stubs its sources away can only prove the map *mounts*, never that it *renders*.
At least one map test must run against a style with real sources so a dead tile pipeline is fatal.

## Phase 3 (deferred): a second adapter

Not built now. Adding one — `mapbox-gl` is nearly free via seam 1; a non-GL provider is not —
is what would prove the port. Only justified by a concrete need; building it speculatively caps
the gallery at whatever the weakest provider supports.

---

## Risks

- **Event-shape fidelity.** The translation from GL events to our callbacks (`viewState`,
  `lngLat`, `originalEvent`, `target`) is the most subtle part of Phase 1. Playwright is the
  guard; unit mocks cannot catch it.
- **Children-after-load ordering** and React portals into GL-managed DOM (markers, popups).
- **StrictMode double-invoke**, cleanup correctness, `ResizeObserver`, and the
  `attributionControl` compact collapse currently done in `MapWorld`'s `onLoad`.
- **Implicit setup** `react-map-gl` may perform (worker URL wiring, RTL text plugin) that we
  would silently lose. Audit before deleting the dependency.
- **`DataLayer` expressiveness.** It must cover data-driven recency colour and clustering without
  leaking GL style-spec back into callers. Validating against `StatsWorldMap`/`GuessMap` first
  (step 2 before step 3) is the mitigation.
- **We own the binding now.** That is the point — it is what makes MapLibre 6 tractable — but it
  is a real, permanent maintenance commitment.

## Effort

| Phase | Estimate |
| --- | --- |
| 1 — adapter + swap + mocks + e2e | 1–2 focused sessions |
| 2 — port + component migration + perf trace | ~2 sessions |
| 3 — second adapter | deferred |

Uncontrolled-only usage is what keeps Phase 1 small. `DataLayer` doing double duty — the
abstraction seam *and* the performance fix — is what keeps Phase 2 worth it.

## Open questions

- Does `DataLayer`'s neutral styling need to express symbol/icon layers (photo thumbnails on the
  GPU), or is DOM `<Marker>` sufficient for every case where images are shown?
- Should the port live under `src/components/map/` or join the existing renderer-port pattern in
  `src/components/platform/`? The map is browser-only and not renderer-specific, which argues for
  the former.
- Is MapLibre 6 worth taking immediately once Phase 1 lands, or should it wait for a
  `react-map-gl`-independent soak period?

[#7800]: https://github.com/maplibre/maplibre-gl-js/pull/7800
[#7789]: https://github.com/maplibre/maplibre-gl-js/pull/7789
