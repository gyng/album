import { getNextAlignedSlideshowChange } from "./slideshowTiming";

describe("getNextAlignedSlideshowChange", () => {
  it("aligns ten-second delays to the next ten-second boundary", () => {
    expect(
      getNextAlignedSlideshowChange({
        now: new Date(2026, 4, 10, 12, 34, 52, 300),
        delayMs: 10000,
      }),
    ).toEqual(new Date(2026, 4, 10, 12, 35, 0, 0));
  });

  it("aligns fifteen-minute delays to the next quarter-hour", () => {
    expect(
      getNextAlignedSlideshowChange({
        now: new Date(2026, 4, 10, 12, 34, 0, 0),
        delayMs: 900000,
      }),
    ).toEqual(new Date(2026, 4, 10, 12, 45, 0, 0));
  });

  it("aligns hour-based delays to the next interval from local midnight", () => {
    expect(
      getNextAlignedSlideshowChange({
        now: new Date(2026, 4, 10, 13, 20, 0, 0),
        delayMs: 3 * 60 * 60 * 1000,
      }),
    ).toEqual(new Date(2026, 4, 10, 15, 0, 0, 0));
  });

  it("aligns day-long delays to the next local midnight", () => {
    expect(
      getNextAlignedSlideshowChange({
        now: new Date(2026, 4, 10, 13, 20, 0, 0),
        delayMs: 24 * 60 * 60 * 1000,
      }),
    ).toEqual(new Date(2026, 4, 11, 0, 0, 0, 0));
  });

  it("uses the next boundary when already on a boundary", () => {
    expect(
      getNextAlignedSlideshowChange({
        now: new Date(2026, 4, 10, 12, 45, 0, 0),
        delayMs: 900000,
      }),
    ).toEqual(new Date(2026, 4, 10, 13, 0, 0, 0));
  });
});
