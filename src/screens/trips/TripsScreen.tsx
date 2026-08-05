import React from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { TripDetail } from "../../components/TripDetail";
import type { Trip } from "../../util/computeTrips";
import { Caption, Footer, Heading, PillButton, SegmentedToggle, Select } from "../../components/ui";
import { formatPageTitle } from "../../lib/seo";
import styles from "./TripsScreen.module.css";

export type TripsScreenProps = { trips: Trip[] };

const INITIAL_TRIPS = 6;
const LOAD_MORE_TRIPS = 6;

type Kind = "all" | "journeys" | "outings";
type Order = "date" | "days" | "distance";

const ALL_YEARS = "all";

const yearOf = (trip: Trip) => trip.startDate.slice(0, 4);

/**
 * Ninety-four trips arrive newest-first, six at a time. That is a good default
 * and a poor way to find anything in particular: reaching 2015 took eleven
 * clicks, and the journeys were mixed in among fifty-eight single afternoons.
 */
const orderTrips = (trips: Trip[], order: Order): Trip[] => {
  if (order === "date") return trips;
  const by = (trip: Trip) => (order === "days" ? trip.dayCount : (trip.totalKm ?? 0));
  return [...trips].sort(
    (left, right) => by(right) - by(left) || right.startDate.localeCompare(left.startDate),
  );
};

/**
 * Every journey the archive records, across albums.
 *
 * This is the one view an album page cannot offer: a trip filed partly under a
 * theme and partly under a place is one journey here, and twelve of them are
 * split that way.
 */
const TripsScreen = ({ trips }: TripsScreenProps) => {
  const [visible, setVisible] = React.useState(INITIAL_TRIPS);
  const [kind, setKind] = React.useState<Kind>("all");
  const [order, setOrder] = React.useState<Order>("date");
  const [year, setYear] = React.useState<string>(ALL_YEARS);
  const journeys = trips.filter((trip) => !trip.isOuting);

  const years = React.useMemo(
    () => Array.from(new Set(trips.map(yearOf))).sort((left, right) => right.localeCompare(left)),
    [trips],
  );

  const listed = React.useMemo(() => {
    const matching = trips.filter(
      (trip) =>
        (kind === "all" || (kind === "journeys" ? !trip.isOuting : trip.isOuting)) &&
        (year === ALL_YEARS || yearOf(trip) === year),
    );
    return orderTrips(matching, order);
  }, [trips, kind, year, order]);

  // A narrowed list starts from the top again: keeping a deep scroll position
  // after a filter shows the reader the middle of something they did not ask
  // for.
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setVisible(INITIAL_TRIPS);
    };

  return (
    <div className={styles.page}>
      <Seo
        title={formatPageTitle("Trips")}
        description={`${journeys.length} journeys and ${trips.length - journeys.length} single-day outings, grouped from the photographs themselves.`}
        pathname="/trips"
      />
      {/* Same shell as the timeline and explore: the nav sits inside main and
          brings no padding of its own, so it lines up across pages. */}
      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="trips" hasPadding={false} />
        <header className={styles.header}>
          <Heading level={1} as="h1">
            Trips
          </Heading>
          {/* The count, and nothing else: how a trip was worked out from dates and
              places is not something a reader of this page has to be told, and the
              albums an itinerary crosses are visible on the itinerary itself. */}
          <Caption as="p">
            {journeys.length} {journeys.length === 1 ? "journey" : "journeys"} and{" "}
            {trips.length - journeys.length} single-day outings
          </Caption>
          <div className={styles.controls}>
            <SegmentedToggle
              ariaLabel="Which trips to show"
              value={kind}
              onChange={reset<Kind>(setKind)}
              options={[
                { value: "all", label: "All" },
                { value: "journeys", label: "Journeys" },
                { value: "outings", label: "Outings" },
              ]}
            />
            {/* The app's own select: same shape as the theme and map-style
                pickers, named by aria-label and by its options rather than by a
                label bolted alongside. */}
            <Select
              aria-label="Sort trips"
              value={order}
              onChange={(event) => reset<Order>(setOrder)(event.target.value as Order)}
            >
              <option value="date">Most recent</option>
              <option value="days">Longest first</option>
              <option value="distance">Furthest first</option>
            </Select>
            <Select
              aria-label="Year"
              value={year}
              onChange={(event) => reset<string>(setYear)(event.target.value)}
            >
              <option value={ALL_YEARS}>Any year</option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        </header>

        <div className={styles.trips}>
          {listed.slice(0, visible).map((trip) => (
            // Anchored so the timeline's trip list — and the reader — can link
            // straight to the whole journey rather than to the top of the page.
            <div key={trip.id} id={`trip-${trip.id}`} className={styles.anchored}>
              <a className={styles.permalink} href={`#trip-${trip.id}`}>
                <span className={styles.permalinkMark} aria-hidden="true">
                  #
                </span>
                <span className={styles.visuallyHidden}>Link to this trip</span>
              </a>
              <TripDetail trip={trip} />
            </div>
          ))}
        </div>

        {listed.length === 0 ? (
          <Caption as="p">No trips match that. Try another year, or show all trips.</Caption>
        ) : null}

        {visible < listed.length ? (
          <PillButton
            className={styles.loadMore}
            onClick={() => setVisible((count) => Math.min(count + LOAD_MORE_TRIPS, listed.length))}
          >
            <span>Load more trips</span>
          </PillButton>
        ) : null}
      </main>
      <Footer />
    </div>
  );
};

export default TripsScreen;
