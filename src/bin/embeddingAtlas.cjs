// Where each photograph sits on the contact sheet.
//
// The cloud on the explore page draws fifteen hundred photographs at about
// forty pixels each. Fetched one by one that is fifteen hundred requests and,
// at the smallest variant this site publishes, roughly a hundred and fifty
// megabytes — so instead they are packed into a single sheet the browser
// fetches once and draws from.
//
// This module is the arithmetic of that packing, kept apart from the encoder so
// it can be tested without one.

/** One cell, in pixels. Twice the size a thumbnail is drawn at, for sharp screens. */
const CELL = 48;

/**
 * The sheet's side, in pixels.
 *
 * 2048 is the texture size every GPU and every decoder is comfortable with, and
 * at this cell size it holds 1,764 photographs — the whole collection on one
 * sheet, with room to grow before a second is needed.
 */
const SHEET = 2048;

const PER_ROW = Math.floor(SHEET / CELL);
const PER_SHEET = PER_ROW * PER_ROW;

/** Where a slot lands: which sheet, and where on it. */
const slotPosition = (slot) => ({
  sheet: Math.floor(slot / PER_SHEET),
  x: (slot % PER_ROW) * CELL,
  y: Math.floor((slot % PER_SHEET) / PER_ROW) * CELL,
});

/**
 * The layout for a set of photographs.
 *
 * Sorted by path rather than left in whatever order the disk gave them, so a
 * build that runs twice writes the same sheet: an atlas that reshuffled itself
 * would be a megabyte of cache invalidated for nothing.
 *
 * @param {string[]} paths indexed paths, as the database keys photographs.
 * @returns {{cell: number, sheet: number, perSheet: number, sheets: number,
 *   slots: Record<string, number>, placements: Array<{path: string, slot: number,
 *   sheet: number, x: number, y: number}>}}
 */
const planAtlas = (paths) => {
  const ordered = [...new Set(paths)].sort();
  const placements = ordered.map((path, slot) => ({ path, slot, ...slotPosition(slot) }));

  return {
    cell: CELL,
    sheet: SHEET,
    perSheet: PER_SHEET,
    sheets: Math.max(1, Math.ceil(ordered.length / PER_SHEET)),
    slots: Object.fromEntries(placements.map((placement) => [placement.path, placement.slot])),
    placements,
  };
};

/** What a reader needs to find a photograph on the sheets, without the placements. */
const atlasManifest = (plan, files) => ({
  cell: plan.cell,
  sheet: plan.sheet,
  perSheet: plan.perSheet,
  files,
  slots: plan.slots,
});

module.exports = { CELL, SHEET, PER_ROW, PER_SHEET, planAtlas, slotPosition, atlasManifest };
