import { RandomPhotoRow } from "../components/search/api";
import { RemixStrategy, VECTOR_REMIX_STRATEGIES } from "./slideshowAmbient";

// Pure decision cores for the slideshow's remix slides. The async embeddings
// fetch, the stale guard and all setState / history-entry patching stay in the
// component; these encode the branching and the result→pool mapping so they
// are unit-tested independently of React.

export type RemixPlan =
  | { kind: "none" }
  | {
      kind: "vector";
      strategy: RemixStrategy;
      count: number;
      isAntiSimilar: boolean;
    }
  | { kind: "sync"; strategy: RemixStrategy; count: number };

// Decide whether (and how) the next advance should be a remix. `forced` is
// passed as a VALUE — the caller owns clearing its one-shot forceRemix ref;
// this function must stay pure. The rollers are injected for determinism in
// tests (they default, in the component, to the slideshowAmbient ones).
export const decideRemixPlan = (input: {
  allowRemix: boolean;
  forced: boolean;
  remixEnabled: boolean;
  vectorReady: boolean;
  probability: number;
  rollLayoutCount: () => number;
  decideCount: (probability: number) => number;
  rollStrategy: () => RemixStrategy;
}): RemixPlan => {
  if (!input.allowRemix || !(input.forced || input.remixEnabled)) {
    return { kind: "none" };
  }

  // Forced ("Remix now" / drag-up) bypasses the remix-vs-no-remix dice but
  // shares the same layout-size distribution as organic remixes.
  const count = input.forced
    ? input.rollLayoutCount()
    : input.decideCount(input.probability);
  if (count <= 0) {
    return { kind: "none" };
  }

  const strategy = input.rollStrategy();

  // A SigLIP-backed strategy resolves via the async embeddings fetch — but
  // only when embeddings are ready; otherwise fall through to the sync filter
  // chain (which ignores the vector strategy and walks to the best available).
  if (VECTOR_REMIX_STRATEGIES.has(strategy) && input.vectorReady) {
    return {
      kind: "vector",
      strategy,
      count,
      isAntiSimilar: strategy === "juxtapose",
    };
  }

  return { kind: "sync", strategy, count };
};

// Reconcile a similar-results page against the in-memory pool: take the first
// `desiredCount` results that exist in the pool (preserving result order), and
// capture the top candidate's similarity for the "% match" badge. The score
// comes from data[0] (the top match), NOT the first pool-matched row — the two
// differ when the top result isn't in the current pool.
export const mapVectorRemixResult = (input: {
  resultData: ReadonlyArray<{ path: string; similarity?: number | null }>;
  pool: RandomPhotoRow[];
  desiredCount: number;
}): { companions: RandomPhotoRow[]; topSimilarity: number | null } => {
  const companions: RandomPhotoRow[] = [];
  for (const item of input.resultData) {
    if (companions.length >= input.desiredCount) {
      break;
    }
    const match = input.pool.find((photo) => photo.path === item.path);
    if (match) {
      companions.push(match);
    }
  }

  return {
    companions,
    topSimilarity: input.resultData[0]?.similarity ?? null,
  };
};
