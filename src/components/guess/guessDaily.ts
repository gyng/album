import { localDayKey } from "../../util/gameDaily";
import { seededRandom } from "../../util/seededRandom";

// Guess Where's daily seed predates the shared `daily:<game>:<day>` format and
// stays `daily-YYYY-MM-DD`: changing it would deal a different board to
// everyone holding today's link.
export const guessDailySeed = (day: string = localDayKey()): string => `daily-${day}`;

/** The local day a daily seed was dealt for, or null for any other seed. */
export const guessDailySeedDay = (seed: string): string | null =>
  /^daily-(\d{4}-\d{2}-\d{2})$/.exec(seed)?.[1] ?? null;

/** More rows than any archive holds: a seeded game asks for its whole pool. */
export const GUESS_POOL_LIMIT = 100_000;

/**
 * A seed's deal from the pool of placed photographs. The pool is sorted first:
 * the database returns rows in scan order, which follows how the archive
 * happened to be indexed, and a seed shuffling that order deals something else
 * after every re-index.
 */
export const dealGuessPhotos = <T extends { path: string }>(
  pool: readonly T[],
  seed: string,
): T[] => {
  const deal = [...pool].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const random = seededRandom(seed);
  for (let i = deal.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deal[i], deal[j]] = [deal[j]!, deal[i]!];
  }
  return deal;
};
