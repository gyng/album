import Link from "next/link";
import styles from "./StatBar.module.css";

type Props = {
  label: string;
  count: number;
  maxCount: number;
  labelPrefix?: React.ReactNode;
  barColor?: string;
  actionHref?: string | null;
  actionLabel?: string;
};

export const StatBar: React.FC<Props> = ({
  label,
  count,
  maxCount,
  labelPrefix,
  barColor,
  actionHref,
  actionLabel,
}) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div
      className={[
        styles.row,
        actionHref ? styles.rowInteractive : "",
      ].join(" ")}
    >
      <span className={styles.label}>
        {labelPrefix}
        <span>{label}</span>
      </span>
      <div className={styles.barTrack}>
        <div
          className={styles.bar}
          style={{
            width: `${pct}%`,
            ...(barColor ? { backgroundColor: barColor } : null),
          }}
        />
      </div>
      <span className={styles.count}>{count.toLocaleString()}</span>
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
      ) : null}
    </div>
  );
};
