import React from "react";
import type { TimelineEntry } from "../util/pageDataTypes";
import { computeTrips, type TripPhoto } from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, PillButton, Thumb } from "./ui";
import styles from "./TimelineTripsSection.module.css";

const INITIAL_TRIPS = 5;
const LOAD_MORE_TRIPS = 5;
/** Enough to recognise the journey; the day view is where you actually look. */
const STRIP_PHOTOS = 10;

/**
 * Timeline entries carry an already-summarised geocode — "city, region, country"
 * joined with commas — not the newline-separated blob `util/geocode` parses.
 * Reading it with those helpers returns the whole string as the country, so
 * every place looks like a different country and a journey breaks on each day.
 */
const geocodeParts = (geocode: string | null | undefined): string[] =>
  (geocode ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const summarisedCity = (geocode: string | null | undefined) => geocodeParts(geocode)[0] ?? null;
const summarisedCountry = (geocode: string | null | undefined) =>
  geocodeParts(geocode).at(-1) ?? null;

const longDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const toTripPhoto = (entry: TimelineEntry): TripPhoto => ({
  date: entry.dateTimeOriginal,
  album: entry.album,
  src: entry.src.src,
  href: entry.href,
  label: entry.path.split("/").at(-1) ?? entry.album,
  city: summarisedCity(entry.geocode),
  country: summarisedCountry(entry.geocode),
  lat: entry.decLat ?? null,
  lng: entry.decLng ?? null,
  ...(entry.placeholderColor ? { swatch: entry.placeholderColor } : {}),
});

/**
 * The journeys inside the timeline, as a way in to its day view.
 *
 * This is the rung between the heatmap and a single day: the heatmap shows that
 * a fortnight was busy, the day view shows one of its days, and nothing else
 * says those days were one trip. Computed from entries the page already holds,
 * so it costs no payload.
 */
export const TimelineTripsSection = ({
  entries,
  onSelectDate,
}: {
  entries: TimelineEntry[];
  onSelectDate: (date: string) => void;
}) => {
  const [visible, setVisible] = React.useState(INITIAL_TRIPS);
  const trips = React.useMemo(() => computeTrips(entries.map(toTripPhoto)), [entries]);

  if (trips.length === 0) return null;

  const journeys = trips.filter((trip) => !trip.isOuting);
  const shown = trips.slice(0, visible);

  return (
    <section className={styles.section} aria-label="Trips">
      <div className={styles.head}>
        <Heading level={2} as="h2">
          Trips
        </Heading>
        <Caption as="span">
          {journeys.length} {journeys.length === 1 ? "journey" : "journeys"} and{" "}
          {trips.length - journeys.length} single-day outings, detected from the photographs
        </Caption>
      </div>

      <ul className={styles.list}>
        {shown.map((trip) => (
          <li key={trip.id} className={styles.trip}>
            <div className={styles.meta}>
              <span className={styles.span}>
                {trip.isOuting
                  ? longDate(trip.startDate)
                  : `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`}
              </span>
              <span className={styles.stats}>
                {trip.isOuting
                  ? `outing · ${trip.photoCount.toLocaleString("en")} photos`
                  : `${trip.dayCount} days · ${trip.photoCount.toLocaleString("en")} photos`}
                {trip.totalKm && trip.totalKm >= 1
                  ? ` · ${Math.round(trip.totalKm).toLocaleString("en")} km`
                  : ""}
              </span>
              {trip.places.length > 0 ? (
                <span className={styles.places}>{trip.places.slice(0, 6).join(" → ")}</span>
              ) : null}
            </div>

            <div className={styles.days}>
              {trip.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={styles.day}
                  onClick={() => onSelectDate(day.date)}
                >
                  <span className={styles.dayDate}>{longDate(day.date)}</span>
                  <span className={styles.dayCount}>{day.count}</span>
                </button>
              ))}
            </div>

            <div className={styles.strip}>
              {trip.days
                .flatMap((day) => day.photos)
                .slice(0, STRIP_PHOTOS)
                .map((photo) => (
                  <Thumb
                    key={photo.href + photo.src}
                    src={photo.src}
                    alt=""
                    size="small"
                    loading="lazy"
                    {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
                  />
                ))}
            </div>
          </li>
        ))}
      </ul>

      {visible < trips.length ? (
        <PillButton
          onClick={() => setVisible((count) => Math.min(count + LOAD_MORE_TRIPS, trips.length))}
        >
          <span>Load more trips</span>
        </PillButton>
      ) : null}
    </section>
  );
};
