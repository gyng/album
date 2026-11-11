import { dealGuessPhotos } from "./guessDaily";

const pool = Array.from({ length: 40 }, (_, index) => ({
  path: `../albums/test-simple/${String(index).padStart(2, "0")}.jpg`,
}));

describe("dealGuessPhotos", () => {
  // The database returns rows in whatever order it scans them, which follows
  // how the archive happened to be indexed rather than anything about a seed.
  it("deals the same photographs however the pool arrived", () => {
    const reversed = [...pool].reverse();
    const interleaved = [...pool.filter((_, i) => i % 2), ...pool.filter((_, i) => !(i % 2))];
    const deal = dealGuessPhotos(pool, "daily-2026-11-11").map((photo) => photo.path);
    expect(dealGuessPhotos(reversed, "daily-2026-11-11").map((photo) => photo.path)).toEqual(deal);
    expect(dealGuessPhotos(interleaved, "daily-2026-11-11").map((photo) => photo.path)).toEqual(
      deal,
    );
  });

  it("deals every photograph once, differently for another seed", () => {
    const first = dealGuessPhotos(pool, "daily-2026-11-11").map((photo) => photo.path);
    const second = dealGuessPhotos(pool, "daily-2026-11-12").map((photo) => photo.path);
    expect([...first].sort()).toEqual(pool.map((photo) => photo.path));
    expect(first).not.toEqual(pool.map((photo) => photo.path));
    expect(second).not.toEqual(first);
  });
});
