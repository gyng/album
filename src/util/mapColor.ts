/**
 * Marker/route colour encoding for the world map.
 *
 * Recency (0 = oldest photo, 1 = newest) is the single variable colour encodes,
 * carried by two reinforcing channels so it reads as an *ordered* ramp rather
 * than an unordered rainbow:
 *   - hue: newest = red (0°) → oldest = blue (220°). The spectral ramp is kept
 *     but reversed so that red = newer.
 *   - lightness (+ a gentle saturation fade): newest = rich and deep, oldest =
 *     pale and desaturated ("old photos fade"). Lightness is the strongest
 *     ordered channel and the one colour-blind viewers rely on, so it is the
 *     cue that makes the ramp legible without a legend.
 *
 * Grouping (which trip) is not carried by colour — it is read from the journey
 * line connecting a trip's markers.
 */

const OLDEST_HUE = 220; // blue
const NEWEST_HUE = 0; // red

const OLDEST_SATURATION = 58;
const NEWEST_SATURATION = 88;

const OLDEST_LIGHTNESS = 60; // pale / faded
const NEWEST_LIGHTNESS = 44; // rich / deep

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/**
 * Map a recency ratio (0 = oldest, 1 = newest) to a marker colour.
 * Out-of-range and non-finite inputs resolve to the oldest end (never NaN).
 */
export const recencyColor = (relative: number): string => {
  const r = clamp01(relative);
  const hue = lerp(OLDEST_HUE, NEWEST_HUE, r);
  const saturation = lerp(OLDEST_SATURATION, NEWEST_SATURATION, r);
  const lightness = lerp(OLDEST_LIGHTNESS, NEWEST_LIGHTNESS, r);
  return `hsl(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
};

/**
 * Evenly spaced stops across the recency ramp, oldest → newest, for rendering
 * the legend gradient. `count` is the number of stops (minimum 2).
 */
export const recencyGradientStops = (
  count = 7,
): { offset: number; color: string }[] => {
  const stops = Math.max(2, Math.floor(count));
  return Array.from({ length: stops }, (_, index) => {
    const offset = index / (stops - 1);
    return { offset, color: recencyColor(offset) };
  });
};

/** CSS `linear-gradient(...)` value for the legend bar (oldest → newest). */
export const recencyGradientCss = (
  angle = "90deg",
  count = 7,
): string => {
  const stops = recencyGradientStops(count)
    .map((stop) => `${stop.color} ${(stop.offset * 100).toFixed(0)}%`)
    .join(", ");
  return `linear-gradient(${angle}, ${stops})`;
};

const parseHsl = (
  color: string,
): { hue: number; saturation: number; lightness: number } | null => {
  const match = color.match(
    /hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)/,
  );
  if (!match) {
    return null;
  }
  const hue = Number.parseFloat(match[1] ?? "");
  const saturation = Number.parseFloat(match[2] ?? "");
  const lightness = Number.parseFloat(match[3] ?? "");
  if ([hue, saturation, lightness].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { hue, saturation, lightness };
};

/**
 * Blend two `hsl()` recency colours in HSL space. Hue is lerped directly (not
 * via the shortest arc) so the blend follows the same spectral path as the
 * recency ramp — a blue→red mix passes through green, matching the markers.
 * Falls back to `from` if either colour is not a parseable `hsl()` string.
 */
export const mixHsl = (from: string, to: string, t: number): string => {
  const a = parseHsl(from);
  const b = parseHsl(to);
  if (!a || !b) {
    return from;
  }
  const ratio = clamp01(t);
  const hue = lerp(a.hue, b.hue, ratio);
  const saturation = lerp(a.saturation, b.saturation, ratio);
  const lightness = lerp(a.lightness, b.lightness, ratio);
  return `hsl(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
};
