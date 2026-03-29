import styles from "./StatBar.module.css";
import { FacetLinkIcon } from "./FacetLinkIcon";

type Props = {
  label: string;
  count: number;
  maxCount: number;
  /** Optional: show as percentage of total photos, not just relative width */
  totalPhotos?: number;
  actionHref?: string | null;
  actionLabel?: string;
};

export const StatBar: React.FC<Props> = ({
  label,
  count,
  maxCount,
  totalPhotos,
  actionHref,
  actionLabel,
}) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const coveragePct =
    totalPhotos != null && totalPhotos > 0
      ? ((count / totalPhotos) * 100).toFixed(0)
      : null;

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.bar} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.count}>
        {coveragePct != null ? `${coveragePct}%` : count}
      </span>
      {actionHref && actionLabel ? (
        <FacetLinkIcon
          href={actionHref}
          label={actionLabel}
          className={styles.action}
        />
      ) : null}
    </div>
  );
};
