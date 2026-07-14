import {
  advanceQueued,
  avoidBoundaryRepeat,
  computePoolStats,
  createRandomQueueState,
  EMPTY_POOL_STATS,
  formatNewestPhotoDate,
  getSlideshowPhotoSrc,
  peekNextQueued,
  resetRandomQueue,
  shufflePhotos,
  weightedShufflePhotos,
} from "./slideshowQueue";
import type { RandomPhotoRow } from "../components/search/api";

const makePhoto = (path: string, isoDate?: string): RandomPhotoRow => ({
  path,
  // extractDateFromExifString reads the "EXIF DateTimeOriginal" line in
  // "YYYY:MM:DD HH:MM:SS" form, so encode the test date that way.
  exif: isoDate ? `EXIF DateTimeOriginal: ${isoDate.replace(/-/g, ":")} 12:00:00` : "",
  geocode: "",
});

const pathsOf = (photos: RandomPhotoRow[]): string[] => photos.map((p) => p.path);

describe("shufflePhotos", () => {
  it("returns a permutation of the input (same multiset of paths)", () => {
    const input = [
      makePhoto("../albums/a/1.jpg"),
      makePhoto("../albums/a/2.jpg"),
      makePhoto("../albums/a/3.jpg"),
    ];
    const out = shufflePhotos(input);
    expect(pathsOf(out).sort()).toEqual(pathsOf(input).sort());
  });

  it("does not mutate the input array order", () => {
    const input = [makePhoto("a"), makePhoto("b"), makePhoto("c")];
    const before = pathsOf(input);
    shufflePhotos(input);
    expect(pathsOf(input)).toEqual(before);
  });
});

describe("avoidBoundaryRepeat", () => {
  it("swaps the head away when it repeats the previous last path", () => {
    const photos = [makePhoto("x"), makePhoto("y"), makePhoto("z")];
    const out = avoidBoundaryRepeat(photos, "x");
    expect(out[0]?.path).not.toBe("x");
    expect(pathsOf(out).sort()).toEqual(["x", "y", "z"]);
  });

  it("leaves the head untouched when there is no repeat", () => {
    const photos = [makePhoto("x"), makePhoto("y")];
    const out = avoidBoundaryRepeat(photos, "q");
    expect(out[0]?.path).toBe("x");
  });

  it("leaves a single-photo array untouched even if it repeats", () => {
    const photos = [makePhoto("x")];
    const out = avoidBoundaryRepeat(photos, "x");
    expect(out[0]?.path).toBe("x");
  });

  it("cannot swap when every candidate has the repeated path", () => {
    const photos = [makePhoto("x"), makePhoto("x")];
    expect(pathsOf(avoidBoundaryRepeat(photos, "x"))).toEqual(["x", "x"]);
  });
});

describe("weightedShufflePhotos", () => {
  it("returns a permutation of the input", () => {
    const input = [
      makePhoto("a", "2020-01-01"),
      makePhoto("b", "2021-06-01"),
      makePhoto("c", "2022-12-31"),
    ];
    const out = weightedShufflePhotos(input);
    expect(pathsOf(out).sort()).toEqual(["a", "b", "c"]);
  });

  it("falls back to a plain shuffle when no timestamps are present", () => {
    const input = [makePhoto("a"), makePhoto("b")];
    const out = weightedShufflePhotos(input);
    expect(pathsOf(out).sort()).toEqual(["a", "b"]);
  });

  it("gives undated photos a small weight when mixed with dated photos", () => {
    const input = [makePhoto("dated", "2020-01-01"), makePhoto("undated")];
    const out = weightedShufflePhotos(input);
    expect(pathsOf(out).sort()).toEqual(["dated", "undated"]);
  });

  it("does not blow the call stack on a very large pool (no Math.min spread)", () => {
    // The previous implementation spread the timestamp array into Math.min/
    // Math.max, which throws "Maximum call stack size exceeded" past ~100k
    // elements. This guards the reduce-based implementation.
    const big: RandomPhotoRow[] = [];
    for (let i = 0; i < 200000; i += 1) {
      big.push(makePhoto(`p${i}`, "2020-01-01"));
    }
    expect(() => weightedShufflePhotos(big)).not.toThrow();
    expect(weightedShufflePhotos(big)).toHaveLength(big.length);
  });
});

describe("random queue peek/advance consistency (preload buffer)", () => {
  it("resets the queue position while retaining the boundary path", () => {
    const state = { queue: [makePhoto("a")], index: 0, lastPath: "a" };
    resetRandomQueue(state);
    expect(state).toEqual({ queue: [], index: -1, lastPath: "a" });
  });

  it("peek is stable and matches the photo the next advance consumes, even with a randomised builder across a boundary", () => {
    // A 50-photo pool over many trials makes this an effectively deterministic
    // guard against the old throwaway-shuffle bug (where peek rebuilt a fresh
    // shuffle each call): two independent shuffles coincidentally agreeing on
    // the head is ~1/50 per trial, so ~0 false greens across 200 trials. A
    // 3-photo single run let that bug slip through ~25% of the time.
    const pool = Array.from({ length: 50 }, (_, i) => makePhoto(`p${i}`));
    const build = (p: RandomPhotoRow[], lastPath?: string) => shufflePhotos(p, lastPath);

    for (let trial = 0; trial < 200; trial += 1) {
      const state = createRandomQueueState();

      // Drain a whole queue so the next peek/advance straddles a refill.
      for (let i = 0; i < pool.length; i += 1) {
        advanceQueued(state, pool, build);
      }

      // At the boundary: two peeks must agree (no throwaway reshuffle), and the
      // subsequent advance must consume exactly that peeked photo.
      const peek1 = peekNextQueued(state, pool, build);
      const peek2 = peekNextQueued(state, pool, build);
      const advanced = advanceQueued(state, pool, build);

      expect(peek1).toBe(peek2);
      expect(peek1).toBe(advanced);
    }
  });

  it("returns null for an empty pool", () => {
    const state = createRandomQueueState();
    const identity = (p: RandomPhotoRow[]) => p;
    expect(peekNextQueued(state, [], identity)).toBeNull();
    expect(advanceQueued(state, [], identity)).toBeNull();
  });

  it("returns null when a queue builder cannot produce a candidate", () => {
    const state = createRandomQueueState();
    const emptyBuilder = () => [];
    expect(peekNextQueued(state, [makePhoto("a")], emptyBuilder)).toBeNull();
    expect(advanceQueued(state, [makePhoto("a")], emptyBuilder)).toBeNull();
  });

  it("cycles through every photo before repeating within a queue pass", () => {
    const pool = [makePhoto("a"), makePhoto("b"), makePhoto("c")];
    const build = (p: RandomPhotoRow[]) => [...p];
    const state = createRandomQueueState();
    const seen = [
      advanceQueued(state, pool, build)?.path,
      advanceQueued(state, pool, build)?.path,
      advanceQueued(state, pool, build)?.path,
    ];
    expect(seen.slice().sort()).toEqual(["a", "b", "c"]);
  });
});

describe("computePoolStats", () => {
  it("provides stable empty-pool defaults", () => {
    expect(EMPTY_POOL_STATS).toEqual({ count: 0, newestDate: null });
  });

  it("counts photos and finds the newest date", () => {
    const stats = computePoolStats([
      makePhoto("a", "2020-01-01"),
      makePhoto("b", "2023-05-05"),
      makePhoto("c", "2021-01-01"),
    ]);
    expect(stats.count).toBe(3);
    expect(stats.newestDate?.getFullYear()).toBe(2023);
  });

  it("reports a null newest date when no photo has a parseable date", () => {
    const stats = computePoolStats([makePhoto("a"), makePhoto("b")]);
    expect(stats.count).toBe(2);
    expect(stats.newestDate).toBeNull();
  });

  it("formats the newest date for display in British order", () => {
    expect(formatNewestPhotoDate(new Date("2024-03-22T00:00:00Z"))).toBe("22 Mar 2024");
  });
});

describe("getSlideshowPhotoSrc", () => {
  it("builds the resized-image path from an album photo path", () => {
    expect(getSlideshowPhotoSrc(makePhoto("../albums/japan/IMG_1.jpg"))).toBe(
      "/data/albums/japan/.resized_images/IMG_1.jpg@3200.avif",
    );
  });

  it("returns null for a null photo or malformed path", () => {
    expect(getSlideshowPhotoSrc(null)).toBeNull();
    expect(getSlideshowPhotoSrc(makePhoto("not-an-album-path"))).toBeNull();
  });
});
