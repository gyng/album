const trimmed = (value: number): string => String(Number(value.toFixed(1)));

const range = (low: number, high: number): string =>
  low === high ? trimmed(low) : `${trimmed(low)}–${trimmed(high)}`;

/**
 * EXIF's LensInfo — shortest and longest focal length, then the widest
 * aperture at each — as a reader would write the lens: "23mm f/1.4",
 * "18–55mm f/2.8–4". A value already in words is returned as it is.
 */
export const formatLensInfo = (lensInfo: number[] | string | undefined): string | undefined => {
  if (typeof lensInfo === "string") return lensInfo.trim() || undefined;
  if (!Array.isArray(lensInfo) || lensInfo.length < 4) return undefined;
  const [shortest, longest, wideAtShortest, wideAtLongest] = lensInfo as [
    number,
    number,
    number,
    number,
  ];
  if (!(shortest > 0 && longest >= shortest)) return undefined;
  const focal = `${range(shortest, longest)}mm`;
  return wideAtShortest > 0
    ? `${focal} f/${range(wideAtShortest, Math.max(wideAtShortest, wideAtLongest || 0))}`
    : focal;
};
