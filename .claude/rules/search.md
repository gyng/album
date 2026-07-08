---
description: Rules for the search page and SQLite API layer
globs: ["src/components/search/**"]
---

- SQLite runs in-browser via sql.js (WASM)
- `fetchColorSimilarResults` does a full JS-side LAB deltaE scan over all images — colour-matched paths are capped at 900 before building the SQL `IN` clause (SQLite bind-parameter limit is 999)
- Colour filter is composable with text search and facets — it is not a separate mode
- `fetchResults` pre-filters by colour in JS, then passes matching paths as an `IN` clause to SQL for text/facet filtering
- Image/sketch search: `useImageQuery` encodes an uploaded file or `SearchDrawPad` canvas via the SigLIP v1 vision tower (q4), then reuses `fetchSemanticResults` with the image vector — the query vector must stay in the v1 space, and the query is session-ephemeral (no URL state)
- Text and image encoders share ONE worker entry (`embedding.worker.ts` via `embeddingWorkerClient.ts`) — two near-identical sibling worker files made Turbopack cross-wire the worker bindings in the production build; do not split them again
