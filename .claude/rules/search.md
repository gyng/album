---
description: Rules for the search page and SQLite API layer
globs: ["src/components/search/**"]
---

- SQLite runs in-browser via sql.js (WASM)
- `fetchColorSimilarResults` does a full JS-side LAB deltaE scan over all images — colour-matched paths are capped at 900 before building the SQL `IN` clause (SQLite bind-parameter limit is 999)
- Colour filter is composable with text search and facets — it is not a separate mode
- `fetchResults` pre-filters by colour in JS, then passes matching paths as an `IN` clause to SQL for text/facet filtering
