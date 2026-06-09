import {
  buildSlideSnapshot,
  slideKeyOf,
  isIncomingReady,
  pushLayer,
  revealLayers,
  removeLayer,
  CrossfadeLayer,
  SlideSnapshot,
} from "./slideshowCrossfade";

const snap = (...srcs: string[]): SlideSnapshot => ({
  remix: srcs.length > 1,
  cells: srcs.map((src) => ({ path: src, src })),
});

describe("buildSlideSnapshot", () => {
  it("returns null when there are no usable cells", () => {
    expect(buildSlideSnapshot([])).toBeNull();
    expect(buildSlideSnapshot([null, undefined])).toBeNull();
    expect(buildSlideSnapshot([{ path: "a", src: "" }])).toBeNull();
  });

  it("captures a single (non-remix) slide", () => {
    expect(buildSlideSnapshot([{ path: "a", src: "a.jpg" }])).toEqual({
      remix: false,
      cells: [{ path: "a", src: "a.jpg" }],
    });
  });

  it("captures a remix slide, dropping cells with no src (unresolved companions)", () => {
    expect(
      buildSlideSnapshot([
        { path: "seed", src: "seed.jpg" },
        null,
        { path: "b", src: "b.jpg" },
      ]),
    ).toEqual({
      remix: true,
      cells: [
        { path: "seed", src: "seed.jpg" },
        { path: "b", src: "b.jpg" },
      ],
    });
  });
});

describe("slideKeyOf", () => {
  it("is null without a snapshot and changes when cells change", () => {
    expect(slideKeyOf(null)).toBeNull();
    expect(slideKeyOf(snap("a.jpg"))).toBe("a.jpg");
    // single → grid (async companions) yields a different key, forcing a fade.
    expect(slideKeyOf(snap("a.jpg"))).not.toBe(slideKeyOf(snap("a.jpg", "b.jpg")));
  });
});

describe("isIncomingReady", () => {
  it("gates a single slide on the image decode flag", () => {
    expect(isIncomingReady({ isRemix: false, imageLoaded: false, remixGridReady: true })).toBe(false);
    expect(isIncomingReady({ isRemix: false, imageLoaded: true, remixGridReady: false })).toBe(true);
  });

  it("gates a remix slide on the whole-grid ready flag", () => {
    expect(isIncomingReady({ isRemix: true, imageLoaded: true, remixGridReady: false })).toBe(false);
    expect(isIncomingReady({ isRemix: true, imageLoaded: false, remixGridReady: true })).toBe(true);
  });
});

describe("layer stack", () => {
  const keys = (layers: CrossfadeLayer[]) => layers.map((l) => l.key);

  it("pushes a new hidden top layer", () => {
    const after = pushLayer([], "a", snap("a.jpg"));
    expect(after).toEqual([{ key: "a", slide: snap("a.jpg"), loaded: false }]);
  });

  it("refreshes the snapshot when the top key is unchanged (companions resolving)", () => {
    const start: CrossfadeLayer[] = [{ key: "a", slide: snap("a.jpg"), loaded: true }];
    const after = pushLayer(start, "a", snap("a.jpg", "b.jpg"));
    expect(after).toHaveLength(1);
    expect(after[0].slide.remix).toBe(true);
    expect(after[0].loaded).toBe(true);
  });

  it("reveals one layer and fades out the rest (the cross-fade)", () => {
    const start: CrossfadeLayer[] = [
      { key: "a", slide: snap("a.jpg"), loaded: true },
      { key: "b", slide: snap("b.jpg"), loaded: false },
    ];
    const after = revealLayers(start, "b");
    expect(after.find((l) => l.key === "a")?.loaded).toBe(false);
    expect(after.find((l) => l.key === "b")?.loaded).toBe(true);
  });

  it("removes a faded-out layer on transitionend", () => {
    const start: CrossfadeLayer[] = [
      { key: "a", slide: snap("a.jpg"), loaded: false },
      { key: "b", slide: snap("b.jpg"), loaded: true },
    ];
    expect(keys(removeLayer(start, "a"))).toEqual(["b"]);
  });

  it("caps the stack to the last visible layer + the new top on rapid advances", () => {
    // a shown, then advance to b and c before either b reveals.
    let layers: CrossfadeLayer[] = [{ key: "a", slide: snap("a.jpg"), loaded: true }];
    layers = pushLayer(layers, "b", snap("b.jpg")); // [a(shown), b]
    layers = pushLayer(layers, "c", snap("c.jpg")); // never-shown b dropped
    expect(keys(layers)).toEqual(["a", "c"]);
    expect(layers.find((l) => l.key === "a")?.loaded).toBe(true);
  });
});
