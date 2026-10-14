import { useState } from "react";
import { dailyNumber, dailySeed, localDayKey } from "../../util/gameDaily";
import { currentStreak, type GameStats } from "../../util/gameStats";
import { seededRandom } from "../../util/seededRandom";
import { usePublicConfig } from "../platform";
import { Button } from "../ui";
import { FUN_GAMES } from "./games";
import type { StatsGame } from "./useGameStats";
import styles from "./GameRecord.module.css";

/** Today's board for one game: the same seed for everyone on this local date. */
export const dailyPuzzle = (game: StatsGame, day: string = localDayKey()) => ({
  day,
  number: dailyNumber(day),
  /** A fresh generator each call, so a rebuilt board is identical. */
  random: () => seededRandom(dailySeed(game, day)),
});

/**
 * The archive arrives in random order; a daily must sort it first, or the same
 * seed deals different boards on different devices.
 */
export const dailyPhotoOrder = <T extends { path: string }>(photos: readonly T[]): T[] =>
  [...photos].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/** Spoiler-free text for sharing a finished daily. */
export const dailyShareText = (
  game: StatsGame,
  day: string,
  summary: string,
  siteOrigin: string,
): string => {
  const definition = FUN_GAMES.find((item) => item.id === game)!;
  return `${definition.title} #${dailyNumber(day)}\n${summary}\n${siteOrigin}${definition.href}?daily`;
};

const format = (value: number) => value.toLocaleString("en");

/** One quiet line of personal history; nothing until a game has been finished. */
export const GameStatsLine = ({
  stats,
  wins = true,
  best = "Best",
  formatBest = format,
}: {
  stats: GameStats | null;
  /** Whether the game has a win/lose outcome worth counting. */
  wins?: boolean;
  /** Label for the best score, or null for games without one. */
  best?: string | null;
  formatBest?: (value: number) => string;
}) => {
  if (!stats || stats.played === 0) return null;
  const streak = currentStreak(stats, localDayKey());
  const parts = [
    `Played ${format(stats.played)}`,
    ...(wins ? [`won ${format(stats.won)}`] : []),
    ...(best && stats.best !== undefined
      ? [`${best.toLowerCase()} ${formatBest(stats.best)}`]
      : []),
    ...(streak > 1 ? [`${streak}-day streak`] : []),
  ];
  return <p className={styles.stats}>{parts.join(" · ")}</p>;
};

/** Shares through the system sheet where there is one, else copies the text. */
export const ShareResult = ({ text }: { text: string }) => {
  const [status, setStatus] = useState("");
  const share = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch (error) {
      // Dismissing the share sheet is not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("Could not share");
    }
  };
  return (
    <span className={styles.share}>
      <Button onClick={() => void share()}>Share result</Button>
      <span role="status" className={styles.shareStatus}>
        {status}
      </span>
    </span>
  );
};

/** The origin share links point at; it differs between previews and production. */
export const useShareOrigin = () => usePublicConfig().siteOrigin;
