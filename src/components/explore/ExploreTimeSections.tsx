import React from "react";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import type { PhotoStats } from "../../util/computeStats";
import { Caption, Heading, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreTimeSections.module.css";
import { formatExifWallClockDate } from "../../util/exifTime";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "gapList",
    "gapRow",
    "gapSpan",
    "gapEnds",
    "memoryGrid",
    "memoryItem",
    "memoryYear",
    "memoryAgo",
    "section",
    "sectionHeader",
    "sectionWide",
    "zoneCount",
    "zoneCountLabel",
    "zoneList",
    "zoneName",
    "zoneOffsets",
    "zoneRow",
    "zoneShare",
    "zoneTotal",
  ],
  [],
);

/** "Asia/Tokyo" reads as a path; the city is the part a reader recognises. */
const zoneCity = (name: string) => name.split("/").pop()?.replace(/_/g, " ") ?? name;

const formatDayLabel = (isoDate: string) =>
  formatExifWallClockDate(`${isoDate}T00:00:00`) ?? isoDate;

const formatYears = (days: number) => {
  const years = days / 365.25;
  if (years < 1) {
    const months = Math.round(days / 30.44);
    return months <= 1 ? `${days} days` : `${months} months`;
  }
  const rounded = Math.round(years * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} years`;
};

/**
 * Which timezones the archive was shot in.
 *
 * Worth its own panel because the zone is derived per photo from where it was
 * taken, not read from the camera — so a place that changes offset across the
 * year shows both, which is the visible proof that it was resolved per photo
 * rather than assumed once.
 */
export const ExploreTimezones = ({ stats }: { stats: PhotoStats["timezoneStats"] }) =>
  stats.zoneCount > 0 ? (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Timezones
        </Heading>
        <Caption as="span">Resolved from each photo&rsquo;s own location</Caption>
      </div>
      <div className={styles.zoneTotal}>
        <span className={styles.zoneCount}>{stats.zoneCount}</span>
        <span className={styles.zoneCountLabel}>
          {stats.zoneCount === 1 ? "timezone" : "timezones"}
        </span>
      </div>
      <ul className={styles.zoneList}>
        {stats.zones.map((zone) => (
          <li key={zone.name} className={styles.zoneRow}>
            <span className={styles.zoneName}>{zoneCity(zone.name)}</span>
            <span className={styles.zoneOffsets}>{zone.offsets.join(" / ")}</span>
            <span className={styles.zoneShare}>
              {zone.count.toLocaleString("en")} {zone.count === 1 ? "photo" : "photos"} ·{" "}
              {/* The tail of a 16-zone list rounds to nothing; "0%" would read
                  as none at all. */}
              {zone.sharePercent === 0 ? "<1%" : `${zone.sharePercent}%`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

/**
 * The longest stretches the archive records nothing at all. An archive's
 * silences describe it as much as its peaks.
 */
export const ExploreArchiveGaps = ({ gaps }: { gaps: PhotoStats["archiveGaps"] }) =>
  gaps.length > 0 ? (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Longest silences
        </Heading>
        <Caption as="span">Stretches with no photograph</Caption>
      </div>
      <ul className={styles.gapList}>
        {gaps.map((gap) => (
          <li key={`${gap.fromDate}-${gap.toDate}`} className={styles.gapRow}>
            <span className={styles.gapSpan}>{formatYears(gap.days)}</span>
            <span className={styles.gapEnds}>
              {formatDayLabel(gap.fromDate)} → {formatDayLabel(gap.toDate)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

/**
 * The same calendar day in previous years.
 *
 * The page is statically built, so the build indexes every day and the browser
 * picks the one it is. `now` is null until an effect supplies it, which keeps
 * the server from committing to a date it cannot know and keeps hydration
 * matching. Around half the calendar has no photograph on it, and on those days
 * this renders nothing rather than an empty panel.
 */
export const ExploreThisDaySection = ({
  memories,
  now,
}: {
  memories: PhotoStats["dayOfYearMemories"];
  now?: Date | null;
}) => {
  const [browserNow, setBrowserNow] = React.useState<Date | null>(null);
  const isControlled = now !== undefined;

  React.useEffect(() => {
    if (isControlled) return;
    setBrowserNow(new Date());
  }, [isControlled]);

  const today = isControlled ? now : browserNow;
  if (!today) return null;

  const monthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const entry = memories.find((memory) => memory.monthDay === monthDay);
  if (!entry || entry.photos.length === 0) return null;

  const thisYear = today.getFullYear();

  return (
    <section className={`${styles.section} ${styles.sectionWide}`}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          On this day
        </Heading>
        <Caption as="span">{formatDayLabel(`${thisYear}-${monthDay}`)} in other years</Caption>
      </div>
      <ul className={styles.memoryGrid}>
        {entry.photos.map((photo) => {
          const yearsAgo = thisYear - photo.year;
          return (
            <li key={photo.date} className={styles.memoryItem}>
              <Thumb
                src={photo.src}
                alt={photo.label}
                loading="lazy"
                {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
              />
              <span className={styles.memoryYear}>{photo.year}</span>
              <span className={styles.memoryAgo}>
                {yearsAgo <= 0
                  ? "this year"
                  : `${yearsAgo} ${yearsAgo === 1 ? "year" : "years"} ago`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
