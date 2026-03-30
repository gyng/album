# AGENTS.md

Personal photo gallery — Next.js 14, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories.

## Commands
- **Tests:** `npx jest` from `src/` (not the repo root)
- Subset: `npx jest --testPathPatterns="MapWorld"` (plural flag)
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/`

## Structure
- `src/components/` — React components, each with co-located `.module.css` and `.test.tsx`
- `src/pages/` — Next.js pages (`/map`, `/search`, `/stats`, `/timeline`, `/slideshow`)
- `src/util/` — pure utility functions (no React)
- `src/components/search/` — search page, SQLite API layer, facet panel, result tiles
- `src/components/mapRoute.ts` — all route/journey logic

## Conventions
- **British English** in all user-facing copy and comments: colour, centre, favourite, licence
- CSS Modules only — no inline styles except for dynamic values (colours, widths from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`

## Testing
- Run tests after every refactor before committing
- Red-green TDD — write the failing test first
- Prefer unit > integration > e2e
- No perf changes without profiling evidence first

## Map
- MapLibre via `react-map-gl/maplibre`; `MMap` is the main component
- Omit MapLibre paint properties entirely (spread `{}`) instead of passing `undefined` — MapLibre throws on undefined values
- `useMap()` only works inside children of `<MapLibreMap>` — use small child components for imperative map calls
- Route overlay is SVG (screen-space), projected via `map.project()`

## Search
- SQLite runs in-browser via sql.js (WASM)
- Colour-matched paths capped at 900 before building SQL `IN` clause (SQLite bind-parameter limit)
- Colour filter composes with text search and facets — not a separate mode
