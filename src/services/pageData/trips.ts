import type { PhotoBlock } from "../types";
import {
  computeTrips,
  markFirstVisits,
  markLaterReturns,
  type Trip,
} from "../../util/computeTrips";
import { tripPhotoFromBlock } from "../../util/tripPhotoFromBlock";
import { getAlbums } from "../album";

export type TripsPageData = { trips: Trip[] };

export const loadTripsPageData = async (): Promise<TripsPageData> => {
  const albums = await getAlbums();
  const photos = albums.flatMap((album) =>
    album.blocks
      .filter((block): block is PhotoBlock => block.kind === "photo")
      .map((photo) => tripPhotoFromBlock(album, photo)),
  );

  const trips = markLaterReturns(markFirstVisits(computeTrips(photos))).map((trip) => ({
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      // Every frame of every day: a day showing three of its forty-one, with a
      // chip standing in for the rest, is not the day. A frame ships as a
      // thumbnail, a link and where it was taken — the route map draws a marker
      // per photograph, so dropping the coordinates left a six-photograph
      // afternoon with a single pin. Gear and tags are already folded into the
      // trip's own summary and do not ride along.
      photos: day.photos.map((photo) => ({
        date: photo.date,
        album: photo.album,
        src: photo.src,
        href: photo.href,
        label: photo.label,
        ...(typeof photo.lat === "number" ? { lat: photo.lat } : {}),
        ...(typeof photo.lng === "number" ? { lng: photo.lng } : {}),
        ...(photo.swatch ? { swatch: photo.swatch } : {}),
      })),
    })),
  }));

  return { trips };
};
