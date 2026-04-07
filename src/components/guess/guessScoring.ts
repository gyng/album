export const MAX_SCORE = 5000;
/** Distance in km at which score reaches 0. */
export const ZERO_DISTANCE = 500;
const LOG_DIVISOR = Math.log(1 + ZERO_DISTANCE);

export const MAX_TIME_BONUS = 1000;

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

/** Returns a CSS colour based on score tier. */
export const scoreTierColour = (score: number): string => {
  const ratio = score / MAX_SCORE;
  if (ratio >= 0.7) return "#22c55e";
  if (ratio >= 0.35) return "#eab308";
  return "var(--c-accent)";
};
