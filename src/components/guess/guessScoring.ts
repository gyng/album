export const MAX_SCORE = 5000;
/** Distance in km at which score reaches 0. */
export const ZERO_DISTANCE = 500;
const LOG_DIVISOR = Math.log(1 + ZERO_DISTANCE);

export const MAX_TIME_BONUS = 1000;

/**
 * Single source of truth for the guess-game tier colours.
 *
 * These mirror the --c-success / --c-warning / --c-danger design tokens, but
 * are duplicated here as raw hex because they are consumed in contexts that
 * cannot resolve CSS custom properties: the confetti <canvas> and the MapLibre
 * `line-color` paint property. CSS modules should reference the tokens directly;
 * only canvas/MapLibre code should import these constants.
 */
export const TIER_SUCCESS = "#22c55e";
export const TIER_WARNING = "#eab308";
export const TIER_DANGER = "#ef4444";

export const computeScore = (distanceKm: number): number =>
  Math.round(MAX_SCORE * Math.max(0, 1 - Math.log(1 + distanceKm) / LOG_DIVISOR));

export const computeTimeBonus = (
  timeLimit: number | null,
  timeRemaining: number | null,
): number => {
  if (!timeLimit || timeRemaining === null) return 0;
  return Math.round(MAX_TIME_BONUS * (timeRemaining / timeLimit));
};

export const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString()} km`;
};

/** 0–1 ratio for the score bar width (distance portion only). */
export const scoreRatio = (score: number): number => score / MAX_SCORE;

/**
 * Returns a CSS colour based on score tier. Used in DOM inline styles, so it
 * returns design-token references (theme-aware via light-dark()) rather than
 * raw hex. For canvas/MapLibre contexts that cannot resolve CSS vars, use the
 * TIER_* hex constants above instead.
 */
export const scoreTierColour = (score: number): string => {
  const ratio = score / MAX_SCORE;
  if (ratio >= 0.7) return "var(--c-success)";
  if (ratio >= 0.35) return "var(--c-warning)";
  return "var(--c-accent)";
};
