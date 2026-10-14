import { localDayKey } from "../../util/gameDaily";

// Guess Where's daily seed predates the shared `daily:<game>:<day>` format and
// stays `daily-YYYY-MM-DD`: changing it would deal a different board to
// everyone holding today's link.
export const guessDailySeed = (day: string = localDayKey()): string => `daily-${day}`;

/** The local day a daily seed was dealt for, or null for any other seed. */
export const guessDailySeedDay = (seed: string): string | null =>
  /^daily-(\d{4}-\d{2}-\d{2})$/.exec(seed)?.[1] ?? null;
