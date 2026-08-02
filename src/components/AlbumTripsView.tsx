import React from "react";
import type { Content, PhotoBlock } from "../services/types";
import { computeTrips, markFirstVisits, type TripPhoto } from "../util/computeTrips";
import { getGeocodeCity, getGeocodeCountry } from "../util/geocode";
import { getDegLatLngFromExif } from "../util/dms2deg";
import { getMapPhotoHref } from "../util/mapSearchIndex";
import { encodePublicAssetPath } from "../util/encodePublicAssetPath";
import { rgbToString } from "../util/colorDistance";
import { Caption } from "./ui";
import { TripDetail } from "./TripDetail";
import styles from "./AlbumTripsView.module.css";

const toTripPhoto = (album: Content, photo: PhotoBlock): TripPhoto => {
  const exif = photo._build.exif;
  const { decLat, decLng } = getDegLatLngFromExif(exif);
  const geocode = photo._build.tags?.geocode;
  const dominant = photo._build.tags?.colors?.[0] as [number, number, number] | undefined;
  return {
    date: exif.DateTimeOriginal ?? null,
    album: album._build.slug,
    src: photo._build.srcset?.[0]?.src ?? encodePublicAssetPath(photo.data.src),
    href: getMapPhotoHref(album._build.slug, photo),
    label: photo.data.title ?? photo.id ?? "",
    city: getGeocodeCity(geocode),
    country: getGeocodeCountry(geocode),
    lat: typeof decLat === "number" ? decLat : null,
    lng: typeof decLng === "number" ? decLng : null,
    ...(dominant ? { swatch: rgbToString(dominant) } : {}),
  };
};

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
      .map((photo) => toTripPhoto(album, photo));
    return markFirstVisits(computeTrips(photos));
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
