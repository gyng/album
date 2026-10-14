import { useCallback, useEffect, useState } from "react";
import { localDayKey } from "../../util/gameDaily";
import {
  EMPTY_GAME_STATS,
  parseGameStats,
  recordGameResult,
  type GameResult,
  type GameStats,
} from "../../util/gameStats";
import type { FunPage } from "./games";

export type StatsGame = Exclude<FunPage, "fun">;

export const gameStatsStorageKey = (game: StatsGame) => `fun-stats:${game}`;

/** Reads one game's stats; unavailable or malformed storage reads as empty. */
export const readGameStats = (game: StatsGame): GameStats => {
  try {
    const raw = localStorage.getItem(gameStatsStorageKey(game));
    return raw ? parseGameStats(JSON.parse(raw)) : EMPTY_GAME_STATS;
  } catch {
    return EMPTY_GAME_STATS;
  }
};

/**
 * A game's personal record. `stats` is null until mounted, so server and first
 * client render agree; `record` saves one finished game and returns the update.
 */
export const useGameStats = (game: StatsGame) => {
  const [stats, setStats] = useState<GameStats | null>(null);

  useEffect(() => {
    setStats(readGameStats(game));
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === gameStatsStorageKey(game))
        setStats(readGameStats(game));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [game]);

  const record = useCallback(
    (result: GameResult, day: string = localDayKey()): GameStats => {
      // Re-read so another tab's finished games are not overwritten.
      const next = recordGameResult(readGameStats(game), result, day);
      try {
        localStorage.setItem(gameStatsStorageKey(game), JSON.stringify(next));
      } catch {
        // Storage unavailable: the stats still update for this visit.
      }
      setStats(next);
      return next;
    },
    [game],
  );

  return { stats, record };
};
