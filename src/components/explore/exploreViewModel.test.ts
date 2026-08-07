import type { PhotoStats } from "../../util/computeStats";
import {
  COLOR_FAMILY_ORDER,
  COLOR_SEARCH_PARAMS,
  COLOR_SWATCHES,
  EXPLORE_SECTION_LINKS,
  buildYearSearchHref,
  buildExploreFunStats,
  buildExploreOverviewCards,
  buildColorSearchHref,
  findNumericFacet,
  findStringFacet,
  formatCoverage,
  isAggregateLocationBucket,
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
  it("keeps colour and section metadata aligned", () => {
    expect(COLOR_FAMILY_ORDER).toEqual(Object.keys(COLOR_SWATCHES));
    expect(COLOR_FAMILY_ORDER).toEqual(Object.keys(COLOR_SEARCH_PARAMS));
    expect(EXPLORE_SECTION_LINKS.at(-1)).toEqual({ href: "#colour", label: "Colour" });
    // The cloud opens the page: it is the only section that is not a count, and
    // the one worth arriving at first.
    expect(EXPLORE_SECTION_LINKS[0]).toEqual({ href: "#embedding-space", label: "Cloud" });
  });

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
    expect(buildYearSearchHref("2024")).toBe("/search?facet=year%3A2024");
    expect(buildColorSearchHref("Blue")).toBe("/search?color=93%2C132%2C214");
    expect(buildColorSearchHref("Blue", "2024")).toBe(
      "/search?color=93%2C132%2C214&facet=year%3A2024",
    );
    expect(buildColorSearchHref("Sepia")).toBeNull();
    expect(isAggregateLocationBucket("Other countries")).toBe(true);
    expect(isAggregateLocationBucket("Japan")).toBe(false);
  });

  it("uses honest fallbacks for missing facets and ignores empty peak buckets", () => {
    const stats = makeStats();
    stats.totalPhotos = 12_345;
    stats.dateRange = null;
    stats.stringFacets = [{ facetId: "camera", displayName: "Camera", coverage: 0, data: [] }];
    stats.numericFacets = [
      {
        facetId: "hour",
        displayName: "Hour",
        coverage: 1,
        data: [
          { label: "00:00", count: 0 },
          { label: "01:00", count: 2 },
          { label: "02:00", count: 2 },
          { label: "03:00", count: 3 },
        ],
      },
    ];

    expect(buildExploreOverviewCards(stats)).toEqual([
      { label: "Photos", value: "12,345" },
      { label: "Albums", value: "3" },
      { label: "Years", value: "—" },
      { label: "Top camera", value: "—" },
      { label: "Top lens", value: "—" },
      { label: "Top country", value: "—" },
      { label: "Peak hour", value: "03:00" },
    ]);
    expect(findNumericFacet(stats, "missing")).toBeNull();
    expect(findStringFacet(stats, "missing")).toBeNull();

    stats.numericFacets = [];
    expect(buildExploreOverviewCards(stats).at(-1)).toEqual({ label: "Peak hour", value: "—" });
  });

  it("classifies insufficient archives without overstating a preference", () => {
    const stats = makeStats();
    stats.weekdayStats = [];
    stats.lensTypeStats = { prime: 0, zoom: 0, unknown: 12 };
    stats.numericFacets = [];
    stats.colorStats = [{ label: "Blue", count: 0 }];

    expect(buildExploreFunStats(stats).map((card) => card.value)).toEqual([
      "Not enough date data",
      "Lens mix unclear",
      "Not enough settings data",
      "Not enough time data",
      "Not enough palette data",
    ]);
  });

  it("classifies weekday, zoom, comfort-setting, early-bird, and unknown-colour patterns", () => {
    const stats = makeStats();
    stats.weekdayStats = [
      { label: "Mon", count: 9 },
      { label: "Sat", count: 1 },
    ];
    stats.lensTypeStats = { prime: 1, zoom: 9, unknown: 0 };
    stats.numericFacets[0]!.data = [
      { label: "07:00", count: 8 },
      { label: "20:00", count: 2 },
    ];
    stats.technicalRelationships = {
      axes: [],
      paths: [{ values: ["35–49mm · normal", "around f/2", "400"], count: 1234 }],
      total: 1234,
    };
    stats.colorStats = [
      { label: "Unused", count: -1 },
      { label: "Sepia", count: 5 },
      { label: "Blue", count: 5 },
    ];

    const cards = buildExploreFunStats(stats);
    expect(cards.map((card) => card.value)).toEqual([
      "Weekday leaning",
      "Zoom leaning",
      "35–49mm · normal · around f/2 · 400",
      "Early bird",
      "Sepia",
    ]);
    expect(cards[2]?.detail).toContain("1,234 photos");
    expect(cards[2]?.actionHref).toContain("focal-length-35mm");
    expect(cards[4]?.actionHref).toBeNull();
  });

  it("recognises balanced shooting habits", () => {
    const stats = makeStats();
    stats.weekdayStats = [
      { label: "Mon", count: 5 },
      { label: "Sun", count: 5 },
    ];
    stats.lensTypeStats = { prime: 5, zoom: 5, unknown: 0 };

    expect(
      buildExploreFunStats(stats)
        .slice(0, 2)
        .map((card) => card.value),
    ).toEqual(["All-week shooter", "Balanced bag"]);
  });
});
