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

const getLabel = (details?: ProgressDetails, activity = "Loading"): string => {
  if (!details || details.total <= 0) {
    return `${activity}…`;
  }

  return `${activity}… ${formatBytes(details.loaded)} / ${formatBytes(details.total)}`;
};

export const ProgressBar: React.FC<{
  progress: number;
  hideIfComplete?: boolean;
  details?: ProgressDetails;
  /** Names what is loading, keeping the byte counter — e.g. "Downloading
      search index… 1.2 MB / 5.1 MB". Defaults to plain "Loading". */
  activity?: string;
  /** Overrides the derived label entirely — e.g. a status the bar should
      show once it's full but work continues. */
  label?: string;
}> = ({ progress, hideIfComplete = true, details, activity, label }) => {
  return !hideIfComplete || progress < 100 ? (
    <div className={styles.wrapper}>
      <div className={styles.progressBar}>
        <div className={styles.progress} style={{ width: `${progress}%` }} />
        <div>{label ?? getLabel(details, activity)}</div>
      </div>
    </div>
  ) : null;
};
