import React from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { TripDetail } from "../../components/TripDetail";
import type { Trip } from "../../util/computeTrips";
import { Caption, Footer, Heading, PillButton, SegmentedToggle, Select } from "../../components/ui";
import { formatPageTitle } from "../../lib/seo";
import styles from "./TripsScreen.module.css";
import { useAfterNavigation, useUrlSearchParams } from "../../components/platform";

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
  const { ready, getSearchParam, searchParams, replaceSearchParams } = useUrlSearchParams();
  const rawKind = ready ? getSearchParam("kind") : null;
  const kind: Kind = rawKind === "journeys" || rawKind === "outings" ? rawKind : "all";
  const rawOrder = ready ? getSearchParam("sort") : null;
  const order: Order = rawOrder === "days" || rawOrder === "distance" ? rawOrder : "date";
  const rawYear = ready ? getSearchParam("year") : null;
  const year = rawYear && trips.some((trip) => yearOf(trip) === rawYear) ? rawYear : ALL_YEARS;
  const [linkedTrip, setLinkedTrip] = React.useState<string | null>(null);
  const seenHash = React.useRef<string | null>(null);
  const readHash = React.useCallback(() => {
    if (!ready || seenHash.current === window.location.hash) return;
    seenHash.current = window.location.hash;
    let hash: string;
    try {
      hash = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    const target = trips.find((trip) => `trip-${trip.id}` === hash);
    if (!target) return;
    setLinkedTrip(hash);
    if (
      (year !== ALL_YEARS && yearOf(target) !== year) ||
      (kind !== "all" && target.isOuting !== (kind === "outings"))
    ) {
      const params = new URLSearchParams(searchParams);
      params.delete("year");
      params.delete("kind");
      replaceSearchParams(params);
    }
  }, [ready, trips, year, kind, searchParams, replaceSearchParams]);
  React.useEffect(readHash, [readHash]);
  useAfterNavigation(readHash);
  React.useEffect(() => {
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [readHash]);
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
  const updateFilter = (key: string, value: string, defaultValue: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    replaceSearchParams(params);
    setVisible(INITIAL_TRIPS);
    setLinkedTrip(null);
  };
  const linkedIndex = linkedTrip
    ? listed.findIndex((trip) => `trip-${trip.id}` === linkedTrip)
    : -1;
  const visibleCount = Math.max(visible, linkedIndex + 1);
  React.useEffect(() => {
    if (!linkedTrip || linkedIndex < 0) return;
    document.getElementById(linkedTrip)?.scrollIntoView({ block: "start" });
    setVisible((count) => Math.max(count, linkedIndex + 1));
    setLinkedTrip(null);
  }, [linkedTrip, linkedIndex]);

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
              onChange={(value) => updateFilter("kind", value, "all")}
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
              onChange={(event) => updateFilter("sort", event.target.value, "date")}
            >
              <option value="date">Most recent</option>
              <option value="days">Longest first</option>
              <option value="distance">Furthest first</option>
            </Select>
            <Select
              aria-label="Year"
              value={year}
              onChange={(event) => updateFilter("year", event.target.value, ALL_YEARS)}
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
          {listed.slice(0, visibleCount).map((trip) => (
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
