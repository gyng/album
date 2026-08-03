import React from "react";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import type { PhotoStats } from "../../util/computeStats";
import { Caption, Heading, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreTimeSections.module.css";
import { formatExifWallClockDate } from "../../util/exifTime";
import { buildSilenceBands, buildZoneAxis } from "../../util/exploreTimeViz";

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
    "zoneClock",
    "zoneAxis",
    "zoneStack",
    "zoneTick",
    "zoneStackList",
    "zoneChip",
    "zoneNote",
    "silenceTrack",
    "silenceLine",
    "silenceBand",
    "silenceStart",
    "silenceEnd",
    "zoneCount",
    "zoneCountLabel",
    "zoneName",
    "zoneOffsets",
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
export const ExploreTimezones = ({ stats }: { stats: PhotoStats["timezoneStats"] }) => {
  const columns = buildZoneAxis(stats.zones);
  if (stats.zoneCount === 0 || columns.length === 0) return null;

  const seasonal = Array.from(
    new Set(
      columns.flatMap((column) =>
        column.zones.filter((zone) => zone.seasonal).map((zone) => zoneCity(zone.name)),
      ),
    ),
  );

  return (
    // The full row: sixteen offsets in a single column showed five of them, and
    // the span from -07:00 to +11:00 is the whole point of drawing it.
    <section className={`${styles.section} ${styles.sectionWide}`}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Timezones
        </Heading>
        <Caption as="span">Resolved from each photo&rsquo;s own location</Caption>
      </div>
      <div className={styles.zoneTotal}>
        <span className={styles.zoneCount}>{stats.zoneCount}</span>
        <span className={styles.zoneCountLabel}>
          {stats.zoneCount === 1 ? "timezone" : "timezones"}, {columns[0]?.label} to{" "}
          {columns[columns.length - 1]?.label}
        </span>
      </div>

      {/* Placed on the world's clock rather than ranked: a list of sixteen
          offsets says how many, and this says how far apart. */}
      <div className={styles.zoneClock}>
        <ol className={styles.zoneAxis}>
          {columns.map((column) => (
            <li key={column.hours} className={styles.zoneStack}>
              <span className={styles.zoneOffsets}>{column.label}</span>
              <span className={styles.zoneTick} aria-hidden="true" />
              <span className={styles.zoneStackList}>
                {column.zones.map((zone) => (
                  <span
                    key={zone.name}
                    className={styles.zoneChip}
                    // Weighted by how much of the archive stood on this clock,
                    // so Tokyo's 63% does not read like Macau's three frames.
                    // The weight is only visible, so the share is also said in
                    // words — the tail of a 16-zone list rounds to nothing, and
                    // "0%" would read as none at all.
                    style={{ opacity: 0.45 + Math.min(0.55, zone.sharePercent / 100) }}
                    title={`${zoneCity(zone.name)} ${column.label}: ${zone.count.toLocaleString("en")} ${
                      zone.count === 1 ? "photo" : "photos"
                    }, ${zone.sharePercent === 0 ? "<1%" : `${zone.sharePercent}%`} of the archive`}
                  >
                    <span className={styles.zoneName}>{zoneCity(zone.name)}</span>
                    <span className={styles.zoneShare}>
                      {zone.count.toLocaleString("en")}
                      {zone.seasonal ? "*" : ""}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {seasonal.length > 0 ? (
        <p className={styles.zoneNote}>
          * {Array.from(new Set(seasonal)).join(", ")} {seasonal.length === 1 ? "stands" : "stand"}{" "}
          in two columns: the offset comes from the photograph&rsquo;s own date, so summer time is a
          different clock.
        </p>
      ) : null}
    </section>
  );
};

/**
 * The longest stretches the archive records nothing at all. An archive's
 * silences describe it as much as its peaks.
 */
export const ExploreArchiveGaps = ({
  gaps,
  dateRange,
}: {
  gaps: PhotoStats["archiveGaps"];
  dateRange: PhotoStats["dateRange"];
}) => {
  const bands = buildSilenceBands(gaps, dateRange);
  if (gaps.length === 0) return null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Longest silences
        </Heading>
        <Caption as="span">Stretches with no photograph</Caption>
      </div>

      {/* Drawn on the archive's own life rather than ranked by length: how long
          is the number, and where it falls is the part a list cannot say. */}
      {bands.length > 0 && dateRange ? (
        <div className={styles.silenceTrack}>
          <span className={styles.silenceLine} aria-hidden="true" />
          {bands.map((band) => (
            <span
              key={`${band.fromDate}-${band.toDate}`}
              className={styles.silenceBand}
              style={{ insetInlineStart: `${band.start}%`, inlineSize: `${band.width}%` }}
              title={`${formatYears(band.days)} with no photograph, ${formatDayLabel(band.fromDate)} to ${formatDayLabel(band.toDate)}`}
            />
          ))}
          <span className={styles.silenceStart}>{dateRange[0]}</span>
          <span className={styles.silenceEnd}>{dateRange[1]}</span>
        </div>
      ) : null}

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
  );
};

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
