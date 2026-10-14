// Daily puzzles follow the reader's own calendar day, like Guess Where's daily:
// everyone on the same local date with the same archive gets the same board.

const DAILY_EPOCH = Date.UTC(2026, 9, 14);
const DAY_MS = 86_400_000;

/** The local calendar day as `YYYY-MM-DD`. */
export const localDayKey = (date: Date = new Date()): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const dayIndex = (dayKey: string): number => {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Math.round((Date.UTC(y!, m! - 1, d!) - DAILY_EPOCH) / DAY_MS);
};

/** Puzzle number shown to players; 14 October 2026 is #1. */
export const dailyNumber = (dayKey: string): number => dayIndex(dayKey) + 1;

/** Whether `later` is the calendar day after `earlier`. */
export const isNextDay = (earlier: string, later: string): boolean =>
  dayIndex(later) - dayIndex(earlier) === 1;

/** Seed for one game's daily board on one day. */
export const dailySeed = (game: string, dayKey: string): string => `daily:${game}:${dayKey}`;
