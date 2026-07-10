import type { PhotoStats } from "../../util/computeStats";
import {
  buildExploreFunStats,
  buildExploreOverviewCards,
  buildColorSearchHref,
  formatCoverage,
} from "./exploreViewModel";

const makeStats = (): PhotoStats =>
  ({
    totalPhotos: 12,
    totalAlbums: 3,
    dateRange: [2020, 2024],
    numericFacets: [
      {
        facetId: "hour",
        displayName: "Hour",
        coverage: 1,
        data: [
          { label: "07:00", count: 3 },
          { label: "20:00", count: 5 },
        ],
      },
    ],
    stringFacets: [
      {
        facetId: "camera",
        displayName: "Camera",
        coverage: 1,
        data: [{ label: "Camera A", count: 8 }],
      },
      {
        facetId: "lens",
        displayName: "Lens",
        coverage: 1,
        data: [{ label: "Lens A", count: 7 }],
      },
      {
        facetId: "location",
        displayName: "Country",
        coverage: 1,
        data: [{ label: "Japan", count: 6 }],
      },
    ],
    weekdayStats: [
      { label: "Mon", count: 2 },
      { label: "Sat", count: 4 },
      { label: "Sun", count: 4 },
    ],
    lensTypeStats: { prime: 8, zoom: 2, unknown: 0 },
    technicalRelationships: null,
    colorStats: [{ label: "Blue", count: 6 }],
  }) as PhotoStats;

describe("exploreViewModel", () => {
  it("builds stable overview cards from archive statistics", () => {
    expect(buildExploreOverviewCards(makeStats())).toEqual([
      { label: "Photos", value: "12" },
      { label: "Albums", value: "3" },
      { label: "Years", value: "2020–2024" },
      { label: "Top camera", value: "Camera A" },
      { label: "Top lens", value: "Lens A" },
      { label: "Top country", value: "Japan" },
      { label: "Peak hour", value: "20:00" },
    ]);
  });

  it("derives the existing fun-stat labels and search action", () => {
    const cards = buildExploreFunStats(makeStats());

    expect(cards.map((card) => card.value)).toEqual([
      "Weekend leaning",
      "Prime person",
      "Not enough settings data",
      "Night owl",
      "Blue",
    ]);
    expect(cards.at(-1)?.actionHref).toBe("/search?color=93,132,214");
  });

  it("keeps coverage and colour search links deterministic", () => {
    expect(formatCoverage(0.456)).toBe("Available for 46% of archive");
    expect(buildColorSearchHref("Blue", "2024")).toBe(
      "/search?color=93%2C132%2C214&facet=year%3A2024",
    );
  });
});
