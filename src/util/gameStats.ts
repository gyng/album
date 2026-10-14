import { isNextDay } from "./gameDaily";

export type DailyRecord = { won: boolean; score?: number; summary: string };

export type GameStats = {
  played: number;
  won: number;
  /** Highest score; each game defines its score so that higher is better. */
  best?: number;
  /** Consecutive local days on which a game was finished. */
  streak: number;
  bestStreak: number;
  lastDay?: string;
  dailies: Record<string, DailyRecord>;
};

export type GameResult = {
  won: boolean;
  score?: number;
  /** Present when the finished game was that day's daily board. */
  daily?: { day: string; summary: string };
};

export const EMPTY_GAME_STATS: GameStats = {
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  dailies: {},
};

const KEPT_DAILIES = 60;

export const recordGameResult = (stats: GameStats, result: GameResult, day: string): GameStats => {
  const streak =
    stats.lastDay === day
      ? stats.streak
      : stats.lastDay && isNextDay(stats.lastDay, day)
        ? stats.streak + 1
        : 1;
  const dailies = { ...stats.dailies };
  // A daily counts once: replaying it after the result is known is practice.
  if (result.daily && !dailies[result.daily.day]) {
    dailies[result.daily.day] = {
      won: result.won,
      ...(result.score === undefined ? {} : { score: result.score }),
      summary: result.daily.summary,
    };
  }
  const kept = Object.keys(dailies).sort().slice(-KEPT_DAILIES);
  const best =
    result.score === undefined
      ? stats.best
      : stats.best === undefined
        ? result.score
        : Math.max(stats.best, result.score);
  return {
    played: stats.played + 1,
    won: stats.won + (result.won ? 1 : 0),
    ...(best === undefined ? {} : { best }),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    lastDay: day,
    dailies: Object.fromEntries(kept.map((key) => [key, dailies[key]!])),
  };
};

/** A streak only survives while its last day is today or yesterday. */
export const currentStreak = (stats: GameStats, today: string): number =>
  stats.lastDay && (stats.lastDay === today || isNextDay(stats.lastDay, today)) ? stats.streak : 0;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads stored stats defensively: anything malformed falls back field by field. */
export const parseGameStats = (raw: unknown): GameStats => {
  if (!raw || typeof raw !== "object") return EMPTY_GAME_STATS;
  const value = raw as Record<string, unknown>;
  const dailies: Record<string, DailyRecord> = {};
  if (value.dailies && typeof value.dailies === "object") {
    for (const [day, entry] of Object.entries(value.dailies as Record<string, unknown>)) {
      if (!DAY.test(day) || !entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.won !== "boolean" || typeof record.summary !== "string") continue;
      dailies[day] = {
        won: record.won,
        ...(typeof record.score === "number" && Number.isFinite(record.score)
          ? { score: record.score }
          : {}),
        summary: record.summary,
      };
    }
  }
  const played = count(value.played);
  return {
    played,
    won: Math.min(count(value.won), played),
    ...(typeof value.best === "number" && Number.isFinite(value.best) ? { best: value.best } : {}),
    streak: count(value.streak),
    bestStreak: count(value.bestStreak),
    ...(typeof value.lastDay === "string" && DAY.test(value.lastDay)
      ? { lastDay: value.lastDay }
      : {}),
    dailies,
  };
};
