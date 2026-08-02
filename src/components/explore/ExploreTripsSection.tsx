import React from "react";
import { AppLink as Link } from "../platform";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import type { TripSummary } from "../../util/computeTrips";
import { Caption, Heading, PillButton, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreTripsSection.module.css";
import { formatExifWallClockDate } from "../../util/exifTime";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "loadMoreButton",
    "section",
    "sectionHeader",
    "sectionWide",
    "tripAlbums",
    "tripHead",
    "tripItem",
    "tripList",
    "tripPlaces",
    "tripSpan",
    "tripStats",
    "tripStrip",
  ],
  [],
);

const INITIAL_TRIPS = 4;
const LOAD_MORE_TRIPS = 4;

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

const summarise = (trips: TripSummary[]) => {
  const journeys = trips.filter((trip) => !trip.isOuting).length;
  const outings = trips.length - journeys;
  return [
    journeys > 0 ? plural(journeys, "journey", "journeys") : null,
    outings > 0 ? plural(outings, "single-day outing", "single-day outings") : null,
  ]
    .filter(Boolean)
    .join(" and ");
};

const shortDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const formatSpan = (trip: TripSummary) =>
  trip.isOuting
    ? shortDate(trip.startDate)
    : `${shortDate(trip.startDate)} – ${shortDate(trip.endDate)}`;

/**
 * The journeys the archive records, newest first.
 *
 * Most of these are single days: 58 of 94 in this archive. They are labelled as
 * outings rather than dressed up as journeys, because a fortnight abroad and an
 * afternoon in a park are not the same thing and the list should not pretend
 * otherwise.
 */
export const ExploreTripsSection = ({ trips }: { trips: TripSummary[] }) => {
  const [visible, setVisible] = React.useState(INITIAL_TRIPS);
  if (trips.length === 0) return null;

  const shown = trips.slice(0, visible);

  return (
    <section className={`${styles.section} ${styles.sectionWide}`}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Trips
        </Heading>
        <Caption as="span">{summarise(trips)}</Caption>
      </div>

      <ul className={styles.tripList}>
        {shown.map((trip) => {
          return (
            <li key={trip.id} className={styles.tripItem}>
              <div className={styles.tripHead}>
                <span className={styles.tripSpan}>{formatSpan(trip)}</span>
                <span className={styles.tripStats}>
                  {trip.isOuting
                    ? `outing · ${trip.photoCount.toLocaleString("en")} photos`
                    : `${trip.dayCount} days · ${trip.photoCount.toLocaleString("en")} photos`}
                  {trip.totalKm && trip.totalKm >= 1
                    ? ` · ${Math.round(trip.totalKm).toLocaleString("en")} km`
                    : ""}
                </span>
              </div>
              {trip.places.length > 0 ? (
                <p className={styles.tripPlaces}>{trip.places.slice(0, 6).join(" → ")}</p>
              ) : null}
              <p className={styles.tripAlbums}>
                {trip.albums.map((album, index) => (
                  <React.Fragment key={album}>
                    {index > 0 ? ", " : ""}
                    <Link href={`/album/${album}?view=trips`}>{album}</Link>
                  </React.Fragment>
                ))}
              </p>
              <div className={styles.tripStrip}>
                {trip.photos.map((photo) => (
                  <Link key={photo.href + photo.src} href={photo.href}>
                    <Thumb
                      src={photo.src}
                      alt={photo.label}
                      size="small"
                      loading="lazy"
                      {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
                    />
                  </Link>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {visible < trips.length ? (
        <PillButton
          className={styles.loadMoreButton}
          onClick={() => setVisible((count) => Math.min(count + LOAD_MORE_TRIPS, trips.length))}
        >
          <span>Load more trips</span>
        </PillButton>
      ) : null}
    </section>
  );
};
