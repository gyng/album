import type { Content, PhotoBlock } from "../types";
import { computeTrips, markFirstVisits, type Trip, type TripPhoto } from "../../util/computeTrips";
import { getGeocodeCity, getGeocodeCountry } from "../../util/geocode";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import { getMapPhotoHref } from "../../util/mapSearchIndex";
import { encodePublicAssetPath } from "../../util/encodePublicAssetPath";
import { rgbToString } from "../../util/colorDistance";
import { getAlbums } from "../album";

export type TripsPageData = { trips: Trip[] };

/**
 * Enough frames per day to recognise it, few enough that a page covering every
 * journey in the archive stays under Next's page-data warning threshold. Each day's
 * colour and hours are computed before this trim, so the trim costs nothing but
 * thumbnails.
 */
const PHOTOS_PER_DAY = 3;

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
    // Never undefined: getStaticProps cannot serialise it.
    label: photo.data.title ?? photo.id ?? "",
    city: getGeocodeCity(geocode),
    country: getGeocodeCountry(geocode),
    lat: typeof decLat === "number" ? decLat : null,
    lng: typeof decLng === "number" ? decLng : null,
    ...(dominant ? { swatch: rgbToString(dominant) } : {}),
  };
};

export const loadTripsPageData = async (): Promise<TripsPageData> => {
  const albums = await getAlbums();
  const photos = albums.flatMap((album) =>
    album.blocks
      .filter((block): block is PhotoBlock => block.kind === "photo")
      .map((photo) => toTripPhoto(album, photo)),
  );

  const trips = markFirstVisits(computeTrips(photos)).map((trip) => ({
    ...trip,
    days: trip.days.map((day) => ({ ...day, photos: day.photos.slice(0, PHOTOS_PER_DAY) })),
  }));

  return { trips };
};
