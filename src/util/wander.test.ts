import { findWanderEntry, meetsQuest, wanderExits, wanderQuest, type WanderEntry } from "./wander";

const entry = (
  href: string,
  tags: string[],
  swatch: string,
  near: number[] = [],
  around: number[] = [],
): WanderEntry => ({
  src: `/data/albums/${href.slice(7).replace("#", "/.resized_images/")}%40800.avif`,
  href,
  tags,
  swatch,
  near,
  around,
});

describe("wanderExits", () => {
  const grey = "rgb(128, 128, 128)";
  const entries = [
    entry("/album/a#0", ["street", "car"], grey, [1, 2, 3], [4, 5, 6]),
    entry("/album/a#1", ["street", "car"], grey), // the same again: closest
    entry("/album/a#2", ["street", "car"], grey), // nothing new: skipped
    entry("/album/a#3", ["street", "bicycle"], grey),
    entry("/album/a#4", ["street", "car"], "rgb(20, 20, 30)"),
    entry("/album/a#5", ["street", "bicycle"], "rgb(220, 120, 40)"),
    entry("/album/a#6", ["canal"], grey),
  ];

  it("leads with the closest and labels every other exit by what changes", () => {
    expect(wanderExits(entries, 0)).toEqual([
      { index: 1, label: "closest" },
      { index: 3, label: "bicycle" },
      { index: 4, label: "darker" },
      { index: 5, label: "warmer" },
      { index: 6, label: "canal" },
    ]);
  });

  it("keeps to unwalked photographs while there are any", () => {
    expect(wanderExits(entries, 0, new Set([1, 3]))[0]).toEqual({ index: 2, label: "closest" });
    expect(wanderExits(entries, 0, new Set([1, 2, 3, 4, 5, 6]))[0]).toEqual({
      index: 1,
      label: "closest",
    });
  });

  it("stops at the requested count and copes with a dead end", () => {
    expect(wanderExits(entries, 0, new Set(), 2)).toHaveLength(2);
    expect(wanderExits(entries, 6)).toEqual([]);
  });
});

describe("wanderQuest", () => {
  const common = (tags: string[], count: number) =>
    Array.from({ length: count }, (_, i) => entry(`/album/q#${tags.join("-")}-${i}`, tags, ""));

  it("asks for two common subjects that appear together only a few times", () => {
    const entries = [
      ...common(["cat"], 10),
      ...common(["staircase"], 10),
      ...common(["cat", "staircase"], 2),
      // Together too often to be a search.
      ...common(["sky", "cloud"], 12),
    ];
    expect(wanderQuest(entries, () => 0)).toEqual({ tags: ["cat", "staircase"] });
    expect(meetsQuest(entries.at(10 + 10)!, { tags: ["cat", "staircase"] })).toBe(true);
    expect(meetsQuest(entries[0]!, { tags: ["cat", "staircase"] })).toBe(false);
  });

  it("is null when no pair qualifies", () => {
    expect(wanderQuest(common(["rare", "pair"], 3))).toBeNull();
  });
});

it("finds a place on the walk by the search database's key", () => {
  const entries = [entry("/album/a#x.jpg", [], ""), entry("/album/b#y 1.jpg", [], "")];
  expect(findWanderEntry(entries, "../albums/b/y 1.jpg")).toBe(1);
  expect(findWanderEntry(entries, "../albums/c/z.jpg")).toBe(-1);
  expect(findWanderEntry(entries, null)).toBe(-1);
});
