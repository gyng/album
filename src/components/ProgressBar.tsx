import styles from "./ProgressBar.module.css";

export const ProgressBar: React.FC<{
  progress: number;
  hideIfComplete?: boolean;
}> = ({ progress, hideIfComplete = true }) => {
  return hideIfComplete && progress < 100 ? (
    <div style={{ display: "block" }}>
      <div className={styles.progressBar}>
        <div className={styles.progress} style={{ width: `${progress}%` }} />
        <div>Loading&hellip;</div>
      </div>
    </div>
  ) : null;
};
