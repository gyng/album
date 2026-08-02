import React from "react";
import { AppLink as Link } from "./platform";
import type { Content, PhotoBlock } from "../services/types";
import { computeTrips, type TripPhoto } from "../util/computeTrips";
import { getGeocodeCity, getGeocodeCountry } from "../util/geocode";
import { getDegLatLngFromExif } from "../util/dms2deg";
import { getMapPhotoHref } from "../util/mapSearchIndex";
import { encodePublicAssetPath } from "../util/encodePublicAssetPath";
import { rgbToString } from "../util/colorDistance";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, Thumb } from "./ui";
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

const longDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const roundKm = (km: number) => (km >= 10 ? Math.round(km) : Math.round(km * 10) / 10);

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
    return computeTrips(photos);
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
        <section key={trip.id} className={styles.trip}>
          <div className={styles.tripHead}>
            <Heading level={2} as="h2">
              {trip.isOuting
                ? longDate(trip.startDate)
                : `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`}
            </Heading>
            <Caption as="span">
              {trip.isOuting
                ? `outing · ${trip.photoCount.toLocaleString("en")} photos`
                : `${trip.dayCount} days · ${trip.photoCount.toLocaleString("en")} photos`}
              {trip.totalKm && trip.totalKm >= 1 ? ` · ${roundKm(trip.totalKm)} km` : ""}
            </Caption>
            {trip.places.length > 0 ? (
              <p className={styles.places}>{trip.places.slice(0, 8).join(" → ")}</p>
            ) : null}
          </div>

          {trip.days.map((day, index) => (
            <section key={day.date} className={styles.day}>
              <div className={styles.rail} aria-hidden="true">
                <span className={styles.dot} />
                {day.movedKm && day.movedKm >= 20 ? (
                  <span className={styles.moved}>{Math.round(day.movedKm)} km</span>
                ) : null}
              </div>
              <div className={styles.meta}>
                {trip.isOuting ? null : <p className={styles.dayno}>Day {index + 1}</p>}
                <Heading level={3} as="h3">
                  {longDate(day.date)}
                </Heading>
                {day.places.length > 0 ? (
                  <p className={styles.places}>{day.places.slice(0, 5).join(" → ")}</p>
                ) : null}
                <p className={styles.stat}>
                  {day.count.toLocaleString("en")} {day.count === 1 ? "photo" : "photos"}
                  {day.from ? ` · ${day.from}–${day.to}` : ""}
                  {day.coveredKm && day.coveredKm >= 1 ? ` · ${roundKm(day.coveredKm)} km` : ""}
                </p>
              </div>
              <div className={styles.strip}>
                {day.photos.map((photo) => (
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
            </section>
          ))}
        </section>
      ))}
    </div>
  );
};
