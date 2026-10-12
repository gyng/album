import styles from "./PhotoGames.module.css";

export const GameScore = ({ score, label }: { score: number | null; label: string }) => (
  <div className={styles.scoreCard}>
    {score === null ? (
      <p>These matches are too alike to score.</p>
    ) : (
      <>
        <p className={styles.score}>
          {label ? `${label}: ` : ""}
          {score} / 100
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
