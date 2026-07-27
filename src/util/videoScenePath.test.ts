import { clipPathOf, collapseSceneRanking, sceneSecondsOf } from "./videoScenePath";

describe("scene paths", () => {
  it("reads the moment a scene row was taken from", () => {
    expect(sceneSecondsOf("../albums/trip/clip.mov@t120")).toBe(120);
    expect(sceneSecondsOf("../albums/trip/clip.mov")).toBeUndefined();
    expect(sceneSecondsOf("../albums/trip/photo.jpg")).toBeUndefined();
  });

  it("traces a scene back to the clip it belongs to", () => {
    expect(clipPathOf("../albums/trip/clip.mov@t120")).toBe("../albums/trip/clip.mov");
    // Anything that is not a scene is its own clip, so callers can group by this
    // without asking what kind of row they have.
    expect(clipPathOf("../albums/trip/photo.jpg")).toBe("../albums/trip/photo.jpg");
  });
});

describe("collapseSceneRanking", () => {
  const ranked = [
    { path: "../albums/trip/clip.mov@t180", similarity: 0.9 },
    { path: "../albums/trip/other.jpg", similarity: 0.8 },
    { path: "../albums/trip/clip.mov@t60", similarity: 0.7 },
    { path: "../albums/trip/clip.mov", similarity: 0.6 },
  ];

  // A twenty-minute clip has twenty scenes; without collapsing, one video would
  // fill a page of results with near-identical frames of itself.
  it("keeps only a clip's best-matching moment", () => {
    expect(collapseSceneRanking(ranked).map((entry) => entry.path)).toEqual([
      "../albums/trip/clip.mov@t180",
      "../albums/trip/other.jpg",
    ]);
  });

  // The clip's own row and its scenes are the same piece of footage.
  it("treats a clip's own row as one of its moments", () => {
    const clipFirst = [
      { path: "../albums/trip/clip.mov", similarity: 0.9 },
      { path: "../albums/trip/clip.mov@t60", similarity: 0.8 },
    ];
    expect(collapseSceneRanking(clipFirst).map((entry) => entry.path)).toEqual([
      "../albums/trip/clip.mov",
    ]);
  });

  it("leaves a ranking of photos untouched", () => {
    const photos = [
      { path: "../albums/trip/a.jpg", similarity: 0.9 },
      { path: "../albums/trip/b.jpg", similarity: 0.8 },
    ];
    expect(collapseSceneRanking(photos)).toEqual(photos);
  });
});
