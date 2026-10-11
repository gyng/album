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

  return width >= height
    ? `≈${(width / height).toFixed(2)}:1`
    : `≈1:${(height / width).toFixed(2)}`;
};
