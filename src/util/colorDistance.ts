/**
 * RGB to LAB color space conversion and Delta E color distance calculation.
 * LAB is perceptually uniform - Euclidean distance corresponds to perceived color difference.
 */

export type RGB = [number, number, number];
export type LAB = [number, number, number];

/**
 * Convert RGB color to LAB color space.
 * @param r Red component (0-255)
 * @param g Green component (0-255)
 * @param b Blue component (0-255)
 * @returns [L, a, b] in LAB color space
 */
export function rgbToLab(r: number, g: number, blue: number): LAB {
  // Step 1: RGB to XYZ
  let rNorm = r / 255;
  let gNorm = g / 255;
  let bNorm = blue / 255;

  // Gamma correction (sRGB to linear RGB)
  rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  // Linear RGB to XYZ (D65 illuminant)
  const x = rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375;
  const y = rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.072175;
  const z = rNorm * 0.0193339 + gNorm * 0.119192 + bNorm * 0.9503041;

  // Step 2: XYZ to LAB
  // D65 standard illuminant
  const xNorm = x / 0.95047;
  const yNorm = y / 1.0;
  const zNorm = z / 1.08883;

  const fx = xNorm > 0.008856 ? Math.pow(xNorm, 1 / 3) : 7.787 * xNorm + 16 / 116;
  const fy = yNorm > 0.008856 ? Math.pow(yNorm, 1 / 3) : 7.787 * yNorm + 16 / 116;
  const fz = zNorm > 0.008856 ? Math.pow(zNorm, 1 / 3) : 7.787 * zNorm + 16 / 116;

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [L, a, b];
}

/**
 * Calculate Delta E (CIE76) color distance between two LAB colors.
 * Lower values = more similar colors.
 * @param lab1 First LAB color
 * @param lab2 Second LAB color
 * @returns Delta E distance (0 = identical, higher = more different)
 */
export function deltaE(lab1: LAB, lab2: LAB): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  return Math.sqrt(Math.pow(L1 - L2, 2) + Math.pow(a1 - a2, 2) + Math.pow(b1 - b2, 2));
}

/**
 * Parse color palette from database JSON format.
 * Format: "[(12, 34, 56), (78, 90, 12)]"
 * @param colorString Color string from database
 * @returns Array of RGB tuples
 */
export function parseColorPalette(colorString: string): RGB[] {
  try {
    // Convert Python tuple format to JSON array format
    const jsonString = colorString.replaceAll("(", "[").replaceAll(")", "]");
    return JSON.parse(jsonString) as RGB[];
  } catch {
    return [];
  }
}

/**
 * Calculate minimum color distance from a query color to any color in a palette.
 * @param queryRgb Query RGB color
 * @param paletteRgbs Array of palette RGB colors
 * @returns Minimum Delta E distance, or Infinity if palette is empty
 */
export function minColorDistance(queryRgb: RGB, paletteRgbs: RGB[]): number {
  if (paletteRgbs.length === 0) {
    return Infinity;
  }

  const queryLab = rgbToLab(...queryRgb);
  let minDistance = Infinity;

  for (const rgb of paletteRgbs) {
    const lab = rgbToLab(...rgb);
    const distance = deltaE(queryLab, lab);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}
