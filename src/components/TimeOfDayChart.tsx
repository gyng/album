import { BucketedStat } from "../util/computeStats";
import { ChartTooltip } from "./ui";
import styles from "./TimeOfDayChart.module.css";

type Props = {
  data: BucketedStat[];
  activeLabel?: string | null;
  onActivate?: (label: string) => void;
  onDeactivate?: () => void;
  registerColumn?: (label: string, node: HTMLDivElement | null) => void;
};

const DAYPARTS = [
  { label: "Night", start: 0, end: 5 },
  { label: "Morning", start: 6, end: 11 },
  { label: "Afternoon", start: 12, end: 17 },
  { label: "Evening", start: 18, end: 23 },
];

const getPeakSummary = (data: BucketedStat[]): string => {
  const max = Math.max(...data.map((bucket) => bucket.count), 0);
  if (max <= 0) {
    return "No time-of-day data yet.";
  }

  const peakIndices = data
    .map((bucket, index) => ({ index, count: bucket.count }))
    .filter((bucket) => bucket.count === max)
    .map((bucket) => bucket.index)
    .sort((left, right) => left - right);

  const start = peakIndices[0];
  const end = peakIndices[peakIndices.length - 1];
  const contiguous = peakIndices.every((value, index) =>
    index === 0 ? true : value === peakIndices[index - 1] + 1,
  );

  if (contiguous && start !== end) {
    return `Peak window: ${data[start].label}-${data[end].label}`;
  }

  return `Peak hour: ${data[start].label}`;
};

export const TimeOfDayChart: React.FC<Props> = ({
  data,
  activeLabel = null,
  onActivate,
  onDeactivate,
  registerColumn,
}) => {
  const max = Math.max(...data.map((bucket) => bucket.count), 1);
  const peakSummary = getPeakSummary(data);

  return (
    <div className={styles.chart}>
      <div className={styles.metaRow}>
        <p className={styles.summary}>{peakSummary}</p>
      </div>

      <div className={styles.dayparts}>
        {DAYPARTS.map((daypart) => (
          <div
            key={daypart.label}
            className={styles.daypart}
            style={{
              gridColumn: `${daypart.start + 1} / ${daypart.end + 2}`,
            }}
          >
            {daypart.label}
          </div>
        ))}
      </div>

      <div className={styles.bars}>
        {data.map((bucket, index) => {
          const heightPct = max > 0 ? (bucket.count / max) * 100 : 0;

          return (
            <div
              key={bucket.label}
              ref={(node) => {
                registerColumn?.(bucket.label, node);
              }}
              className={[
                styles.column,
                activeLabel === bucket.label ? styles.columnActive : "",
              ].join(" ")}
              aria-label={`${bucket.label} · ${bucket.count.toLocaleString()} photos`}
              onMouseEnter={() => {
                onActivate?.(bucket.label);
              }}
              onMouseLeave={() => {
                onDeactivate?.();
              }}
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
              <div
                className={styles.label}
              >
                {bucket.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
