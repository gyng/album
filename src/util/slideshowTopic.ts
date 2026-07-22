import { RandomPhotoRow } from "../components/search/api";
import { SlideshowMode } from "./slideshowUrl";

// Pure decision core for topical slideshow seeding. A topic is a free-text
// query the user types (e.g. "cat"): the screen encodes it with the SigLIP v1
// text tower and ranks the library semantically, then feeds the ranked paths
// here. This module reconciles those results against the in-memory photo pool
// and decides how to seed the existing similar-mode flow — the async encode /
// fetch and all ref/state mutations stay in the component, mirroring
// slideshowRemix.ts. The topic seeds the flow; the existing image-similarity
// drift takes over from the best match.

// The pre-topic state a dismiss must restore exactly.
export type TopicSnapshot = {
  mode: SlideshowMode;
  filter: string | undefined;
};

// Collapse a raw topic input to a trimmed string, or null when blank.
export const normaliseTopic = (raw: string): string | null => {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Map ranked semantic results onto the in-memory pool, preserving ranked
// (best-first) order and respecting the active album filter — the same
// pool/filter intersection the similar path applies. Returns the pool's own row
// objects so colours/exif/geocode carry through, de-duplicated by path.
export const mapTopicSeedResults = (input: {
  resultData: ReadonlyArray<{ path: string }>;
  pool: RandomPhotoRow[];
  filter?: string;
}): RandomPhotoRow[] => {
  const byPath = new Map(input.pool.map((photo) => [photo.path, photo]));
  const seen = new Set<string>();
  const seeded: RandomPhotoRow[] = [];

  for (const item of input.resultData) {
    if (seen.has(item.path)) {
      continue;
    }
    if (input.filter && !item.path.startsWith(`../albums/${input.filter}/`)) {
      continue;
    }
    const match = byPath.get(item.path);
    if (match) {
      seen.add(item.path);
      seeded.push(match);
    }
  }

  return seeded;
};

export type TopicSeedPlan =
  | { kind: "empty" }
  | {
      kind: "seed";
      seed: RandomPhotoRow;
      queue: RandomPhotoRow[];
      snapshot: TopicSnapshot;
    };

// Decide how to seed topic mode from ranked results. Returns "empty" when
// nothing in the pool matches (the caller keeps the previous mode and surfaces
// an error), otherwise the best match to commit as the current slide, the
// remaining ranked rows as the initial similar queue, and the snapshot a later
// dismiss restores. `previousMode` is passed as a value — the caller preserves
// the ORIGINAL snapshot across a re-seed so restore always returns to the
// pre-topic mode, never to "similar".
export const decideTopicSeed = (input: {
  resultData: ReadonlyArray<{ path: string }>;
  pool: RandomPhotoRow[];
  previousMode: SlideshowMode;
  filter?: string;
}): TopicSeedPlan => {
  const seeded = mapTopicSeedResults({
    resultData: input.resultData,
    pool: input.pool,
    filter: input.filter,
  });

  if (seeded.length === 0) {
    return { kind: "empty" };
  }

  const [seed, ...queue] = seeded;
  return {
    kind: "seed",
    seed,
    queue,
    snapshot: { mode: input.previousMode, filter: input.filter },
  };
};
