import { RandomPhotoRow } from "../components/search/api";
import {
  decideModeSelection,
  decideTopicSeed,
  isTopicSeedStale,
  mapTopicSeedResults,
  normaliseTopic,
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
    commitCountAtSubmit: 3,
    currentCommitCount: 3,
  };

  it("keeps a result whose token, mode, and commit count are unchanged", () => {
    expect(isTopicSeedStale(fresh)).toBe(false);
  });

  it("abandons when a newer topic was submitted (token moved on)", () => {
    expect(isTopicSeedStale({ ...fresh, currentToken: 2 })).toBe(true);
  });

  it("abandons when the playback mode changed since submit", () => {
    expect(isTopicSeedStale({ ...fresh, currentMode: "random" })).toBe(true);
  });

  it("abandons when a photo was committed since submit", () => {
    expect(isTopicSeedStale({ ...fresh, currentCommitCount: 4 })).toBe(true);
  });
});

describe("decideModeSelection", () => {
  it("implicitly dismisses an active topic and clears its URL param", () => {
    expect(decideModeSelection({ topicActive: true })).toEqual({
      dismissTopic: true,
      clearTopicParam: true,
    });
  });

  it("leaves an ordinary mode change untouched when no topic is active", () => {
    expect(decideModeSelection({ topicActive: false })).toEqual({
      dismissTopic: false,
      clearTopicParam: false,
    });
  });
});
