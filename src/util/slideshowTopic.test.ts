import { RandomPhotoRow } from "../components/search/api";
import {
  isDeferredTopicStale,
  advanceUserNavCount,
  clampTopicProgress,
  decideTopicSeed,
  isSeedCurrent,
  isTopicActive,
  isTopicSeedStale,
  mapTopicSeedResults,
  normaliseTopic,
  shouldAbortPendingTopicOnEmbeddingsError,
  shouldEnableTopicEmbeddings,
} from "./slideshowTopic";

const row = (path: string): RandomPhotoRow => ({
  path,
  exif: `exif:${path}`,
  geocode: `geo:${path}`,
  colors: `colors:${path}`,
});

describe("normaliseTopic", () => {
  it("trims surrounding whitespace", () => {
    expect(normaliseTopic("  cat ")).toBe("cat");
  });

  it("collapses blank input to null", () => {
    expect(normaliseTopic("")).toBeNull();
    expect(normaliseTopic("   ")).toBeNull();
  });
});

describe("mapTopicSeedResults", () => {
  const pool = [row("../albums/a/1.jpg"), row("../albums/a/2.jpg"), row("../albums/b/3.jpg")];

  it("returns pool rows in ranked (best-first) order, carrying colours/exif through", () => {
    const seeded = mapTopicSeedResults({
      resultData: [{ path: "../albums/b/3.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
    });
    expect(seeded.map((r) => r.path)).toEqual(["../albums/b/3.jpg", "../albums/a/1.jpg"]);
    // The pool's own row object is reused so its colours survive the round-trip.
    expect(seeded[0]).toBe(pool[2]);
    expect(seeded[0].colors).toBe("colors:../albums/b/3.jpg");
  });

  it("drops results that are not present in the current pool", () => {
    const seeded = mapTopicSeedResults({
      resultData: [{ path: "../albums/missing/9.jpg" }, { path: "../albums/a/2.jpg" }],
      pool,
    });
    expect(seeded.map((r) => r.path)).toEqual(["../albums/a/2.jpg"]);
  });

  it("respects the active album filter, the same intersection the similar path applies", () => {
    const seeded = mapTopicSeedResults({
      resultData: [{ path: "../albums/b/3.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
      filter: "a",
    });
    expect(seeded.map((r) => r.path)).toEqual(["../albums/a/1.jpg"]);
  });

  it("de-duplicates repeated result paths", () => {
    const seeded = mapTopicSeedResults({
      resultData: [{ path: "../albums/a/1.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
    });
    expect(seeded.map((r) => r.path)).toEqual(["../albums/a/1.jpg"]);
  });
});

describe("decideTopicSeed", () => {
  const pool = [row("../albums/a/1.jpg"), row("../albums/a/2.jpg")];

  it("reports empty when nothing in the pool matches the ranked results", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/missing/9.jpg" }],
      pool,
      previousMode: "weighted",
    });
    expect(plan.kind).toBe("empty");
  });

  it("seeds from the best match and commits it by default", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/a/2.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
      previousMode: "weighted",
      filter: "a",
    });
    expect(plan.kind).toBe("seed");
    if (plan.kind !== "seed") return;
    expect(plan.seed.path).toBe("../albums/a/2.jpg");
    expect(plan.commit).toBe(true);
    // The snapshot restores only the pre-topic mode; the filter is never
    // captured (topic seeding does not touch the filter).
    expect(plan.snapshot).toEqual({ mode: "weighted" });
  });

  it("activates the topic without committing when a photo permalink is preserved", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/a/2.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
      previousMode: "weighted",
      preserveCurrentPhoto: true,
    });
    if (plan.kind !== "seed") throw new Error("expected seed");
    // The topic still activates (best match + snapshot resolved) but the
    // caller must not commit it — the flow keeps drifting from the pinned photo.
    expect(plan.seed.path).toBe("../albums/a/2.jpg");
    expect(plan.commit).toBe(false);
  });

  it("captures the pre-topic mode in the restore snapshot", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/a/1.jpg" }],
      pool,
      previousMode: "random",
    });
    if (plan.kind !== "seed") throw new Error("expected seed");
    expect(plan.snapshot).toEqual({ mode: "random" });
  });
});

describe("shouldEnableTopicEmbeddings", () => {
  const base = {
    mode: "weighted" as const,
    remixEnabled: false,
    activeTopic: null,
    topicPending: false,
    initialTopicPending: false,
  };

  it("stays disabled when nothing needs embeddings", () => {
    expect(shouldEnableTopicEmbeddings(base)).toBe(false);
  });

  it("enables for similar mode or remixes (the existing triggers)", () => {
    expect(shouldEnableTopicEmbeddings({ ...base, mode: "similar" })).toBe(true);
    expect(shouldEnableTopicEmbeddings({ ...base, remixEnabled: true })).toBe(true);
  });

  it("enables for an active, pending, or URL-requested topic", () => {
    expect(shouldEnableTopicEmbeddings({ ...base, activeTopic: "cat" })).toBe(true);
    expect(shouldEnableTopicEmbeddings({ ...base, topicPending: true })).toBe(true);
    expect(shouldEnableTopicEmbeddings({ ...base, initialTopicPending: true })).toBe(true);
  });
});

describe("isTopicSeedStale", () => {
  const fresh = {
    seedToken: 1,
    currentToken: 1,
    modeAtSubmit: "weighted" as const,
    currentMode: "weighted" as const,
    userNavAtSubmit: 3,
    currentUserNav: 3,
  };

  it("keeps a result whose token, mode, and user-navigation count are unchanged", () => {
    expect(isTopicSeedStale(fresh)).toBe(false);
  });

  it("abandons when a newer topic was submitted (token moved on)", () => {
    expect(isTopicSeedStale({ ...fresh, currentToken: 2 })).toBe(true);
  });

  it("abandons when the playback mode changed since submit", () => {
    expect(isTopicSeedStale({ ...fresh, currentMode: "random" })).toBe(true);
  });

  it("abandons when the user navigated since submit", () => {
    expect(isTopicSeedStale({ ...fresh, currentUserNav: 4 })).toBe(true);
  });
});

describe("advanceUserNavCount", () => {
  const fresh = {
    seedToken: 1,
    currentToken: 1,
    modeAtSubmit: "weighted" as const,
    currentMode: "weighted" as const,
  };

  it("does NOT advance for an app-driven slide change (cadence timer / pool reload)", () => {
    expect(advanceUserNavCount(5, "app")).toBe(5);
  });

  it("advances for a user-initiated navigation", () => {
    expect(advanceUserNavCount(5, "user")).toBe(6);
  });

  it("keeps a topic seed fresh across a timer-style advance, but stales it on a user advance", () => {
    const userNavAtSubmit = 5;
    // A cadence-timer advance is app-driven: the counter does not move, so a
    // topic the user just typed survives the automatic slide change.
    const afterTimer = advanceUserNavCount(userNavAtSubmit, "app");
    expect(isTopicSeedStale({ ...fresh, userNavAtSubmit, currentUserNav: afterTimer })).toBe(false);
    // A manual advance is user intent: it supersedes the in-flight seed.
    const afterUser = advanceUserNavCount(userNavAtSubmit, "user");
    expect(isTopicSeedStale({ ...fresh, userNavAtSubmit, currentUserNav: afterUser })).toBe(true);
  });
});

describe("isSeedCurrent", () => {
  it("is current only while the token has not moved on", () => {
    expect(isSeedCurrent(3, 3)).toBe(true);
    expect(isSeedCurrent(3, 4)).toBe(false);
  });
});

describe("clampTopicProgress", () => {
  it("never returns a value below the floor already shown", () => {
    expect(clampTopicProgress(40, 55)).toBe(55);
    expect(clampTopicProgress(60, 42)).toBe(60);
  });
});

describe("isTopicActive", () => {
  const base = {
    topic: null,
    topicBusy: false,
    hasDeferredTopic: false,
    hasUnconsumedInitialTopic: false,
  };

  it("is inactive when no topic is showing, pending, deferred, or URL-seeded", () => {
    expect(isTopicActive(base)).toBe(false);
  });

  it("is active for a showing chip, an in-flight encode, a deferred topic, or an unconsumed URL seed", () => {
    expect(isTopicActive({ ...base, topic: "cat" })).toBe(true);
    expect(isTopicActive({ ...base, topicBusy: true })).toBe(true);
    expect(isTopicActive({ ...base, hasDeferredTopic: true })).toBe(true);
    expect(isTopicActive({ ...base, hasUnconsumedInitialTopic: true })).toBe(true);
  });
});

describe("shouldAbortPendingTopicOnEmbeddingsError", () => {
  const base = {
    hasEmbeddingsError: false,
    topicAwaitingEmbeddings: false,
    hasDeferredTopic: false,
    hasPendingInitialTopic: false,
  };

  it("does nothing without an embeddings error", () => {
    expect(
      shouldAbortPendingTopicOnEmbeddingsError({ ...base, topicAwaitingEmbeddings: true }),
    ).toBe(false);
  });

  it("does nothing when nothing is waiting on the embeddings DB", () => {
    expect(shouldAbortPendingTopicOnEmbeddingsError({ ...base, hasEmbeddingsError: true })).toBe(
      false,
    );
  });

  it("aborts when a wait, a deferred topic, or an initial URL seed is stuck behind the failed load", () => {
    expect(
      shouldAbortPendingTopicOnEmbeddingsError({
        ...base,
        hasEmbeddingsError: true,
        topicAwaitingEmbeddings: true,
      }),
    ).toBe(true);
    expect(
      shouldAbortPendingTopicOnEmbeddingsError({
        ...base,
        hasEmbeddingsError: true,
        hasDeferredTopic: true,
      }),
    ).toBe(true);
    expect(
      shouldAbortPendingTopicOnEmbeddingsError({
        ...base,
        hasEmbeddingsError: true,
        hasPendingInitialTopic: true,
      }),
    ).toBe(true);
  });
});

describe("isDeferredTopicStale", () => {
  it("stales a deferred topic when the mode changed while it waited (cross-tab flip)", () => {
    expect(isDeferredTopicStale({ modeAtDefer: "weighted", currentMode: "random" })).toBe(true);
  });

  it("keeps a deferred topic fresh while the mode it deferred under still holds", () => {
    expect(isDeferredTopicStale({ modeAtDefer: "weighted", currentMode: "weighted" })).toBe(false);
  });
});
