const {
  CELL,
  PER_ROW,
  PER_SHEET,
  atlasManifest,
  planAtlas,
  slotPosition,
  atlasFingerprint,
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

// The atlas is the most expensive prepass by an order of magnitude — 108 seconds
// against four for everything else — and on a build that added no photographs it
// writes a byte-identical sheet. The fingerprint is what lets it not.
describe("atlasFingerprint", () => {
  const layout = { cell: 48, sheet: 2048 };
  const sources = [
    { path: "../albums/a/one.jpg", size: 100, mtimeMs: 1000 },
    { path: "../albums/a/two.jpg", size: 200, mtimeMs: 2000 },
  ];

  it("is the same for the same inputs, whatever order they arrive in", () => {
    expect(atlasFingerprint([...sources].reverse(), layout)).toBe(
      atlasFingerprint(sources, layout),
    );
  });

  it("changes when a photograph is added, removed, edited or replaced", () => {
    const base = atlasFingerprint(sources, layout);

    expect(atlasFingerprint(sources.slice(0, 1), layout)).not.toBe(base);
    expect(
      atlasFingerprint(
        [...sources, { path: "../albums/a/three.jpg", size: 1, mtimeMs: 1 }],
        layout,
      ),
    ).not.toBe(base);
    // Same name, new bytes: the size and the modification time are what say so.
    expect(atlasFingerprint([{ ...sources[0], size: 101 }, sources[1]], layout)).not.toBe(base);
    expect(atlasFingerprint([{ ...sources[0], mtimeMs: 1001 }, sources[1]], layout)).not.toBe(base);
  });

  // The layout decides which cell a photograph lands in, so changing it changes
  // the sheet even though no photograph did.
  it("changes when the layout constants change", () => {
    expect(atlasFingerprint(sources, { cell: 64, sheet: 2048 })).not.toBe(
      atlasFingerprint(sources, layout),
    );
    expect(atlasFingerprint(sources, { cell: 48, sheet: 4096 })).not.toBe(
      atlasFingerprint(sources, layout),
    );
  });

  // A sub-millisecond mtime difference is a different file to the filesystem but
  // must not be a different fingerprint every run.
  it("does not churn on sub-millisecond timestamps", () => {
    expect(atlasFingerprint([{ ...sources[0], mtimeMs: 1000.4 }], layout)).toBe(
      atlasFingerprint([{ ...sources[0], mtimeMs: 1000 }], layout),
    );
  });
});
