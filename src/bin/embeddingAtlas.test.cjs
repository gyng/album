const {
  CELL,
  PER_ROW,
  PER_SHEET,
  atlasManifest,
  planAtlas,
  slotPosition,
} = require("./embeddingAtlas.cjs");

const paths = (count) =>
  Array.from({ length: count }, (_, index) => `../albums/a/${String(index).padStart(5, "0")}.jpg`);

describe("slotPosition", () => {
  it("fills a sheet left to right, top to bottom", () => {
    expect(slotPosition(0)).toEqual({ sheet: 0, x: 0, y: 0 });
    expect(slotPosition(1)).toEqual({ sheet: 0, x: CELL, y: 0 });
    expect(slotPosition(PER_ROW)).toEqual({ sheet: 0, x: 0, y: CELL });
  });

  it("starts a new sheet when one is full", () => {
    expect(slotPosition(PER_SHEET)).toEqual({ sheet: 1, x: 0, y: 0 });
    expect(slotPosition(PER_SHEET + PER_ROW + 2)).toEqual({ sheet: 1, x: CELL * 2, y: CELL });
  });
});

describe("planAtlas", () => {
  // An atlas that reshuffled itself would invalidate a megabyte of cache for
  // nothing, so the order cannot depend on what the disk happened to return.
  it("lays photographs out in a fixed order whatever order it is given them", () => {
    const forwards = planAtlas(paths(20));
    const backwards = planAtlas([...paths(20)].reverse());

    expect(backwards.slots).toEqual(forwards.slots);
  });

  it("gives every photograph exactly one slot", () => {
    const plan = planAtlas(paths(120));

    expect(Object.keys(plan.slots)).toHaveLength(120);
    expect(new Set(Object.values(plan.slots)).size).toBe(120);
  });

  it("ignores a photograph it was given twice", () => {
    const plan = planAtlas(["../albums/a/1.jpg", "../albums/a/1.jpg", "../albums/a/2.jpg"]);

    expect(plan.placements).toHaveLength(2);
  });

  it("counts the sheets it will take", () => {
    expect(planAtlas(paths(10)).sheets).toBe(1);
    expect(planAtlas(paths(PER_SHEET)).sheets).toBe(1);
    expect(planAtlas(paths(PER_SHEET + 1)).sheets).toBe(2);
    expect(planAtlas([]).sheets).toBe(1);
  });

  it("holds this collection on a single sheet", () => {
    expect(PER_SHEET).toBeGreaterThan(1500);
  });
});

describe("atlasManifest", () => {
  it("tells a reader the cell size, the sheets and where each photograph is", () => {
    const plan = planAtlas(paths(3));
    const manifest = atlasManifest(plan, ["/data/embedding-atlas-0.avif"]);

    expect(manifest).toEqual({
      cell: plan.cell,
      sheet: plan.sheet,
      perSheet: plan.perSheet,
      files: ["/data/embedding-atlas-0.avif"],
      slots: plan.slots,
    });
    expect(manifest.placements).toBeUndefined();
  });
});
