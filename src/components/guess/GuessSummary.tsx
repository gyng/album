import React, { useCallback, useRef } from "react";
import Link from "next/link";
import { Heading } from "../ui";
import { RoundResult } from "./GuessRound";
import styles from "./GuessSummary.module.css";

type GuessSummaryProps = {
  results: RoundResult[];
  onPlayAgain: () => void;
};

const MAX_SCORE_PER_ROUND = 5000;

const getRating = (score: number, totalRounds: number): string => {
  const maxScore = totalRounds * MAX_SCORE_PER_ROUND;
  const ratio = score / maxScore;
  if (ratio >= 0.9) return "Local expert";
  if (ratio >= 0.7) return "Seasoned traveller";
  if (ratio >= 0.5) return "Decent navigator";
  if (ratio >= 0.3) return "Getting there";
  if (ratio >= 0.1) return "Tourist with a broken compass";
  return "Lost in space";
};

const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString()} km`;
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

const scoreTierColour = (score: number): string => {
  const ratio = score / MAX_SCORE_PER_ROUND;
  if (ratio >= 0.7) return "#22c55e";
  if (ratio >= 0.35) return "#eab308";
  return "var(--c-accent)";
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

export const GuessSummary: React.FC<GuessSummaryProps> = ({
  results,
  onPlayAgain,
}) => {
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.length * MAX_SCORE_PER_ROUND;
  const rating = getRating(totalScore, results.length);
  const totalCounterRef = useAnimatedCounter(totalScore);

  return (
    <div className={styles.summary}>
      <div className={styles.header}>
        <Heading level={1}>
          <span className={styles.totalScore} ref={totalCounterRef}>
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
          const barWidth = (result.score / MAX_SCORE_PER_ROUND) * 100;
          const colour = scoreTierColour(result.score);

          return (
            <li
              key={idx}
              className={styles.roundRow}
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
              <span
                className={styles.roundScore}
                style={{ color: colour }}
              >
                {result.score.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>

      <button className={styles.playAgain} onClick={onPlayAgain}>
        Play again
      </button>
    </div>
  );
};
