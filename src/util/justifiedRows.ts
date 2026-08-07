/**
 * A wall of photographs at their own shapes, in rows that reach both edges.
 *
 * A square grid is the cheap way to lay out a contact sheet and it is a lie
 * about every frame in it: a panorama and a portrait are not the same picture
 * cropped differently. Rows of a target height, each row stretched to fill the
 * width exactly, keeps every photograph's own proportions and still leaves no
 * ragged edge — which is what a contact sheet is, and what a printed one did
 * with scissors.
 *
 * The last row is left at the target height rather than stretched: a row
 * holding two frames, pulled across the whole width, makes them enormous for
 * no reason but arithmetic.
 */

export type JustifiedItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type JustifiedLayout = {
  items: JustifiedItem[];
  /** Where each row starts in `items`, so a draw can skip whole rows. */
  rows: Array<{ top: number; height: number; from: number; to: number }>;
  total: number;
};

const DEFAULT_ASPECT = 1.5;

export const justifiedRows = (
  aspects: readonly number[],
  width: number,
  targetHeight: number,
  gap: number,
): JustifiedLayout => {
  const items: JustifiedItem[] = [];
  const rows: JustifiedLayout["rows"] = [];
  if (width <= 0 || targetHeight <= 0 || aspects.length === 0) {
    return { items, rows, total: 0 };
  }

  let row: number[] = [];
  let aspectSum = 0;
  let top = 0;

  const place = (indices: number[], sum: number, stretch: boolean) => {
    // Width available once the gaps between this row's frames are taken out.
    const usable = width - gap * Math.max(0, indices.length - 1);
    const height = stretch ? Math.max(1, usable / sum) : targetHeight;
    const from = items.length;
    let x = 0;

    indices.forEach((index) => {
      const aspect = aspects[index] ?? DEFAULT_ASPECT;
      // The last frame takes whatever is left rather than its own rounded
      // width, so a row of rounded numbers still ends exactly at the edge.
      const isLast = index === indices[indices.length - 1];
      const itemWidth = stretch && isLast ? Math.max(1, width - x) : Math.max(1, aspect * height);
      items.push({ index, x, y: top, width: itemWidth, height });
      x += itemWidth + gap;
    });

    rows.push({ top, height, from, to: items.length });
    top += height + gap;
  };

  aspects.forEach((aspect, index) => {
    row.push(index);
    aspectSum += aspect > 0 ? aspect : DEFAULT_ASPECT;

    // Full once the row's frames at the target height would overflow the width.
    const usable = width - gap * Math.max(0, row.length - 1);
    if (aspectSum * targetHeight >= usable) {
      place(row, aspectSum, true);
      row = [];
      aspectSum = 0;
    }
  });

  if (row.length > 0) place(row, aspectSum, false);

  return { items, rows, total: Math.max(0, top - gap) };
};
