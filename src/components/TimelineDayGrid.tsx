import { AppLink as Link } from "./platform";
import React from "react";
import { MapWorldDeferred } from "./MapWorldDeferred";
import type { MapWorldEntry, TimelineEntry } from "../util/pageDataTypes";
import { HydratedRelativeTime } from "./HydratedRelativeTime";
import { Caption, Heading, Thumb, buttonStyles, overlayButtonStyles } from "./ui";
import styles from "./TimelineDayGrid.module.css";
import {
  exifWallClockTimestamp,
  formatExifWallClockDate,
  formatExifWallClockDateTime,
} from "../util/exifTime";
import { summariseTimelineGeocode } from "../util/pageDataRows";

const formatLongDate = (date: string) => formatExifWallClockDate(`${date}T00:00:00`) ?? date;

const formatDateTimeTitle = (dateTimeOriginal: string) =>
  formatExifWallClockDateTime(dateTimeOriginal);

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
  dateHeadingRef?: React.Ref<HTMLDivElement>;
}) => {
  const mapLoadTargetRef = React.useRef<HTMLDivElement | null>(null);
  const [isMapVisible, setIsMapVisible] = React.useState(false);
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

  React.useEffect(() => {
    if (!date || mapPhotos.length === 0 || isMapVisible) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsMapVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (observations) => {
        if (observations.some((observation) => observation.isIntersecting)) {
          observer.disconnect();
          setIsMapVisible(true);
        }
      },
      { rootMargin: "600px 0px" },
    );
    const target = mapLoadTargetRef.current;
    if (target) {
      observer.observe(target);
    }

    return () => observer.disconnect();
  }, [date, isMapVisible, mapPhotos.length]);

  if (!date) {
    return (
      <section className={styles.emptyState} aria-label="No day selected">
        <Heading level={1} as="h2">
          Pick a day
        </Heading>
        <Caption size="sm">Choose a day from the heatmap, or jump to a random one.</Caption>
        <div className={styles.dayNavButtons}>
          {onSelectOlderDate ? (
            <button
              type="button"
              className={buttonStyles.base}
              onClick={onSelectOlderDate}
              disabled
            >
              ← Older
            </button>
          ) : null}
          {onSelectRandomDate ? (
            <button type="button" className={buttonStyles.base} onClick={onSelectRandomDate}>
              🎲 Random
            </button>
          ) : null}
          {onSelectNewerDate ? (
            <button
              type="button"
              className={buttonStyles.base}
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
    new Set(entries.map((entry) => summariseTimelineGeocode(entry.geocode)).filter(Boolean)),
  ).join(" · ");

  return (
    <section className={styles.section} aria-label={`Photos from ${formattedDate}`}>
      <div className={styles.header}>
        <div ref={dateHeadingRef}>
          <Heading level={1} as="h2">
            {formattedDate}
          </Heading>
        </div>
        <Caption as="div" size="sm">
          {entries.length} photo{entries.length === 1 ? "" : "s"}
        </Caption>
      </div>

      <div className={styles.dayNavButtons}>
        {onSelectOlderDate ? (
          <button
            type="button"
            className={buttonStyles.base}
            onClick={onSelectOlderDate}
            disabled={!canGoOlder}
            aria-disabled={!canGoOlder}
          >
            ← Older
          </button>
        ) : null}
        {onSelectRandomDate ? (
          <button type="button" className={buttonStyles.base} onClick={onSelectRandomDate}>
            🎲 Random
          </button>
        ) : null}
        {onSelectNewerDate ? (
          <button
            type="button"
            className={buttonStyles.base}
            onClick={onSelectNewerDate}
            disabled={!canGoNewer}
            aria-disabled={!canGoNewer}
          >
            Newer →
          </button>
        ) : null}
      </div>

      {locationSummary ? (
        <div aria-label="Location summary">
          <Caption as="div" size="sm">
            {locationSummary}
          </Caption>
        </div>
      ) : null}

      <ul className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.href} className={styles.item}>
            <div className={styles.card}>
              <div className={styles.thumbnailWrap}>
                <Link href={entry.href} aria-label={`${entry.album} ${formattedDate}`}>
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
                  href={`/search?similar=${encodeURIComponent(toSimilarSearchPath(entry.path))}`}
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
                  {exifWallClockTimestamp(entry.dateTimeOriginal) !== null ? (
                    <span
                      className={styles.secondaryMeta}
                      title={formatDateTimeTitle(entry.dateTimeOriginal)!}
                    >
                      <HydratedRelativeTime
                        date={exifWallClockTimestamp(entry.dateTimeOriginal)!}
                      />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {mapPhotos.length > 0 ? (
        <section className={styles.mapSection} aria-label={`Map of photos from ${formattedDate}`}>
          <div className={styles.mapHeader}>
            <Heading level={2} as="h3" className={styles.mapHeading}>
              Map
            </Heading>
            <Caption as="div">
              {mapPhotos.length} mapped photo{mapPhotos.length === 1 ? "" : "s"}
            </Caption>
          </div>

          <div ref={mapLoadTargetRef} className={styles.mapWrap} aria-busy={!isMapVisible}>
            {isMapVisible ? (
              <MapWorldDeferred
                photos={mapPhotos}
                className={styles.mapCanvas ?? ""}
                fitToPhotos
                syncRoute={false}
                showThemeBootstrap={false}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
};
