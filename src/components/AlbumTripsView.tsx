import React from "react";
import type { Content } from "../services/types";
import { computeTrips, markFirstVisits, markLaterReturns } from "../util/computeTrips";
import { albumTripPhotos } from "../util/videoBlockMedia";
import { Caption } from "./ui";
import { TripDetail } from "./TripDetail";
import styles from "./AlbumTripsView.module.css";

/**
 * The album's own media, grouped into the journeys it was taken on.
 *
 * Computed in the browser from blocks the page already holds, so this view adds
 * nothing to the payload. That is also why it can afford to keep every frame:
 * unlike the explore list, it is not shipping anything extra to show them. A
 * clip joins a photograph here, carrying the moment it was captured.
 */
export const AlbumTripsView = ({ album }: { album: Content }) => {
  const trips = React.useMemo(
    () => markLaterReturns(markFirstVisits(computeTrips(albumTripPhotos(album)))),
    [album],
  );

  if (trips.length === 0) {
    return (
      <Caption as="p" size="sm">
        This album has no dated photographs, so it cannot be split into trips.
      </Caption>
    );
  }

  return (
    <div className={styles.trips}>
      {trips.map((trip) => (
        <TripDetail key={trip.id} trip={trip} />
      ))}
    </div>
  );
};
