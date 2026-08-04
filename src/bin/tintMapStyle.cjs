// Wears a basemap in another palette.
//
// The gallery style is real cartography — seventy-five layers of roads, labels,
// icons and casings — and composing something that good per theme is not
// realistic. So the theme styles are that style, retinted: every colour in it
// is read for how light it is and where its hue sits, then placed on the
// theme's own ramp. Structure survives, palette changes.

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB = /^rgba?\(([^)]+)\)$/i;
const HSL = /^hsla?\(([^)]+)\)$/i;

/** Water is a hue, not a layer: a style names it in a dozen places. */
const WATER_HUE = { min: 170, max: 265, minSaturation: 0.08 };

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const parseHex = (raw) => {
  const digits = HEX.exec(raw)?.[1];
  if (!digits) return null;
  const full =
    digits.length <= 4
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const value = (offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
  return {
    r: value(0),
    g: value(2),
    b: value(4),
    a: full.length === 8 ? value(6) : 1,
  };
};

const parseNumbers = (body) =>
  body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part)));

/** Only the notations a style sheet actually uses; anything else is left alone. */
const parseColour = (raw) => {
  if (typeof raw !== "string") return null;
  const value = raw.trim();

  const hex = parseHex(value);
  if (hex) return hex;

  const rgb = RGB.exec(value);
  if (rgb) {
    const [r = 0, g = 0, b = 0, a = 1] = parseNumbers(rgb[1]);
    // A percentage channel parses to 0–1 already; a plain one is 0–255.
    const scale = (channel) => (channel > 1 ? channel / 255 : channel);
    return { r: scale(r), g: scale(g), b: scale(b), a };
  }

  const hsl = HSL.exec(value);
  if (hsl) {
    const [h = 0, s = 0, l = 0, a = 1] = parseNumbers(hsl[1]);
    return { ...hslToRgb(h, clamp01(s), clamp01(l)), a };
  }

  return null;
};

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const sectors = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  // `section` is already wrapped into 0–6, so the index is always in range.
  const [r, g, b] = sectors[Math.floor(section) % 6].map(
    (channel) => channel + lightness - chroma / 2,
  );
  return { r, g, b };
}

const toHsl = ({ r, g, b }) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === r
      ? 60 * (((g - b) / delta) % 6)
      : max === g
        ? 60 * ((b - r) / delta + 2)
        : 60 * ((r - g) / delta + 4);
  return { h: ((hue % 360) + 360) % 360, s: saturation, l: lightness };
};

/**
 * Back to something a style sheet can hold: hex when it is opaque, `rgba()`
 * when it is not. Not eight-digit hex — a halo that a colour parser silently
 * rejects is a label with no halo, and `rgba()` has been understood forever.
 */
const toCssColour = ({ r, g, b, a = 1 }) => {
  const byte = (value) => Math.round(clamp01(value) * 255);
  if (a < 1) {
    return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${Number(clamp01(a).toFixed(3))})`;
  }
  const hex = (value) => byte(value).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
};

const mix = (from, to, amount) => ({
  r: from.r + (to.r - from.r) * amount,
  g: from.g + (to.g - from.g) * amount,
  b: from.b + (to.b - from.b) * amount,
});

/**
 * One colour, moved onto the theme's ramp.
 *
 * What is preserved is a colour's place on the style's ramp, not its luminance:
 * ground-like stays ground-like and ink-like stays ink-like, and the ends of
 * the ramp become the theme's. On a dark theme that inverts every value, which
 * is exactly the intent — paper-white land has to come out near-black. Water
 * keeps a ramp of its own, or a dark theme turns the sea into more land.
 */
const tintColour = (raw, palette) => {
  const colour = parseColour(raw);
  if (!colour) return raw;

  const { h, s, l } = toHsl(colour);
  const isWater = h >= WATER_HUE.min && h <= WATER_HUE.max && s >= WATER_HUE.minSaturation;

  const land = parseColour(palette.land);
  const label = parseColour(palette.label);
  const water = parseColour(palette.water);
  if (!land || !label || !water) return raw;

  // Water gets both ends of a ramp of its own, or every sea, lake and river in
  // the style flattens to one colour. Its deep end is the theme's water pulled
  // towards the theme's ink.
  const light = isWater ? water : land;
  const dark = isWater ? mix(water, label, 0.45) : label;

  return toCssColour({ ...mix(dark, light, clamp01(l)), a: colour.a });
};

/** Paint properties are the only place a colour can be. */
const isColourKey = (key) => /-color$/i.test(key);

const tintValue = (value, palette) => {
  if (typeof value === "string") return tintColour(value, palette);
  if (Array.isArray(value)) return value.map((item) => tintValue(item, palette));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, tintValue(item, palette)]),
    );
  }
  return value;
};

/** The whole style, wearing the theme. */
const tintMapStyle = (style, palette, name) => ({
  ...style,
  ...(name ? { name } : {}),
  layers: style.layers.map((layer) => ({
    ...layer,
    ...(layer.paint
      ? {
          paint: Object.fromEntries(
            Object.entries(layer.paint).map(([key, value]) => [
              key,
              isColourKey(key) ? tintValue(value, palette) : value,
            ]),
          ),
        }
      : {}),
  })),
});

module.exports = { parseColour, toHsl, toCssColour, tintColour, tintMapStyle };
