import React from "react";
import Link from "next/link";
import {
  BucketedStatGroup,
} from "../util/computeStats";
import { ChartTooltip } from "./ui";
import styles from "./YearSplitHistogram.module.css";

type Props = {
  title: string;
  data: BucketedStatGroup[];
  getHref?: (year: string) => string | null;
};

const getMaxCount = (groups: BucketedStatGroup[]): number =>
  Math.max(
    ...groups.flatMap((group) => group.data.map((bucket) => bucket.count)),
    1,
  );

export const YearSplitHistogram: React.FC<Props> = ({ title, data, getHref }) => {
  const orderedData = data.toReversed();
  const max = getMaxCount(orderedData);
  const months = orderedData[0]?.data.map((bucket) => bucket.label) ?? [];

  return (
    <section className={styles.chart}>
      <h3 className={styles.title}>{title}</h3>
      <div
        className={styles.matrix}
        style={{
          gridTemplateColumns: `3.5rem repeat(${months.length}, minmax(0, 1fr))`,
        }}
      >
        <div className={styles.corner} />
        {months.map((month) => (
          <div key={month} className={styles.monthLabel}>
            {month}
          </div>
        ))}

        {orderedData.map((group) => (
          <React.Fragment key={group.label}>
            {getHref?.(group.label) ? (
              <Link
                key={`${group.label}-label`}
                href={getHref(group.label) as string}
                className={`${styles.yearLabel} ${styles.yearLabelLink}`}
              >
                {group.label}
              </Link>
            ) : (
              <div key={`${group.label}-label`} className={styles.yearLabel}>
                {group.label}
              </div>
            )}
            {group.data.map((bucket) => {
              const intensity = max > 0 ? bucket.count / max : 0;
              const href = getHref?.(group.label) ?? null;

              const cell = (
                <>
                  <ChartTooltip>
                    {group.label} {bucket.label} · {bucket.count.toLocaleString()}
                  </ChartTooltip>
                  {bucket.count > 0 ? (
                    <span className={styles.count}>{bucket.count.toLocaleString()}</span>
                  ) : null}
                </>
              );

              if (href && bucket.count > 0) {
                return (
                  <Link
                    key={`${group.label}-${bucket.label}`}
                    href={href}
                    className={`${styles.cell} ${styles.cellLink}`}
                    style={{ ["--intensity" as string]: String(intensity) }}
                    aria-label={`${group.label} ${bucket.label} · ${bucket.count.toLocaleString()} photos`}
                  >
                    {cell}
                  </Link>
                );
              }

              return (
                <div
                  key={`${group.label}-${bucket.label}`}
                  className={[
                    styles.cell,
                    bucket.count === 0 ? styles.cellEmpty : "",
                  ].join(" ")}
                  style={{ ["--intensity" as string]: String(intensity) }}
                  aria-label={`${group.label} ${bucket.label} · ${bucket.count.toLocaleString()} photos`}
                >
                  {cell}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
};
