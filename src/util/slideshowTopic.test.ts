import { RandomPhotoRow } from "../components/search/api";
import { decideTopicSeed, mapTopicSeedResults, normaliseTopic } from "./slideshowTopic";

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

  it("seeds from the best match and queues the remaining ranked rows", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/a/2.jpg" }, { path: "../albums/a/1.jpg" }],
      pool,
      previousMode: "weighted",
      filter: "a",
    });
    expect(plan.kind).toBe("seed");
    if (plan.kind !== "seed") return;
    expect(plan.seed.path).toBe("../albums/a/2.jpg");
    expect(plan.queue.map((r) => r.path)).toEqual(["../albums/a/1.jpg"]);
    // The snapshot is what a later dismiss restores exactly.
    expect(plan.snapshot).toEqual({ mode: "weighted", filter: "a" });
  });

  it("captures an absent filter as undefined in the restore snapshot", () => {
    const plan = decideTopicSeed({
      resultData: [{ path: "../albums/a/1.jpg" }],
      pool,
      previousMode: "random",
    });
    if (plan.kind !== "seed") throw new Error("expected seed");
    expect(plan.snapshot).toEqual({ mode: "random", filter: undefined });
  });
});
