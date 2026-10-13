const STANDARD_RATIOS = [
  [3, 2],
  [4, 3],
  [5, 4],
  [16, 9],
  [8, 5],
  [7, 5],
  [7, 3],
  [2, 1],
  [3, 1],
] as const;

export const formatAspectRatio = (width: number, height: number): string => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return "—";
  }

  let divisor = width;
  let remainder = height;
  while (remainder !== 0) {
    [divisor, remainder] = [remainder, divisor % remainder];
  }

  const horizontal = width / divisor;
  const vertical = height / divisor;
  if (Math.max(horizontal, vertical) <= 20) {
    return `${horizontal}:${vertical}`;
  }

  // Rounding and small sensor margins should not split a familiar format into a new bucket.
  // A 0.5% tolerance includes 4080×3072 phone frames in 4:3 without merging distinct crops.
  const landscape = width >= height;
  const ratio = landscape ? width / height : height / width;
  for (const [long, short] of STANDARD_RATIOS) {
    const standard = long / short;
    if (Math.abs(ratio / standard - 1) <= 0.005) {
      return landscape ? `${long}:${short}` : `${short}:${long}`;
    }
  }

  // Three decimals distinguish an actual crop from a nearby standard format.
  return width >= height ? `≈${ratio.toFixed(3)}:1` : `≈1:${ratio.toFixed(3)}`;
};
