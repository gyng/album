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
 *
 * The ramp's two ends are a parameter, because some basemaps are not a ground
 * a spectral rainbow can sit on: a phosphor tube has one colour and a cyanotype
 * has one ink, and fourteen hundred red-to-blue dots on either read as a fault
 * rather than as data. Those styles supply their own two ends and keep the
 * encoding — lightness, the channel that actually carries the order, survives
 * going monochrome, which is the whole reason it is the primary cue.
 */

import type { MapStyleName } from "./mapStyles";

type RampEnd = { hue: number; saturation: number; lightness: number };

export type RecencyRamp = { oldest: RampEnd; newest: RampEnd };

export const DEFAULT_RECENCY_RAMP: RecencyRamp = {
  // blue, pale and faded
  oldest: { hue: 220, saturation: 58, lightness: 60 },
  // red, rich and deep
  newest: { hue: 0, saturation: 88, lightness: 44 },
};

/**
 * The basemaps whose own light the pins have to be in.
 *
 * Deliberately short: a paper map takes the spectral ramp perfectly well, and
 * every style with a ramp of its own here is one where the default clashed with
 * the ground rather than merely differing from it.
 */
const STYLE_RECENCY_RAMPS: Partial<Record<MapStyleName, RecencyRamp>> = {
  // A tube emits one colour. Age reads as how hot the trace is.
  crt: {
    oldest: { hue: 158, saturation: 42, lightness: 34 },
    newest: { hue: 96, saturation: 96, lightness: 66 },
  },
  // Two of the lights the map is already made of, so a pin is signage on the
  // same street rather than a sticker over it.
  neon: {
    oldest: { hue: 189, saturation: 92, lightness: 52 },
    newest: { hue: 318, saturation: 96, lightness: 63 },
  },
  // Cyanotype has one ink and the paper it was not exposed through: age is how
  // near the pin is to bare white.
  blueprint: {
    oldest: { hue: 208, saturation: 48, lightness: 48 },
    newest: { hue: 202, saturation: 90, lightness: 90 },
  },
};

/** The halo that lifts a pin off the ground it sits on. */
const STYLE_PIN_HALOES: Partial<Record<MapStyleName, string>> = {
  crt: "rgba(4, 18, 10, 0.85)",
  neon: "rgba(4, 6, 14, 0.8)",
  blueprint: "rgba(10, 32, 56, 0.8)",
};

const DEFAULT_PIN_HALO = "rgba(255, 255, 255, 0.84)";

export const recencyRampFor = (style: MapStyleName | null | undefined): RecencyRamp =>
  (style ? STYLE_RECENCY_RAMPS[style] : undefined) ?? DEFAULT_RECENCY_RAMP;

/**
 * A white ring is what separates a pin from a light ground; on a near-black one
 * it is the brightest thing on the map, and the pins stop being the subject.
 */
export const pinHaloFor = (style: MapStyleName | null | undefined): string =>
  (style ? STYLE_PIN_HALOES[style] : undefined) ?? DEFAULT_PIN_HALO;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Map a recency ratio (0 = oldest, 1 = newest) to a marker colour.
 * Out-of-range and non-finite inputs resolve to the oldest end (never NaN).
 */
export const recencyColor = (
  relative: number,
  ramp: RecencyRamp = DEFAULT_RECENCY_RAMP,
): string => {
  const r = clamp01(relative);
  const hue = lerp(ramp.oldest.hue, ramp.newest.hue, r);
  const saturation = lerp(ramp.oldest.saturation, ramp.newest.saturation, r);
  const lightness = lerp(ramp.oldest.lightness, ramp.newest.lightness, r);
  return `hsl(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
};

/**
 * Evenly spaced stops across the recency ramp, oldest → newest, for rendering
 * the legend gradient. `count` is the number of stops (minimum 2).
 */
export const recencyGradientStops = (
  count = 7,
  ramp: RecencyRamp = DEFAULT_RECENCY_RAMP,
): { offset: number; color: string }[] => {
  const stops = Math.max(2, Math.floor(count));
  return Array.from({ length: stops }, (_, index) => {
    const offset = index / (stops - 1);
    return { offset, color: recencyColor(offset, ramp) };
  });
};

/** CSS `linear-gradient(...)` value for the legend bar (oldest → newest). */
export const recencyGradientCss = (
  angle = "90deg",
  count = 7,
  ramp: RecencyRamp = DEFAULT_RECENCY_RAMP,
): string => {
  const stops = recencyGradientStops(count, ramp)
    .map((stop) => `${stop.color} ${(stop.offset * 100).toFixed(0)}%`)
    .join(", ");
  return `linear-gradient(${angle}, ${stops})`;
};

const parseHsl = (color: string): { hue: number; saturation: number; lightness: number } | null => {
  const match = color.match(/hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)/);
  if (!match) {
    return null;
  }
  // The required numeric capture groups are guaranteed by the regex.
  const hue = Number.parseFloat(match[1]!);
  const saturation = Number.parseFloat(match[2]!);
  const lightness = Number.parseFloat(match[3]!);
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
