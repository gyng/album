import React, { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Heading, Caption } from "../ui";
import { RoundResult } from "./GuessRound";
import { GameSettings } from "./guessTypes";
import {
  MAX_SCORE,
  MAX_TIME_BONUS,
  formatDistance,
  scoreTierColour,
} from "./guessScoring";
import styles from "./GuessSummary.module.css";

type GuessSummaryProps = {
  results: RoundResult[];
  seed: string;
  settings: GameSettings;
  onPlayAgain: () => void;
  onChangeSettings: () => void;
};

const getRating = (
  score: number,
  totalRounds: number,
  hasTimer: boolean,
): string => {
  const maxPerRound = MAX_SCORE + (hasTimer ? MAX_TIME_BONUS : 0);
  const ratio = score / (totalRounds * maxPerRound);
  if (ratio >= 0.9) return "Local expert";
  if (ratio >= 0.7) return "Seasoned traveller";
  if (ratio >= 0.5) return "Decent navigator";
  if (ratio >= 0.3) return "Getting there";
  if (ratio >= 0.1) return "Tourist with a broken compass";
  return "Lost in space";
};

const getGeocodeLabel = (geocode: string): string | null => {
  if (!geocode) return null;
  const parts = geocode
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
  return parts[0];
};

/** Imperatively animates a DOM element's textContent from 0 to target. */
const useAnimatedCounter = (
  target: number,
  durationMs = 800,
): React.RefCallback<HTMLElement> => {
  const rafRef = useRef<number>(0);

  return useCallback(
    (node: HTMLElement | null) => {
      cancelAnimationFrame(rafRef.current);
      if (!node) return;
      if (target === 0) {
        node.textContent = "0";
        return;
      }
      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(eased * target).toLocaleString();
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    },
    [target, durationMs],
  );
};

const buildShareUrl = (seed: string, settings: GameSettings): string => {
  if (settings.daily) return "/guess?daily";
  const params = new URLSearchParams();
  params.set("seed", seed);
  if (settings.rounds !== 5) params.set("rounds", String(settings.rounds));
  if (settings.region) params.set("region", settings.region);
  if (settings.timeLimit) params.set("timer", String(settings.timeLimit));
  return `/guess?${params.toString()}`;
};

export const GuessSummary: React.FC<GuessSummaryProps> = ({
  results,
  seed,
  settings,
  onPlayAgain,
  onChangeSettings,
}) => {
  const hasTimer = Boolean(settings.timeLimit);
  const maxPerRound = MAX_SCORE + (hasTimer ? MAX_TIME_BONUS : 0);
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.length * maxPerRound;
  const rating = getRating(totalScore, results.length, hasTimer);
  const totalCounterRef = useAnimatedCounter(totalScore);
  const [copied, setCopied] = useState(false);
  const bestScore = Math.max(...results.map((r) => r.score));
  const totalTierColour = scoreTierColour(
    results.length > 0
      ? totalScore / results.length
      : 0,
  );

  const shareUrl = buildShareUrl(seed, settings);

  const handleCopyLink = useCallback(() => {
    const fullUrl = `${window.location.origin}${shareUrl}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  return (
    <div className={styles.summary}>
      <div className={styles.header}>
        {settings.daily ? (
          <Caption as="p" className={styles.dailyLabel}>Daily challenge</Caption>
        ) : null}
        <Heading level={1}>
          <span
            className={styles.totalScore}
            ref={totalCounterRef}
            style={{ textShadow: `0 0 16px ${totalTierColour}` }}
          >
            0
          </span>{" "}
          <span className={styles.maxScore}>/ {maxScore.toLocaleString()}</span>
        </Heading>
        <p className={styles.rating}>{rating}</p>
      </div>

      <ol className={styles.roundList}>
        {results.map((result, idx) => {
          const thumbSrc = `/data/albums/${result.photo.albumName}/.resized_images/${result.photo.photoName}@800.avif`;
          const label = getGeocodeLabel(result.photo.geocode);
          const barWidth = (result.score / maxPerRound) * 100;
          const colour = scoreTierColour(result.distanceScore);

          return (
            <li
              key={idx}
              className={[
                styles.roundRow,
                result.score === bestScore && result.score > 0
                  ? styles.bestRound
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ animationDelay: `${idx * 0.08}s` }}
            >
              <Link href={`/album/${result.photo.albumName}#${result.photo.photoName}`}>
                <img
                  src={thumbSrc}
                  alt=""
                  className={styles.thumb}
                  draggable={false}
                />
              </Link>
              <div className={styles.roundDetail}>
                <div className={styles.roundMeta}>
                  {label ? (
                    <span className={styles.location}>{label}</span>
                  ) : (
                    <span className={styles.location}>Unknown location</span>
                  )}
                  <span className={styles.roundDistance}>
                    {result.skipped
                      ? "Skipped"
                      : formatDistance(result.distanceMeters)}
                  </span>
                </div>
                <div className={styles.scoreBarTrack}>
                  <div
                    className={styles.scoreBarFill}
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: colour,
                      animationDelay: `${0.2 + idx * 0.1}s`,
                    }}
                  />
                </div>
              </div>
              <span className={styles.roundScoreCol}>
                <span
                  className={styles.roundScore}
                  style={{ color: colour }}
                >
                  {result.score.toLocaleString()}
                </span>
                {result.timeBonus > 0 ? (
                  <span className={styles.timeBonus}>
                    +{result.timeBonus.toLocaleString()}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.actions}>
        <button className={styles.playAgain} onClick={onPlayAgain}>
          Play again
        </button>
        <button className={styles.shareButton} onClick={handleCopyLink}>
          {copied ? "Copied!" : "Copy challenge link"}
        </button>
      </div>

      <div className={styles.footer}>
        <button
          className={styles.changeSettings}
          onClick={onChangeSettings}
        >
          Change settings
        </button>
      </div>
    </div>
  );
};
