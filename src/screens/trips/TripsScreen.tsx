import React from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { TripDetail } from "../../components/TripDetail";
import type { Trip } from "../../util/computeTrips";
import { Caption, Footer, Heading, PillButton } from "../../components/ui";
import { formatPageTitle } from "../../lib/seo";
import styles from "./TripsScreen.module.css";

export type TripsScreenProps = { trips: Trip[] };

const INITIAL_TRIPS = 6;
const LOAD_MORE_TRIPS = 6;

/**
 * Every journey the archive records, across albums.
 *
 * This is the one view an album page cannot offer: a trip filed partly under a
 * theme and partly under a place is one journey here, and twelve of them are
 * split that way.
 */
const TripsScreen = ({ trips }: TripsScreenProps) => {
  const [visible, setVisible] = React.useState(INITIAL_TRIPS);
  const journeys = trips.filter((trip) => !trip.isOuting);
  const acrossAlbums = trips.filter((trip) => trip.albums.length > 1).length;

  return (
    <>
      <Seo
        title={formatPageTitle("Trips")}
        description={`${journeys.length} journeys and ${trips.length - journeys.length} single-day outings, grouped from the photographs themselves.`}
        pathname="/trips"
      />
      <GlobalNav currentPage="trips" />
      <main id="main-content" className={styles.page}>
        <header className={styles.header}>
          <Heading level={1} as="h1">
            Trips
          </Heading>
          <Caption as="p">
            {journeys.length} {journeys.length === 1 ? "journey" : "journeys"} and{" "}
            {trips.length - journeys.length} single-day outings, grouped from the photographs
            themselves — the days they were taken on, and where.
            {acrossAlbums > 0
              ? ` ${acrossAlbums} span more than one album, so no album page can show them whole.`
              : ""}
          </Caption>
        </header>

        <div className={styles.trips}>
          {trips.slice(0, visible).map((trip) => (
            <TripDetail key={trip.id} trip={trip} />
          ))}
        </div>

        {visible < trips.length ? (
          <PillButton
            className={styles.loadMore}
            onClick={() => setVisible((count) => Math.min(count + LOAD_MORE_TRIPS, trips.length))}
          >
            <span>Load more trips</span>
          </PillButton>
        ) : null}
      </main>
      <Footer />
    </>
  );
};

export default TripsScreen;
