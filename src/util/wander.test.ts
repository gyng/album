import {
  findWanderEntry,
  meetsQuest,
  wanderExits,
  wanderJump,
  wanderHunt,
  wanderRoute,
  wanderKeyword,
  wanderQuest,
  type WanderEntry,
} from "./wander";

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
    expect(wanderExits(entries, 0, new Set([1, 2, 3, 4, 5, 6]))).toEqual([]);
  });

  it("stops at the requested count and copes with a dead end", () => {
    expect(wanderExits(entries, 0, new Set(), 2)).toHaveLength(2);
    expect(wanderExits([], 6)).toEqual([]);
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

  it("restricts harder quests to unique targets while easy quests allow more matches", () => {
    const entries = [
      ...common(["cat"], 10),
      ...common(["stairs"], 10),
      ...common(["cat", "stairs"], 7),
    ];
    expect(wanderHunt(entries, 1, () => 0, undefined, 10)).toHaveLength(1);
    expect(wanderHunt(entries, 1, () => 0, undefined, 5)).toEqual([]);
    expect(wanderHunt(entries, 1, () => 0, undefined, 1)).toEqual([]);
    const unique = [
      ...common(["cat"], 10),
      ...common(["stairs"], 10),
      ...common(["cat", "stairs"], 1),
    ];
    expect(wanderHunt(unique, 1, () => 0, undefined, 1)).toHaveLength(1);
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

describe("escaping a local loop", () => {
  const photos = [
    entry("/album/city#0", ["street", "building"], "", [1, 2]),
    entry("/album/city#1", ["street", "car"], "", [0, 2]),
    entry("/album/city#2", ["street", "building"], "", [0, 1]),
    entry("/album/hills#0", ["mountain", "forest"], "", [4]),
    entry("/album/coast#0", ["sea", "beach"], "", [3]),
  ];
  it("offers an unseen global exit beyond the local city neighbours", () => {
    const exits = wanderExits(photos, 0, new Set([0]));
    expect(exits.some((exit) => exit.index >= 3)).toBe(true);
    expect(exits[0]).toEqual({ index: 1, label: "closest" });
    const escaped = wanderExits(photos, 0, new Set([0, 1, 2]));
    expect(escaped.length).toBeGreaterThan(0);
    expect(escaped.every((exit) => exit.index >= 3)).toBe(true);
  });
  it("takes a leap outside the neighbourhood and never chooses an explored photograph", () => {
    expect(wanderJump(photos, 0, new Set([0]), () => 0)).toBe(3);
    expect(wanderJump(photos, 0, new Set([0, 3]), () => 0)).toBe(4);
    expect(wanderJump(photos, 0, new Set([0, 1, 2, 3, 4]), () => 0)).toBeNull();
  });
  it("jumps to the requested scene rather than another city frame", () => {
    expect(wanderJump(photos, 0, new Set([0]), () => 0, "nature")).toBe(3);
    expect(wanderJump(photos, 0, new Set([0]), () => 0, "water")).toBe(4);
    expect(wanderJump(photos, 0, new Set([0, 3]), () => 0, "nature")).toBeNull();
  });
});

it("builds a hunt with distinct, solvable targets and avoids a goal already met at the start", () => {
  const source = [
    ...Array.from({ length: 8 }, (_, i) => entry(`/album/q#cat-${i}`, ["cat"], "")),
    ...Array.from({ length: 8 }, (_, i) => entry(`/album/q#stairs-${i}`, ["stairs"], "")),
    ...Array.from({ length: 8 }, (_, i) => entry(`/album/q#forest-${i}`, ["forest"], "")),
    ...Array.from({ length: 8 }, (_, i) => entry(`/album/q#lake-${i}`, ["lake"], "")),
    entry("/album/q#cat-stairs", ["cat", "stairs"], ""),
    entry("/album/q#forest-lake", ["forest", "lake"], ""),
  ];
  const goals = wanderHunt(source, 3, () => 0);
  expect(goals).toHaveLength(2);
  expect(new Set(goals.map((goal) => goal.tags.join("/"))).size).toBe(2);
  for (const goal of goals) expect(source.some((photo) => meetsQuest(photo, goal))).toBe(true);
  const avoid = source.at(-2)!;
  expect(wanderHunt(source, 1, () => 0, avoid).every((goal) => !meetsQuest(avoid, goal))).toBe(
    true,
  );
});

it("finds a solution using the actual available exits and respects explored photos", () => {
  const entries = [
    entry("/album/a#0", ["street"], "", [1]),
    entry("/album/a#1", ["street"], "", [2]),
    entry("/album/a#2", ["cat"], ""),
  ];
  const visited = new Set([0]);
  const route = wanderRoute(entries, 0, (photo) => photo === entries[2], visited)!;
  let current = 0;
  for (const step of route) {
    expect(wanderExits(entries, current, visited)).toContainEqual(step);
    visited.add(step.index);
    current = step.index;
  }
  expect(current).toBe(2);
  expect(wanderRoute(entries, 0, () => false)).toBeNull();
});

it("steers towards or away from a keyword, preferring related unvisited photos", () => {
  const entries = [
    entry("/album/a#0", ["city", "cat"], "", [1, 2]),
    entry("/album/a#1", ["cat", "window"], ""),
    entry("/album/a#2", ["forest"], ""),
    entry("/album/a#3", ["cat"], ""),
  ];
  expect(wanderKeyword(entries, 0, new Set([0]), "cat")).toBe(1);
  expect(wanderKeyword(entries, 0, new Set([0, 1]), "cat")).toBe(3);
  expect(wanderKeyword(entries, 0, new Set([0]), "cat", false)).toBe(2);
  expect(wanderKeyword(entries, 0, new Set([0]), "window")).toBe(1);
  expect(wanderKeyword(entries, 0, new Set([0]), "unicorn")).toBeNull();
  expect(wanderKeyword(entries, 0, new Set([0]), " ")).toBeNull();
});
