import { fillYearRange } from "./yearRange";

describe("fillYearRange", () => {
  // A year with no photographs is a fact about the archive; skipping its row
  // puts 2019 against 2022 as though nothing had happened in between.
  it("keeps the silent years in the axis", () => {
    const filled = fillYearRange(
      new Map([
        ["2019", 4],
        ["2022", 7],
      ]),
      () => 0,
    );

    expect(filled).toEqual([
      ["2019", 4],
      ["2020", 0],
      ["2021", 0],
      ["2022", 7],
    ]);
  });

  it("orders years even when they arrived out of order", () => {
    const filled = fillYearRange(
      new Map([
        ["2024", 1],
        ["2023", 2],
      ]),
      () => 0,
    );

    expect(filled.map(([year]) => year)).toEqual(["2023", "2024"]);
  });

  it("has no range to fill when there is nothing in it", () => {
    expect(fillYearRange(new Map<string, number>(), () => 0)).toEqual([]);
  });
});
