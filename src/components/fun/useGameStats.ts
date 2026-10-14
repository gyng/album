import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
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

const readRawGameStats = (game: StatsGame): string => {
  try {
    return localStorage.getItem(gameStatsStorageKey(game)) ?? "";
  } catch {
    return "";
  }
};

const parseRawGameStats = (raw: string): GameStats => {
  try {
    return raw ? parseGameStats(JSON.parse(raw)) : EMPTY_GAME_STATS;
  } catch {
    return EMPTY_GAME_STATS;
  }
};

/** Reads one game's stats; unavailable or malformed storage reads as empty. */
export const readGameStats = (game: StatsGame): GameStats =>
  parseRawGameStats(readRawGameStats(game));

// A write in this tab raises no storage event, so `record` tells subscribers itself.
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
};
const getServerSnapshot = () => null;

/**
 * A game's personal record. `stats` is null until mounted, so server and first
 * client render agree; `record` saves one finished game and returns the update.
 */
export const useGameStats = (game: StatsGame) => {
  const raw = useSyncExternalStore(subscribe, () => readRawGameStats(game), getServerSnapshot);
  const stored = useMemo(() => (raw === null ? null : parseRawGameStats(raw)), [raw]);
  // Storage that refuses a write still shows this visit's result.
  const [unsaved, setUnsaved] = useState<{ game: StatsGame; stats: GameStats } | null>(null);
  const stats = unsaved?.game === game ? unsaved.stats : stored;

  const record = useCallback(
    (result: GameResult, day: string = localDayKey()): GameStats => {
      // Re-read so another tab's finished games are not overwritten.
      const next = recordGameResult(readGameStats(game), result, day);
      try {
        localStorage.setItem(gameStatsStorageKey(game), JSON.stringify(next));
        setUnsaved(null);
        for (const listener of listeners) listener();
      } catch {
        // Storage unavailable: the stats still update for this visit.
        setUnsaved({ game, stats: next });
      }
      return next;
    },
    [game],
  );

  return { stats, record };
};
