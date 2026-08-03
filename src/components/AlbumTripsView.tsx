import React from "react";
import type { Content, PhotoBlock } from "../services/types";
import { computeTrips, markFirstVisits, markLaterReturns } from "../util/computeTrips";
import { tripPhotoFromBlock } from "../util/tripPhotoFromBlock";
import { Caption } from "./ui";
import { TripDetail } from "./TripDetail";
import styles from "./AlbumTripsView.module.css";

/**
 * The album's own photographs, grouped into the journeys they were taken on.
 *
 * Computed in the browser from blocks the page already holds, so this view adds
 * nothing to the payload. That is also why it can afford to keep every frame:
 * unlike the explore list, it is not shipping anything extra to show them.
 */
export const AlbumTripsView = ({ album }: { album: Content }) => {
  const trips = React.useMemo(() => {
    const photos = album.blocks
      .filter((block): block is PhotoBlock => block.kind === "photo")
      .map((photo) => tripPhotoFromBlock(album, photo));
    return markLaterReturns(markFirstVisits(computeTrips(photos)));
  }, [album]);

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
