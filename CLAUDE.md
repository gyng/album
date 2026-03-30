# CLAUDE.md

## Project
Personal photo gallery — Next.js 14, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories.

## Commands
- **Tests:** `npx jest` from `src/` (not the repo root)
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/`
- Test a subset: `npx jest --testPathPatterns="MapWorld"` (note: plural `--testPathPatterns`)

## Conventions
- **British English** in all user-facing copy and comments: colour, centre, favourite, etc.
- CSS Modules only — no inline styles except for dynamic values (colours, widths from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional SVG/HTML attributes rather than setting them to `undefined` (MapLibre rejects `undefined` paint values)

## Testing
- Run tests after every refactor before committing
- Red-green TDD for new features and bug fixes
- Prefer unit > integration > e2e
- No perf changes without profiling evidence first

## Architecture
- `src/components/` — shared React components, each with a co-located `.module.css` and `.test.tsx`
- `src/pages/` — Next.js pages; map at `/map`, search at `/search`, stats at `/stats`
- `src/util/` — pure utility functions (no React)
- `src/components/mapRoute.ts` — all route/journey logic (RoutePoint, buildMapRoute, etc.)
- `src/components/search/` — search page, API layer, facet panel, result tiles

## Map (MapWorld)
- MapLibre via `@vis.gl/react-maplibre`
- `MMap` is the main component; `MapWorldDeferred` is the lazy-loaded wrapper used by pages
- Route overlay is SVG (screen-space), not a MapLibre layer — projected via `map.project()`
- Omit MapLibre paint properties entirely (spread `{}`) instead of setting to `undefined`
- `useMap()` only works inside children of `<MapLibreMap>` — use small child components for map imperative calls

## Search
- SQLite in-browser via sql.js (WASM)
- `fetchColorSimilarResults` does a full JS-side LAB deltaE scan — color-matched paths capped at 900 before building SQL `IN` clause (SQLite bind limit)
- Color filter is composable with text search and facets, not a separate mode
