import Link from "next/link";
import { MapWorldDeferred } from "./MapWorldDeferred";
import { MapWorldEntry } from "./MapWorld";
import { getRelativeTimeString } from "../util/time";
import { Thumb, overlayButtonStyles } from "./ui";
import commonStyles from "../styles/common.module.css";
import styles from "./TimelineDayGrid.module.css";
import { TimelineEntry } from "./timelineTypes";

const formatLongDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const formatDateTimeTitle = (dateTimeOriginal: string) => {
  const parsed = new Date(dateTimeOriginal);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatRelativeDateTime = (dateTimeOriginal: string) => {
  const parsed = new Date(dateTimeOriginal);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getRelativeTimeString(parsed);
};

const isGeocodeCoordinate = (line: string) => /^-?\d+(?:\.\d+)?$/.test(line);

const getGeocodeSummary = (geocode?: string | null): string | null => {
  if (!geocode) {
    return null;
  }

  const parts = geocode
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isGeocodeCoordinate(line));

  if (parts.length === 0) {
    return null;
  }

  const cleaned =
    parts[0].length <= 3 && parts[0].toUpperCase() === parts[0]
      ? parts.slice(1)
      : parts;

  if (cleaned.length === 0) {
    return null;
  }

  const summaryParts = [
    cleaned[0],
    cleaned.length > 2 ? cleaned.at(-2) : null,
    cleaned.at(-1),
  ].filter(Boolean) as string[];

  return summaryParts
    .filter((part, index) => summaryParts.indexOf(part) === index)
    .join(", ");
};

const toSimilarSearchPath = (path: string) => {
  if (path.startsWith("/data/albums/")) {
    return path.replace(/^\/data\/albums\//, "../albums/");
  }

  return path;
};

export const TimelineDayGrid = ({
  date,
  entries,
  onSelectRandomDate,
  onSelectOlderDate,
  onSelectNewerDate,
  canGoOlder,
  canGoNewer,
  dateHeadingRef,
}: {
  date: string | null;
  entries: TimelineEntry[];
  onSelectRandomDate?: () => void;
  onSelectOlderDate?: () => void;
  onSelectNewerDate?: () => void;
  canGoOlder?: boolean;
  canGoNewer?: boolean;
  dateHeadingRef?: React.Ref<HTMLHeadingElement>;
}) => {
  if (!date) {
    return (
      <section className={styles.emptyState} aria-label="No day selected">
        <h2 className={styles.heading}>Pick a day</h2>
        <p className={styles.emptyCopy}>
          Choose a day from the heatmap, or jump to a random one.
        </p>
        <div className={styles.dayNavButtons}>
          {onSelectOlderDate ? (
            <button
              type="button"
              className={commonStyles.button}
              onClick={onSelectOlderDate}
              disabled
            >
              ← Older
            </button>
          ) : null}
          {onSelectRandomDate ? (
            <button
              type="button"
              className={commonStyles.button}
              onClick={onSelectRandomDate}
            >
              🎲 Random
            </button>
          ) : null}
          {onSelectNewerDate ? (
            <button
              type="button"
              className={commonStyles.button}
              onClick={onSelectNewerDate}
              disabled
            >
              Newer →
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const formattedDate = formatLongDate(date);
  const locationSummary = Array.from(
    new Set(
      entries.map((entry) => getGeocodeSummary(entry.geocode)).filter(Boolean),
    ),
  ).join(" · ");
  const mappableEntries = entries.filter(
    (entry): entry is TimelineEntry & { decLat: number; decLng: number } =>
      entry.decLat !== null &&
      entry.decLat !== undefined &&
      entry.decLng !== null &&
      entry.decLng !== undefined,
  );
  const mapPhotos: MapWorldEntry[] = mappableEntries.map((entry) => ({
    album: entry.album,
    src: entry.src,
    decLat: entry.decLat,
    decLng: entry.decLng,
    date: entry.dateTimeOriginal,
    href: entry.href,
    placeholderColor: entry.placeholderColor,
    placeholderWidth: entry.placeholderWidth,
    placeholderHeight: entry.placeholderHeight,
  }));

  return (
    <section
      className={styles.section}
      aria-label={`Photos from ${formattedDate}`}
    >
      <div className={styles.header}>
        <h2 ref={dateHeadingRef} className={styles.heading}>
          {formattedDate}
        </h2>
        <div className={styles.count}>
          {entries.length} photo{entries.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className={styles.dayNavButtons}>
        {onSelectOlderDate ? (
          <button
            type="button"
            className={commonStyles.button}
            onClick={onSelectOlderDate}
            disabled={!canGoOlder}
            aria-disabled={!canGoOlder}
          >
            ← Older
          </button>
        ) : null}
        {onSelectRandomDate ? (
          <button
            type="button"
            className={commonStyles.button}
            onClick={onSelectRandomDate}
          >
            🎲 Random
          </button>
        ) : null}
        {onSelectNewerDate ? (
          <button
            type="button"
            className={commonStyles.button}
            onClick={onSelectNewerDate}
            disabled={!canGoNewer}
            aria-disabled={!canGoNewer}
          >
            Newer →
          </button>
        ) : null}
      </div>

      {locationSummary ? (
        <div className={styles.locationSummary} aria-label="Location summary">
          {locationSummary}
        </div>
      ) : null}

      <ul className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.href} className={styles.item}>
            <div className={styles.card}>
              <div className={styles.thumbnailWrap}>
                <Link
                  suppressHydrationWarning
                  href={entry.href}
                  aria-label={`${entry.album} ${formattedDate} ${formatRelativeDateTime(entry.dateTimeOriginal) ?? ""}`.trim()}
                >
                  <Thumb
                    src={entry.src.src}
                    width={entry.placeholderWidth}
                    height={entry.placeholderHeight}
                    style={{ backgroundColor: entry.placeholderColor }}
                    className={styles.image}
                    alt=""
                  />
                </Link>
                <Link
                  href={`/search?similar=${encodeURIComponent(
                    toSimilarSearchPath(entry.path),
                  )}`}
                  className={`${overlayButtonStyles.base} ${styles.similarButton}`}
                  aria-label="Find similar photos"
                  title="Find similar photos"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <span className={styles.similarButtonIcon}>🔍</span>
                </Link>
              </div>

              <div className={styles.details}>
                <div className={styles.source}>
                  <strong className={styles.sourceText}>{entry.album}</strong>
                  {formatRelativeDateTime(entry.dateTimeOriginal) ? (
                    <span
                      suppressHydrationWarning
                      className={styles.secondaryMeta}
                      title={
                        formatDateTimeTitle(entry.dateTimeOriginal) ?? undefined
                      }
                    >
                      {formatRelativeDateTime(entry.dateTimeOriginal)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {mapPhotos.length > 0 ? (
        <section
          className={styles.mapSection}
          aria-label={`Map of photos from ${formattedDate}`}
        >
          <div className={styles.mapHeader}>
            <h3 className={styles.mapHeading}>Map</h3>
            <div className={styles.mapCount}>
              {mapPhotos.length} mapped photo{mapPhotos.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className={styles.mapWrap}>
            <MapWorldDeferred
              photos={mapPhotos}
              className={styles.mapCanvas}
              fitToPhotos
              syncRoute={false}
              showThemeBootstrap={false}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
};
