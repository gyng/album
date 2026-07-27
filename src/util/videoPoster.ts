import type { OptimisedPhoto } from "../services/types";

/**
 * Choose the poster variant to render at a given display width. A poster is
 * only ever a still that the viewer replaces the moment they press play, so it
 * takes the largest variant that fits rather than the sharpest available.
 */
export const pickPosterVariant = (
  srcset: OptimisedPhoto[] | undefined,
  targetWidth: number,
): OptimisedPhoto | undefined => {
  if (!srcset || srcset.length === 0) {
    return undefined;
  }

  const ascending = [...srcset].sort((a, b) => a.width - b.width);
  const fitting = ascending.filter((variant) => variant.width <= targetWidth);
  return fitting.at(-1) ?? ascending[0];
};
