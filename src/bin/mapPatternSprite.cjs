// The ink a printed map is made of.
//
// `fill-pattern` and `background-pattern` take an image out of a sprite, and a
// sprite is the one thing a composed style cannot compose — so the patterns are
// generated here as pixels: dot screens, paper grain, scanlines, hatching.
//
// Every pattern is black at some alpha over transparency, never a colour. That
// is what makes them reusable: the colour comes from the fill underneath, and
// the pattern only darkens it, so one dot screen serves an ochre tourist print
// and a green phosphor terminal alike.

/** A deterministic bit of noise: a build that runs twice writes the same grain. */
const noise = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const transparent = (size) => new Uint8ClampedArray(size * size * 4);

const setPixel = (pixels, size, x, y, alpha) => {
  const offset = (y * size + x) * 4;
  // Black at the given alpha; the fill beneath supplies the colour.
  pixels[offset + 3] = Math.round(clamp(alpha) * 255);
};

const clamp = (value) => Math.min(1, Math.max(0, value));

/** A dot screen: one round dot per tile, the size of the dot being the tone. */
const dotScreen = ({ size = 8, radius = 2, alpha = 1 } = {}) => {
  const pixels = transparent(size);
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      // A pixel of feathering, so the dot does not alias into a square.
      const coverage = clamp(radius + 0.5 - distance);
      if (coverage > 0) {
        setPixel(pixels, size, x, y, coverage * alpha);
      }
    }
  }

  return { size, pixels };
};

/** Paper grain: speckle, dense and faint. */
const grain = ({ size = 16, alpha = 0.14, seed = 20260804 } = {}) => {
  const pixels = transparent(size);
  const random = noise(seed);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(pixels, size, x, y, random() * alpha);
    }
  }

  return { size, pixels };
};

/** Scanlines: every other row darkened, the way a phosphor tube is drawn. */
const scanlines = ({ size = 4, alpha = 0.5, lineHeight = 1 } = {}) => {
  const pixels = transparent(size);

  for (let y = 0; y < size; y += 1) {
    if (y % (lineHeight * 2) < lineHeight) {
      for (let x = 0; x < size; x += 1) {
        setPixel(pixels, size, x, y, alpha);
      }
    }
  }

  return { size, pixels };
};

/** Diagonal hatching, for a coastline that looks engraved rather than filled. */
const hatch = ({ size = 8, alpha = 0.5, spacing = 4 } = {}) => {
  const pixels = transparent(size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % spacing === 0) {
        setPixel(pixels, size, x, y, alpha);
      }
    }
  }

  return { size, pixels };
};

/**
 * Every pattern a composed style can name.
 *
 * Two dot screens rather than one: a tone is the size of its dot, so a coarse
 * screen reads as a shaded area and a fine one as paper.
 */
const PATTERNS = {
  "dot-coarse": () => dotScreen({ size: 8, radius: 2.2, alpha: 0.55 }),
  "dot-fine": () => dotScreen({ size: 6, radius: 1, alpha: 0.35 }),
  "dot-faint": () => dotScreen({ size: 10, radius: 1, alpha: 0.22 }),
  grain: () => grain({}),
  scanline: () => scanlines({}),
  "scanline-soft": () => scanlines({ size: 6, alpha: 0.28, lineHeight: 2 }),
  hatch: () => hatch({}),
};

/**
 * Lays the patterns out side by side and writes the index MapLibre reads.
 *
 * @returns {{ width: number, height: number, pixels: Uint8ClampedArray, index: object }}
 */
const buildPatternSheet = (patterns = PATTERNS) => {
  const drawn = Object.entries(patterns).map(([name, make]) => [name, make()]);
  const width = drawn.reduce((total, [, pattern]) => total + pattern.size, 0);
  const height = drawn.reduce((tallest, [, pattern]) => Math.max(tallest, pattern.size), 0);
  const sheet = new Uint8ClampedArray(width * height * 4);
  const index = {};

  let x = 0;
  for (const [name, pattern] of drawn) {
    for (let row = 0; row < pattern.size; row += 1) {
      for (let column = 0; column < pattern.size; column += 1) {
        const from = (row * pattern.size + column) * 4;
        const to = (row * width + x + column) * 4;
        sheet.set(pattern.pixels.subarray(from, from + 4), to);
      }
    }

    index[name] = { x, y: 0, width: pattern.size, height: pattern.size, pixelRatio: 1 };
    x += pattern.size;
  }

  return { width, height, pixels: sheet, index };
};

module.exports = { PATTERNS, buildPatternSheet, dotScreen, grain, scanlines, hatch };
