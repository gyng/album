import styles from "./ProgressBar.module.css";

type ProgressDetails = {
  loaded: number;
  total: number;
};

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let nextValue = value;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
};

const getLabel = (details?: ProgressDetails): string => {
  if (!details || details.total <= 0) {
    return "Loading...";
  }

  return `Loading... ${formatBytes(details.loaded)} / ${formatBytes(details.total)}`;
};

export const ProgressBar: React.FC<{
  progress: number;
  hideIfComplete?: boolean;
  details?: ProgressDetails;
}> = ({ progress, hideIfComplete = true, details }) => {
  return hideIfComplete && progress < 100 ? (
    <div style={{ display: "block" }}>
      <div className={styles.progressBar}>
        <div className={styles.progress} style={{ width: `${progress}%` }} />
        <div>{getLabel(details)}</div>
      </div>
    </div>
  ) : null;
};
