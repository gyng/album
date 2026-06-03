import {
  advanceHistory,
  canGoBack,
  currentEntry,
  hasForwardEntry,
  type NavigationEntry,
  type SlideshowHistoryState,
  initialHistoryState,
  upcomingSeed,
} from "./slideshowHistory";
import type { RandomPhotoRow } from "../components/search/api";

const row = (path: string): RandomPhotoRow => ({ path, exif: "", geocode: "" });
const entry = (
  seedPath: string,
  companionPaths: string[] = [],
): NavigationEntry => ({
  seed: row(seedPath),
  companions: companionPaths.map(row),
  strategy: companionPaths.length > 0 ? "same-album" : null,
});

const seeds = (s: SlideshowHistoryState): string[] =>
  s.history.map((e) => e.seed.path);

describe("advanceHistory reducer", () => {
  it("commit appends and points the index at the new entry", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "commit", entry: entry("b") });
    expect(seeds(s)).toEqual(["a", "b"]);
    expect(s.index).toBe(1);
    expect(currentEntry(s)?.seed.path).toBe("b");
  });

  it("commit after going back truncates the forward history", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "commit", entry: entry("b") });
    s = advanceHistory(s, { type: "commit", entry: entry("c") });
    s = advanceHistory(s, { type: "goTo", index: 0 }); // back to a
    s = advanceHistory(s, { type: "commit", entry: entry("d") });
    // b and c are discarded; d follows a.
    expect(seeds(s)).toEqual(["a", "d"]);
    expect(s.index).toBe(1);
  });

  it("goTo moves the cursor without changing entries", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "commit", entry: entry("b") });
    s = advanceHistory(s, { type: "goTo", index: 0 });
    expect(s.index).toBe(0);
    expect(seeds(s)).toEqual(["a", "b"]);
    expect(currentEntry(s)?.seed.path).toBe("a");
  });

  it("patchEntry updates the matching seed's companions and score", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "commit", entry: entry("seed") });
    s = advanceHistory(s, {
      type: "patchEntry",
      seedPath: "seed",
      companions: [row("x"), row("y")],
      vectorScore: 0.91,
    });
    const patched = s.history.find((e) => e.seed.path === "seed");
    expect(patched?.companions.map((c) => c.path)).toEqual(["x", "y"]);
    expect(patched?.vectorScore).toBe(0.91);
    // The other entry is untouched.
    expect(s.history[0].companions).toEqual([]);
  });

  it("patchEntry targets the CURRENT slide, not an earlier entry with the same path", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("dup") }); // index 0
    s = advanceHistory(s, { type: "commit", entry: entry("b") });
    s = advanceHistory(s, { type: "commit", entry: entry("dup") }); // index 2, current
    s = advanceHistory(s, {
      type: "patchEntry",
      seedPath: "dup",
      companions: [row("x")],
      vectorScore: 0.8,
    });
    // The current occurrence (index 2) is patched; the earlier "dup" is not.
    expect(s.history[2].companions.map((c) => c.path)).toEqual(["x"]);
    expect(s.history[0].companions).toEqual([]);
  });

  it("patchEntry is a no-op when the user has navigated away from the seed", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("seed") });
    s = advanceHistory(s, { type: "commit", entry: entry("later") });
    s = advanceHistory(s, { type: "goTo", index: 1 }); // current is "later"
    const before = s;
    s = advanceHistory(s, {
      type: "patchEntry",
      seedPath: "seed", // resolve for the now-not-current slide
      companions: [row("x")],
      vectorScore: 0.5,
    });
    expect(s).toEqual(before);
  });

  it("patchEntry is a no-op when no entry matches the seed (stale resolve)", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    const before = s;
    s = advanceHistory(s, {
      type: "patchEntry",
      seedPath: "gone",
      companions: [row("x")],
      vectorScore: 0.5,
    });
    expect(s).toEqual(before);
  });

  it("clearCurrentRemix collapses the current entry to a single photo", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a", ["b", "c"]) });
    expect(currentEntry(s)?.companions).toHaveLength(2);
    s = advanceHistory(s, { type: "clearCurrentRemix" });
    expect(currentEntry(s)?.companions).toEqual([]);
    expect(currentEntry(s)?.strategy).toBeNull();
    expect(currentEntry(s)?.vectorScore ?? null).toBeNull();
  });

  it("reset empties the history", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "reset" });
    expect(s).toEqual({ history: [], index: -1 });
  });

  it("replaceSingle resets to one single-photo entry at index 0", () => {
    let s = initialHistoryState();
    s = advanceHistory(s, { type: "commit", entry: entry("a", ["b"]) });
    s = advanceHistory(s, { type: "commit", entry: entry("c") });
    s = advanceHistory(s, { type: "replaceSingle", seed: row("z") });
    expect(seeds(s)).toEqual(["z"]);
    expect(s.index).toBe(0);
    expect(currentEntry(s)?.companions).toEqual([]);
    expect(currentEntry(s)?.strategy).toBeNull();
  });

  it("treats state as immutable (does not mutate the previous state)", () => {
    const s0 = initialHistoryState();
    const s1 = advanceHistory(s0, { type: "commit", entry: entry("a") });
    expect(s0).toEqual({ history: [], index: -1 });
    expect(s1).not.toBe(s0);
  });
});

describe("derived helpers", () => {
  it("currentEntry / canGoBack / hasForwardEntry / upcomingSeed", () => {
    let s = initialHistoryState();
    expect(currentEntry(s)).toBeNull();
    expect(canGoBack(s)).toBe(false);
    expect(hasForwardEntry(s)).toBe(false);
    expect(upcomingSeed(s)).toBeNull();

    s = advanceHistory(s, { type: "commit", entry: entry("a") });
    s = advanceHistory(s, { type: "commit", entry: entry("b") });
    expect(canGoBack(s)).toBe(true); // index 1
    expect(hasForwardEntry(s)).toBe(false);

    s = advanceHistory(s, { type: "goTo", index: 0 });
    expect(canGoBack(s)).toBe(false);
    expect(hasForwardEntry(s)).toBe(true);
    expect(upcomingSeed(s)?.path).toBe("b");
  });
});
