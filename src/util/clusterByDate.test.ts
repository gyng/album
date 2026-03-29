import {
  findClustersAroundSeeds,
  formatMemoryDateRange,
  getMemoryClusters,
} from "./clusterByDate";

type Item = {
  id: string;
  date: string;
};

describe("findClustersAroundSeeds", () => {
  it("expands a seed date to include the full adjacent cluster", () => {
    const items: Item[] = [
      { id: "a", date: "2023-03-01" },
      { id: "b", date: "2023-03-03" },
      { id: "c", date: "2023-03-06" },
      { id: "d", date: "2023-03-10" },
    ];

    const clusters = findClustersAroundSeeds(items, new Set(["2023-03-03"]));

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.startDate).toBe("2023-03-01");
    expect(clusters[0]?.endDate).toBe("2023-03-06");
    expect(clusters[0]?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("returns multiple matching clusters from the same year when seeds are disjoint", () => {
    const items: Item[] = [
      { id: "a", date: "2023-03-01" },
      { id: "b", date: "2023-03-02" },
      { id: "c", date: "2023-03-20" },
      { id: "d", date: "2023-03-22" },
    ];

    const clusters = findClustersAroundSeeds(
      items,
      new Set(["2023-03-01", "2023-03-20"]),
    );

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.startDate)).toEqual([
      "2023-03-01",
      "2023-03-20",
    ]);
  });

  it("does not cross gaps larger than the max cluster size", () => {
    const items: Item[] = [
      { id: "a", date: "2023-03-01" },
      { id: "b", date: "2023-03-04" },
      { id: "c", date: "2023-03-08" },
    ];

    const clusters = findClustersAroundSeeds(items, new Set(["2023-03-01"]));

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("getMemoryClusters", () => {
  it("finds prior-year clusters around the same time and excludes the current year", () => {
    const items: Item[] = [
      { id: "current", date: "2026-03-15" },
      { id: "a", date: "2025-03-10" },
      { id: "b", date: "2025-03-13" },
      { id: "c", date: "2025-03-16" },
      { id: "d", date: "2024-03-18" },
      { id: "e", date: "2024-03-19" },
      { id: "f", date: "2024-05-02" },
    ];

    const clusters = getMemoryClusters(items, "2026-03-15");

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.year)).toEqual([2025, 2024]);
    expect(clusters[0]?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(clusters[1]?.items.map((item) => item.id)).toEqual(["d", "e"]);
  });

  it("handles a seed window that wraps across the end of the year", () => {
    const items: Item[] = [
      { id: "a", date: "2025-12-25" },
      { id: "b", date: "2025-12-28" },
      { id: "c", date: "2025-01-03" },
      { id: "d", date: "2025-01-05" },
      { id: "e", date: "2024-12-30" },
    ];

    const clusters = getMemoryClusters(items, "2026-01-07");

    expect(clusters).toHaveLength(3);
    expect(clusters.map((cluster) => cluster.items.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });
});

describe("formatMemoryDateRange", () => {
  it("formats same-month and cross-month ranges", () => {
    expect(formatMemoryDateRange("2024-03-18", "2024-03-28")).toBe(
      "Mar 18 - 28, 2024",
    );
    expect(formatMemoryDateRange("2024-03-28", "2024-04-02")).toBe(
      "Mar 28 - Apr 2, 2024",
    );
    expect(formatMemoryDateRange("2024-03-22", "2024-03-22")).toBe(
      "Mar 22, 2024",
    );
  });
});
