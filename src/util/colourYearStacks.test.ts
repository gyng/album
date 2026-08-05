import { buildColourYearStacks } from "./colourYearStacks";
import type { PhotoStats } from "./computeStats";

const slice = (
  family: string,
  count = 1,
): PhotoStats["colorYearRibbons"][number]["slices"][number] => ({
  rgb: "rgb(1, 2, 3)",
  family,
  count,
  position: 0.5,
  dateLabel: "1 May 2024",
  thumbSrc: "/a.avif",
  photoLabel: "a.jpg",
});

const year = (
  label: string,
  slices: PhotoStats["colorYearRibbons"][number]["slices"],
): PhotoStats["colorYearRibbons"][number] => ({
  label,
  total: slices.length,
  dominantFamily: slices[0]?.family ?? null,
  slices,
});

const ORDER = ["Red", "Green", "Blue"];

describe("buildColourYearStacks", () => {
  it("counts each year's photographs by family", () => {
    const stacks = buildColourYearStacks(
      [year("2024", [slice("Red"), slice("Blue"), slice("Red")])],
      ORDER,
    );

    expect(stacks[0]?.total).toBe(3);
    expect(stacks[0]?.families).toEqual([
      { family: "Red", count: 2, share: (2 / 3) * 100 },
      { family: "Blue", count: 1, share: (1 / 3) * 100 },
    ]);
  });

  // A family has to sit in the same place in every bar, or a reader cannot
  // follow it from one year to the next — which is the only thing this view
  // does that the ribbon does not.
  it("keeps families in one order whatever order a year happened in", () => {
    const stacks = buildColourYearStacks(
      [
        year("2024", [slice("Blue"), slice("Red")]),
        year("2025", [slice("Green"), slice("Blue"), slice("Red")]),
      ],
      ORDER,
    );

    expect(stacks[0]?.families.map((entry) => entry.family)).toEqual(["Red", "Blue"]);
    expect(stacks[1]?.families.map((entry) => entry.family)).toEqual(["Red", "Green", "Blue"]);
  });

  // Shares rather than counts, because the archive's years are not the same
  // size: 2024's three hundred photographs would dwarf 2011's twelve.
  it("reports each family as a share of its own year", () => {
    const stacks = buildColourYearStacks(
      [
        year(
          "2024",
          Array.from({ length: 4 }, () => slice("Red")),
        ),
      ],
      ORDER,
    );

    expect(stacks[0]?.families[0]?.share).toBe(100);
  });

  it("adds up a slice that stands for several photographs", () => {
    const stacks = buildColourYearStacks([year("2024", [slice("Red", 5), slice("Red", 3)])], ORDER);

    expect(stacks[0]).toMatchObject({ total: 8, families: [{ family: "Red", count: 8 }] });
  });

  it("keeps a family the order does not name rather than dropping it", () => {
    const stacks = buildColourYearStacks([year("2024", [slice("Puce"), slice("Red")])], ORDER);

    expect(stacks[0]?.families.map((entry) => entry.family)).toEqual(["Red", "Puce"]);
  });

  it("has nothing to stack for a year with nothing in it", () => {
    expect(buildColourYearStacks([year("2024", [])], ORDER)).toEqual([
      { label: "2024", total: 0, families: [] },
    ]);
    expect(buildColourYearStacks([], ORDER)).toEqual([]);
  });
});
