import Fraction from "fraction.js";

export const formatExposureTime = (seconds: number): string => {
  if (seconds >= 1) return `${seconds}s`;
  const fraction = new Fraction(seconds);
  return fraction.n === BigInt(1) ? `1⁄${fraction.d}s` : `${seconds.toPrecision(3)}s`;
};
