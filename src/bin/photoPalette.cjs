// A map palette derived from the photographs on it.
//
// Every indexed photograph carries a dominant-colour palette, so the site
// already knows what its own pictures look like: warm brick and neon in Tokyo,
// slate and moss in Iceland, and a particular washed blue that turns out to be
// most of the sea. This turns those thousands of colours into the three a
// basemap needs — ground, water and ink — and the tint module wears them.
//
// The colours are *modes*, never means. An average of ten thousand colours is
// mud every time; the most common colour in the corpus is a colour that was
// actually photographed.

const { toHsl, toCssColour } = require("./tintMapStyle.cjs");

/** Buckets per channel. Five is coarse enough to gather a tone, fine enough to keep it. */
const LEVELS = 5;

/** Where the corpus is split into things that could be ground, ink, or sea. */
const LIGHT_ENOUGH_FOR_GROUND = 0.55;
const DARK_ENOUGH_FOR_INK = 0.34;

/** Below this the map has no contrast to read by, whatever the photographs say. */
const MINIMUM_CONTRAST = 0.42;

/**
 * The ground prefers a colour with some life in it.
 *
 * Strictly by weight, this archive's commonest light tone is a neutral grey —
 * concrete and overcast sky, which really are what most photographs are mostly
 * made of. Faithful, and a grey card to look at. So a tone with actual chroma
 * takes the ground as long as the collection has plenty of it: at least this
 * saturated, and at least this much of the commonest tone's weight. Both bars
 * matter — the first alone would pick a colour, the second alone would pick the
 * grey again.
 */
const GROUND_SATURATION = 0.15;
const GROUND_WEIGHT_SHARE = 0.2;

/** Water is a hue as well as a tone; a corpus with no sea in it gets one made. */
const WATER_HUE = { min: 165, max: 270 };

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const toUnit = ([r, g, b]) => ({ r: r / 255, g: g / 255, b: b / 255 });

const bucketOf = ({ r, g, b }) =>
  [r, g, b].map((channel) => Math.min(LEVELS - 1, Math.floor(channel * LEVELS))).join(":");

/**
 * Gathers colours into buckets and reports each bucket's weight and its own
 * average colour — so the answer is a real tone from the corpus rather than a
 * quantisation step.
 */
const gather = (colours) => {
  const buckets = new Map();

  for (const { rgb, weight = 1 } of colours) {
    const unit = toUnit(rgb);
    const key = bucketOf(unit);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    bucket.weight += weight;
    bucket.r += unit.r * weight;
    bucket.g += unit.g * weight;
    bucket.b += unit.b * weight;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      weight: bucket.weight,
      colour: {
        r: bucket.r / bucket.weight,
        g: bucket.g / bucket.weight,
        b: bucket.b / bucket.weight,
      },
    }))
    .sort((a, b) => b.weight - a.weight);
};

const lightness = (colour) => toHsl(colour).l;

const saturation = (colour) => toHsl(colour).s;

const hue = (colour) => toHsl(colour).h;

/** The heaviest bucket that passes a test, or nothing. */
const heaviest = (buckets, passes) =>
  buckets.find((bucket) => passes(bucket.colour))?.colour ?? null;

const mix = (from, to, amount) => ({
  r: from.r + (to.r - from.r) * amount,
  g: from.g + (to.g - from.g) * amount,
  b: from.b + (to.b - from.b) * amount,
});

const withLightness = (colour, target) => {
  const current = lightness(colour);
  if (current === target) return colour;
  return current < target
    ? mix(colour, { r: 1, g: 1, b: 1 }, (target - current) / (1 - current))
    : mix(colour, { r: 0, g: 0, b: 0 }, (current - target) / current);
};

/**
 * Ground and ink have to be far enough apart to read, however the photographs
 * fall. A corpus shot entirely at night would otherwise produce a map of one
 * colour, technically faithful and completely useless.
 */
const separate = (land, label) => {
  const landLightness = lightness(land);
  const labelLightness = lightness(label);
  const gap = Math.abs(landLightness - labelLightness);
  if (gap >= MINIMUM_CONTRAST) return { land, label };

  const landIsLighter = landLightness >= labelLightness;
  const lighter = Math.max(landLightness, labelLightness);
  const darker = Math.min(landLightness, labelLightness);

  // Push both ends apart, then spend whatever one end could not take on the
  // other: at the extremes half the push would otherwise be clamped away, and
  // the result would still be two colours nobody can tell apart.
  let up = Math.min(1, lighter + (MINIMUM_CONTRAST - gap) / 2);
  let down = Math.max(0, darker - (MINIMUM_CONTRAST - gap) / 2);
  const shortfall = MINIMUM_CONTRAST - (up - down);
  if (shortfall > 0) {
    up = Math.min(1, up + shortfall);
    down = Math.max(0, down - (MINIMUM_CONTRAST - (up - down)));
  }

  return {
    land: withLightness(land, clamp01(landIsLighter ? up : down)),
    label: withLightness(label, clamp01(landIsLighter ? down : up)),
  };
};

/**
 * Three colours out of a corpus.
 *
 * @param {Array<{rgb: [number, number, number], weight?: number}>} colours
 * @returns {{land: string, water: string, label: string} | null} null when
 *   there is nothing to derive from, so the caller can keep its own palette.
 */
const paletteFromColours = (colours) => {
  const buckets = gather(colours.filter((entry) => Array.isArray(entry.rgb)));
  if (buckets.length === 0) return null;

  const brightest = [...buckets].sort((a, b) => lightness(b.colour) - lightness(a.colour))[0]
    .colour;
  const darkest = [...buckets].sort((a, b) => lightness(a.colour) - lightness(b.colour))[0].colour;

  const lightest = buckets.filter((bucket) => lightness(bucket.colour) >= LIGHT_ENOUGH_FOR_GROUND);
  const heaviestLight = lightest[0];
  const colourfulGround = lightest.find(
    (bucket) =>
      saturation(bucket.colour) >= GROUND_SATURATION &&
      bucket.weight >= (heaviestLight?.weight ?? 0) * GROUND_WEIGHT_SHARE,
  );
  const land = (colourfulGround ?? heaviestLight)?.colour ?? brightest;
  const ink = heaviest(buckets, (colour) => lightness(colour) <= DARK_ENOUGH_FOR_INK) ?? darkest;

  // The sea, if the corpus has one: the commonest blue-ish mid tone. Failing
  // that, the commonest saturated one, so the water is at least a colour these
  // photographs contain. Failing even that, ground and ink mixed.
  const water =
    heaviest(
      buckets,
      (colour) =>
        hue(colour) >= WATER_HUE.min && hue(colour) <= WATER_HUE.max && saturation(colour) >= 0.12,
    ) ??
    heaviest(buckets, (colour) => saturation(colour) >= 0.3) ??
    mix(land, ink, 0.45);

  const separated = separate(land, ink);

  return {
    land: toCssColour(separated.land),
    water: toCssColour(water),
    label: toCssColour(separated.label),
  };
};

/**
 * The palettes as the indexer stores them: `[(r, g, b), (r, g, b), …]`, most
 * dominant first. Rank is the weight — a photograph's first colour is what the
 * photograph looks like, and its ninth is a corner of it.
 */
const coloursFromPaletteStrings = (rows) =>
  rows.flatMap((row) => {
    const matches = String(row).matchAll(/\((\d+),\s*(\d+),\s*(\d+)\)/g);
    return [...matches].map((match, rank) => ({
      rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
      weight: 1 / (rank + 1),
    }));
  });

module.exports = { paletteFromColours, coloursFromPaletteStrings, MINIMUM_CONTRAST };
