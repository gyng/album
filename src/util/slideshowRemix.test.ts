import { decideRemixPlan, mapVectorRemixResult, toSimilarQueueRows } from "./slideshowRemix";
import type { RandomPhotoRow } from "../components/search/api";

const base = {
  vectorReady: true,
  probability: 0.05,
  rollLayoutCount: () => 2,
  decideCount: () => 1,
  rollStrategy: () => "similar" as const,
};

describe("decideRemixPlan", () => {
  it("returns none when remix isn't allowed on this advance", () => {
    expect(
      decideRemixPlan({ ...base, allowRemix: false, forced: false, remixEnabled: true }),
    ).toEqual({ kind: "none" });
  });

  it("returns none when neither forced nor remix-enabled", () => {
    expect(
      decideRemixPlan({ ...base, allowRemix: true, forced: false, remixEnabled: false }),
    ).toEqual({ kind: "none" });
  });

  it("forced bypasses the dice — uses rollLayoutCount, never decideCount", () => {
    const decideCount = jest.fn(() => 0); // would yield none if consulted
    const plan = decideRemixPlan({
      ...base,
      allowRemix: true,
      forced: true,
      remixEnabled: false,
      decideCount,
      rollLayoutCount: () => 3,
      rollStrategy: () => "same-album",
    });
    expect(decideCount).not.toHaveBeenCalled();
    expect(plan).toEqual({ kind: "sync", strategy: "same-album", count: 3 });
  });

  it("forced + vector strategy: count comes from rollLayoutCount and it still routes vector", () => {
    // The two axes (forced-vs-organic count source, vector-vs-sync route) are
    // orthogonal: "Remix now" while the dice rolls a vector strategy with
    // embeddings ready must keep the forced count AND classify as vector.
    const decideCount = jest.fn(() => 0); // would yield none if consulted
    const plan = decideRemixPlan({
      ...base,
      allowRemix: true,
      forced: true,
      remixEnabled: false,
      vectorReady: true,
      decideCount,
      rollLayoutCount: () => 2,
      rollStrategy: () => "juxtapose",
    });
    expect(decideCount).not.toHaveBeenCalled();
    expect(plan).toEqual({
      kind: "vector",
      strategy: "juxtapose",
      count: 2,
      isAntiSimilar: true,
    });
  });

  it("organic count of 0 yields none", () => {
    expect(
      decideRemixPlan({
        ...base,
        allowRemix: true,
        forced: false,
        remixEnabled: true,
        decideCount: () => 0,
      }),
    ).toEqual({ kind: "none" });
  });

  it("routes a vector strategy to the vector path when embeddings are ready", () => {
    expect(
      decideRemixPlan({
        ...base,
        allowRemix: true,
        forced: false,
        remixEnabled: true,
        rollStrategy: () => "similar",
      }),
    ).toEqual({ kind: "vector", strategy: "similar", count: 1, isAntiSimilar: false });
  });

  it("flags juxtapose as anti-similar", () => {
    const plan = decideRemixPlan({
      ...base,
      allowRemix: true,
      forced: false,
      remixEnabled: true,
      rollStrategy: () => "juxtapose",
    });
    expect(plan).toEqual({
      kind: "vector",
      strategy: "juxtapose",
      count: 1,
      isAntiSimilar: true,
    });
  });

  it("falls back to the sync path when a vector strategy rolls but embeddings aren't ready", () => {
    expect(
      decideRemixPlan({
        ...base,
        allowRemix: true,
        forced: false,
        remixEnabled: true,
        vectorReady: false,
        rollStrategy: () => "similar",
      }),
    ).toEqual({ kind: "sync", strategy: "similar", count: 1 });
  });

  it("routes a non-vector strategy to the sync path", () => {
    expect(
      decideRemixPlan({
        ...base,
        allowRemix: true,
        forced: false,
        remixEnabled: true,
        rollStrategy: () => "same-year",
      }),
    ).toEqual({ kind: "sync", strategy: "same-year", count: 1 });
  });
});

describe("mapVectorRemixResult", () => {
  const row = (path: string): RandomPhotoRow => ({ path, exif: "", geocode: "" });
  const pool = [row("a"), row("b"), row("c"), row("d")];

  it("caps companions at desiredCount, preserving result order", () => {
    const out = mapVectorRemixResult({
      resultData: [
        { path: "c", similarity: 0.9 },
        { path: "a", similarity: 0.8 },
        { path: "b", similarity: 0.7 },
      ],
      pool,
      desiredCount: 2,
    });
    expect(out.companions.map((p) => p.path)).toEqual(["c", "a"]);
  });

  // A long clip is indexed a minute at a time, and its best match is often one
  // of those moments; the pool holds the clip itself, so the clip was dropped.
  it("brings a clip back from its matched moment, once", () => {
    const out = mapVectorRemixResult({
      resultData: [
        { path: "../albums/a/clip.mov@t120", similarity: 0.9 },
        { path: "../albums/a/clip.mov@t60", similarity: 0.8 },
        { path: "b", similarity: 0.7 },
      ],
      pool: [...pool, row("../albums/a/clip.mov")],
      desiredCount: 3,
    });
    expect(out.companions.map((p) => p.path)).toEqual(["../albums/a/clip.mov", "b"]);
  });

  it("skips result paths that aren't in the pool", () => {
    const out = mapVectorRemixResult({
      resultData: [
        { path: "zzz", similarity: 0.95 },
        { path: "b", similarity: 0.6 },
      ],
      pool,
      desiredCount: 3,
    });
    expect(out.companions.map((p) => p.path)).toEqual(["b"]);
  });

  it("takes topSimilarity from data[0], even when that item is skipped from companions", () => {
    const out = mapVectorRemixResult({
      // data[0] is the top match by score but is NOT in the pool, so it is
      // skipped from companions — the badge score must still come from it.
      resultData: [
        { path: "not-in-pool", similarity: 0.97 },
        { path: "a", similarity: 0.5 },
      ],
      pool,
      desiredCount: 3,
    });
    expect(out.companions.map((p) => p.path)).toEqual(["a"]);
    expect(out.topSimilarity).toBe(0.97);
  });

  it("returns empty companions and null score for empty result data", () => {
    const out = mapVectorRemixResult({ resultData: [], pool, desiredCount: 3 });
    expect(out.companions).toEqual([]);
    expect(out.topSimilarity).toBeNull();
  });
});

describe("toSimilarQueueRows", () => {
  const row = (path: string, extra: Partial<RandomPhotoRow> = {}): RandomPhotoRow => ({
    path,
    exif: "",
    geocode: "",
    ...extra,
  });

  // Similar mode queued result rows as they came: a minute of a long clip
  // became a slide of its own, and every row lost its media kind, so a clip
  // never played there.
  it("queues a clip once for its matched moments, from its own row, playable", () => {
    const clip = row("../albums/a/clip.mov", { geocode: "Tokyo", mediaKind: "video", colors: "c" });
    const queue = toSimilarQueueRows({
      results: [
        { path: "../albums/a/clip.mov@t60", exif: "", geocode: "", mediaKind: "video" },
        { path: "../albums/a/clip.mov@t120", exif: "", geocode: "", mediaKind: "video" },
        { path: "../albums/a/1.jpg", exif: "e", geocode: "g", colors: "p" },
      ],
      pool: [clip],
      filter: null,
      recent: [],
    });

    expect(queue).toEqual([
      clip,
      { path: "../albums/a/1.jpg", exif: "e", geocode: "g", colors: "p" },
    ]);
  });

  it("keeps the album filter and leaves out what was shown recently", () => {
    const queue = toSimilarQueueRows({
      results: [row("../albums/a/1.jpg"), row("../albums/b/2.jpg"), row("../albums/a/3.jpg")],
      pool: [],
      filter: "a",
      recent: ["../albums/a/1.jpg"],
    });

    expect(queue.map((item) => item.path)).toEqual(["../albums/a/3.jpg"]);
  });
});
