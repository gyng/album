import { justifiedRows } from "./justifiedRows";

describe("justifiedRows", () => {
  // The whole point of the layout: every frame keeps its own shape, and the
  // rows still reach both edges.
  it("fills the width exactly and keeps each frame's proportions", () => {
    const aspects = [1.5, 1.5, 0.66, 1.5, 1.5, 0.66];
    const layout = justifiedRows(aspects, 1000, 200, 8);

    const full = layout.rows.slice(0, -1);
    expect(full.length).toBeGreaterThan(0);

    for (const row of full) {
      const items = layout.items.slice(row.from, row.to);
      const spanned = items.reduce((sum, item) => sum + item.width, 0) + 8 * (items.length - 1);
      expect(Math.round(spanned)).toBe(1000);

      for (const item of items) {
        const aspect = aspects[item.index]!;
        // The last frame absorbs the rounding, so it is checked loosely.
        const isLast = item.index === items[items.length - 1]?.index;
        if (!isLast) expect(item.width / item.height).toBeCloseTo(aspect, 2);
      }
    }
  });

  // A row of two, pulled across the whole width, would be enormous for no
  // reason but arithmetic.
  it("leaves the last row at the height it asked for", () => {
    const layout = justifiedRows([1.5, 1.5, 1.5, 1.5, 1.5], 1000, 200, 8);
    const last = layout.rows.at(-1)!;

    expect(last.height).toBe(200);
  });

  it("stacks rows down the page and reports where they end", () => {
    const layout = justifiedRows(
      Array.from({ length: 12 }, () => 1.5),
      900,
      150,
      10,
    );

    expect(layout.rows[0]?.top).toBe(0);
    for (let index = 1; index < layout.rows.length; index += 1) {
      const previous = layout.rows[index - 1]!;
      expect(layout.rows[index]?.top).toBeCloseTo(previous.top + previous.height + 10, 5);
    }
    const bottom = layout.rows.at(-1)!;
    expect(layout.total).toBeCloseTo(bottom.top + bottom.height, 5);
  });

  // A photograph with no dimensions in the payload is still a photograph.
  it("gives a frame with no shape a sensible one", () => {
    const layout = justifiedRows([0, 0, 0], 600, 100, 0);

    for (const item of layout.items) {
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });

  it("has no rows to lay out before it has been measured", () => {
    expect(justifiedRows([1.5], 0, 200, 8)).toEqual({ items: [], rows: [], total: 0 });
    expect(justifiedRows([], 800, 200, 8).items).toEqual([]);
  });
});
