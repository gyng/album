---
description: Rules for MapWorld and map-related components
globs: ["src/components/MapWorld*", "src/components/mapRoute*", "src/pages/map/**"]
---

- MapLibre via `react-map-gl/maplibre`
- `MMap` is the main component; `MapWorldDeferred` is the lazy-loaded wrapper used by pages
- Route overlay is SVG (screen-space), not a MapLibre layer — projected via `map.project()`
- Omit MapLibre paint properties entirely (spread `{}`) instead of setting to `undefined` — MapLibre rejects `undefined` values and throws
- `useMap()` only works inside children of `<MapLibreMap>` — use small child components for map imperative calls (see `MapAutoFit` as the pattern)
- `mapRoute.ts` owns all route/journey logic: `RoutePoint`, `buildMapRoute`, `splitRouteByDay`, etc.
