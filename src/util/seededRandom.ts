/** Hash a string to a 32-bit integer for use as a PRNG seed. */
export const hashSeed = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
};

/** Simple seeded PRNG (mulberry32). */
export const mulberry32 = (seed: number): (() => number) => {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A repeatable `Math.random` replacement: the same seed yields the same sequence. */
export const seededRandom = (seed: string): (() => number) => mulberry32(hashSeed(seed));
