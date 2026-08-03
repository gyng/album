import React from "react";
import type { TimelineEntry } from "../util/pageDataTypes";
import {
  computeTrips,
  markFirstVisits,
  markLaterReturns,
  type TripPhoto,
} from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { AppLink as Link } from "./platform";
import { Caption, Heading, PillButton, SegmentedToggle } from "./ui";
import styles from "./TimelineTripsSection.module.css";

const INITIAL_TRIPS = 4;
const LOAD_MORE_TRIPS = 4;

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
type TripFilter = "all" | "journeys";

export const TimelineTripsSection = ({
  entries,
  onSelectDate,
  selectedDate,
}: {
  entries: TimelineEntry[];
  onSelectDate: (date: string) => void;
  /** The day the timeline is showing, so this list can point at it. */
  selectedDate?: string | null;
}) => {
  const [visible, setVisible] = React.useState(INITIAL_TRIPS);
  const [filter, setFilter] = React.useState<TripFilter>("all");
  const trips = React.useMemo(
    () =>
      markLaterReturns(
        markFirstVisits(
          computeTrips(
            // Videos carry no geocode, so they cannot take part in the country
            // rule and would make this page's counts disagree with /trips and
            // explore, which group photographs.
            entries.filter((entry) => entry.mediaKind !== "video").map(toTripPhoto),
          ),
        ),
      ),
    [entries],
  );

  const journeys = React.useMemo(() => trips.filter((trip) => !trip.isOuting), [trips]);
  const listed = filter === "journeys" ? journeys : trips;

  // The page already knows which day is open, and this list is newest-first, so
  // the trip holding it can easily sit past the fold. It comes along.
  const selectedIndex = selectedDate
    ? listed.findIndex((trip) => trip.days.some((day) => day.date === selectedDate))
    : -1;

  if (trips.length === 0) return null;

  const shown = listed.slice(0, Math.max(visible, selectedIndex + 1));

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
        {/* Most of the list is outings, so a reader after a journey can say so. */}
        {journeys.length > 0 && journeys.length < trips.length ? (
          <SegmentedToggle
            className={styles.filter}
            ariaLabel="Which trips to list"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "journeys", label: "Journeys" },
            ]}
          />
        ) : null}
      </div>

      <ul className={styles.list}>
        {shown.map((trip) => {
          const swatches = Array.from(
            new Set(trip.days.map((day) => day.colour).filter(Boolean) as string[]),
          ).slice(0, 4);
          return (
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
                {swatches.length > 0 ? (
                  <span className={styles.swatches} aria-hidden="true">
                    {swatches.map((colour) => (
                      <span key={colour} className={styles.swatch} style={{ background: colour }} />
                    ))}
                  </span>
                ) : null}
                {trip.places.length > 0 ? (
                  <span className={styles.places}>{trip.places.slice(0, 6).join(" → ")}</span>
                ) : null}
                {trip.firstVisits.length > 0 ? (
                  <span className={styles.firsts}>
                    First time in {trip.firstVisits.slice(0, 4).join(", ")}
                  </span>
                ) : null}
                {trip.laterReturns.length > 0 ? (
                  <span className={styles.returns}>
                    Came back:{" "}
                    {trip.laterReturns
                      .slice(0, 3)
                      .map((entry) => `${entry.place} in ${entry.year}`)
                      .join(", ")}
                  </span>
                ) : null}
                {/* Its route, gear and unusual subjects live on the trips page;
                    this list is a way into the day view beside it. */}
                <Link className={styles.whole} href={`/trips#trip-${trip.id}`}>
                  See the whole trip
                </Link>
              </div>

              <div className={styles.days}>
                {trip.days.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    className={[styles.day, day.date === selectedDate ? styles.dayCurrent : null]
                      .filter(Boolean)
                      .join(" ")}
                    {...(day.date === selectedDate ? { "aria-current": "date" as const } : {})}
                    onClick={() => onSelectDate(day.date)}
                  >
                    <span className={styles.dayDate}>{longDate(day.date)}</span>
                    <span className={styles.dayCount}>{day.count}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {shown.length < listed.length ? (
        <PillButton
          className={styles.loadMore}
          onClick={() => setVisible((count) => Math.min(count + LOAD_MORE_TRIPS, listed.length))}
        >
          <span>Load more trips</span>
        </PillButton>
      ) : null}
    </section>
  );
};
