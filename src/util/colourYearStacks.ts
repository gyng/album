import type { PhotoStats } from "./computeStats";

/**
 * Colour over time, said the other way round.
 *
 * The ribbon draws every photograph as its own sliver, which is the archive as
 * it happened: you can see a fortnight of red and the single blue frame in the
 * middle of it. What it cannot answer is whether a year was greener than the
 * one before — a hundred slivers of two similar hues do not add up by eye.
 *
 * So the same numbers stack: each year becomes one bar of colour families in a
 * fixed order, and a reader can follow a family from year to year down the
 * page. No new data — this is the ribbon's own slices, counted.
 */

export type ColourYearStack = {
  label: string;
  total: number;
  families: Array<{
    family: string;
    count: number;
    /** Per cent of that year, so bars are comparable across uneven years. */
    share: number;
  }>;
};

export const buildColourYearStacks = (
  ribbons: PhotoStats["colorYearRibbons"],
  order: readonly string[],
): ColourYearStack[] =>
  ribbons.map((year) => {
    const counts = new Map<string, number>();
    for (const slice of year.slices) {
      counts.set(slice.family, (counts.get(slice.family) ?? 0) + slice.count);
    }

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

    // The fixed order first, so a family sits in the same place in every bar and
    // can be followed down the page; anything the order does not name keeps its
    // own place at the end rather than being dropped.
    const named = order.filter((family) => counts.has(family));
    const rest = [...counts.keys()].filter((family) => !order.includes(family)).sort();

    return {
      label: year.label,
      total,
      families: [...named, ...rest].map((family) => {
        const count = counts.get(family) ?? 0;
        return {
          family,
          count,
          share: total > 0 ? (count / total) * 100 : 0,
        };
      }),
    };
  });
