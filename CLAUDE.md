# CLAUDE.md

Personal photo gallery — Next.js 14, TypeScript, CSS Modules, MapLibre GL. Photos are static-site-generated from album directories.

## Commands
- **Tests:** `npx jest` from `src/` — see `.claude/rules/testing.md`
- **Dev:** `npm run dev` from `src/`
- **Lint/typecheck:** `npm run lint` from `src/`

## Structure
- `src/components/` — React components, each with co-located `.module.css` and `.test.tsx`
- `src/pages/` — Next.js pages (`/map`, `/search`, `/stats`, `/timeline`, `/slideshow`)
- `src/util/` — pure utility functions (no React)
- `src/components/search/` — search page, SQLite API layer, facet panel, result tiles
- `src/components/mapRoute.ts` — all route/journey logic

## Detail rules
- `.claude/rules/conventions.md` — British English, CSS Modules, class joining
- `.claude/rules/testing.md` — TDD, commands, test pyramid
- `.claude/rules/map.md` — MapLibre, MMap, route overlay patterns
- `.claude/rules/search.md` — SQLite, colour filter, bind-parameter limits
