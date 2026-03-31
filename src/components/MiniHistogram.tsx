import { BucketedStat } from "../util/computeStats";
import { ChartTooltip } from "./ui";
import styles from "./MiniHistogram.module.css";

type Props = {
  title: string;
  data: BucketedStat[];
};

export const MiniHistogram: React.FC<Props> = ({ title, data }) => {
  const max = Math.max(...data.map((bucket) => bucket.count), 1);

  return (
    <section className={styles.chart}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.bars}>
        {data.map((bucket) => {
          const heightPct = max > 0 ? (bucket.count / max) * 100 : 0;

          return (
            <div
              key={bucket.label}
              className={styles.column}
              aria-label={`${bucket.label} · ${bucket.count.toLocaleString()} photos`}
            >
              <ChartTooltip>
                {bucket.label} · {bucket.count.toLocaleString()}
              </ChartTooltip>
              <div className={styles.track}>
                <div className={styles.count}>{bucket.label}</div>
                <div
                  className={[
                    styles.bar,
                    bucket.count === 0 ? styles.barEmpty : "",
                  ].join(" ")}
                  style={{ height: `${Math.max(heightPct, bucket.count > 0 ? 4 : 0)}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className={styles.label}>{bucket.count.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
