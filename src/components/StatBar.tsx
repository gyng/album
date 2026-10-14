import { AppLink as Link } from "./platform";
import styles from "./StatBar.module.css";

type Props = {
  label: string;
  count: number;
  maxCount: number;
  labelPrefix?: React.ReactNode;
  barColor?: string;
  actionHref?: string | null;
  actionLabel?: string;
  /** Hold an action's space on a row without one, so a list's counts line up. */
  reserveAction?: boolean;
};

export const StatBar: React.FC<Props> = ({
  label,
  count,
  maxCount,
  labelPrefix,
  barColor,
  actionHref,
  actionLabel,
  reserveAction,
}) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div className={styles.container}>
      <div
        className={[styles.row, actionHref ? styles.rowInteractive : ""].filter(Boolean).join(" ")}
      >
        <span className={styles.label}>
          {labelPrefix}
          <span>{label}</span>
        </span>
        <div className={styles.barTrack}>
          <div
            className={styles.bar}
            style={{
              inlineSize: `${pct}%`,
              ...(barColor ? { backgroundColor: barColor } : null),
            }}
          />
        </div>
        <span className={styles.count}>{count.toLocaleString("en")}</span>
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className={styles.action}
            aria-label={actionLabel}
            title={actionLabel}
          >
            <span className={styles.actionText}>View</span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : reserveAction ? (
          <span className={[styles.action, styles.actionPlaceholder].join(" ")} aria-hidden="true">
            <span className={styles.actionText}>View</span>
            <span>↗</span>
          </span>
        ) : null}
      </div>
    </div>
  );
};
