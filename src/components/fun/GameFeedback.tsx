import { fitBand } from "../../util/fitBand";
import styles from "./PhotoGames.module.css";

type ScoreProps = {
  score: number | null;
  label: string;
  /** Names the score beside it ("Close enough"): for fits and resemblances, not tallies. */
  band?: boolean;
};

export const GameScore = ({ score, label, band = false }: ScoreProps) => (
  <div className={styles.scoreCard}>
    {score === null ? (
      <p>These matches are too alike to score.</p>
    ) : (
      <>
        <p className={styles.scoreLine}>
          <span className={styles.score}>
            {label ? `${label}: ` : ""}
            {score} / 100
          </span>
          {band ? <span className={styles.scoreBand}>{fitBand(score)}</span> : null}
        </p>
        <div className={styles.scoreTrack} aria-hidden="true">
          <span style={{ width: `${score}%` }} />
        </div>
      </>
    )}
  </div>
);

export const GameProgress = ({ current, total }: { current: number; total: number }) => (
  <div className={styles.progressDots} aria-hidden="true">
    {Array.from({ length: total }, (_, index) => (
      <span key={index} data-filled={index < current} />
    ))}
  </div>
);
