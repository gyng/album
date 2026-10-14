# Explore cloud

The cloud groups topics in the full image embedding space. Its build-time
projection, contact sheet and payload are described in `AGENTS.md`; visual rules
live in [the design system](design-system.md#explore).

## Views and filters

Similar photos uses a cached three-dimensional UMAP layout; Overview retains the
principal-component view. Year/lens filters keep original indices and cloud
positions; the sheet packs the matching photographs in chronological order.
Scene search loads its model and embedding database only on submission and
selects up to 40 closest matches after applying those filters.

## UMAP layout

Prepare the optional layout with
`uv run --no-project --with umap-learn==0.5.12 src/bin/prepare-umap.py`.
It reads existing embeddings, performs no model inference and writes a generated
cache. Builds check its model and database SHA-256 and use Overview when it is
absent or stale.

The archive comparison used 1,518 SigLIP2 vectors, three output dimensions,
cosine distance, 15 neighbours, minimum distance 0.15 and seed 42. UMAP retained
40.4% of the original ten nearest neighbours, versus 13.3% for the stretched PCA
view; trustworthiness was 0.939 versus 0.824. These are local-neighbourhood
measures, not evidence that every visible distance is exact.

## Wander

The section after the cloud walks the archive one photograph at a time
(`components/explore/ExploreWander.tsx`, logic in `util/wander.ts`). The build
computes twelve neighbours per photograph in the full space: the first three
stay `near` (the drawn web), the other nine ship as `around`. Exits come from
both: the closest always leads, and each other exit must bring something the
others do not — a tag the current photograph lacks, or a named colour shift
(lighter/darker, warmer/cooler, more colourful/quieter, 0.15 in the swatch's
HSL terms). Never place or date. Unwalked photographs are preferred.

The walk is drawn through the cloud (its `trail` prop), and the URL carries
`wander=<indexed path>` once the reader takes a step, so a photo page links in
with "Wander from here". Both read one shared payload request
(`fetchEmbeddingSpaceOnce`). The optional quest is two tags that each appear
on at least eight photographs but together on at most five.
