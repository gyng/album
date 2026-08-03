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

/**
 * Enough frames per day to recognise it, few enough that a page covering every
 * journey in the archive stays under Next's page-data warning threshold. Each day's
 * colour and hours are computed before this trim, so the trim costs nothing but
 * thumbnails.
 */
const PHOTOS_PER_DAY = 3;

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
      // A retained frame is only ever a thumbnail with a link, so it ships
      // exactly that. Everything else it arrived with has already been folded
      // into the trip or the day — gear and distinctive tags into the summary,
      // coordinates into `point`, places into `places` — and this page carries
      // one entry per journey in the archive, so the difference is not small.
      photos: day.photos.slice(0, PHOTOS_PER_DAY).map((photo) => ({
        date: photo.date,
        album: photo.album,
        src: photo.src,
        href: photo.href,
        label: photo.label,
        ...(photo.swatch ? { swatch: photo.swatch } : {}),
      })),
    })),
  }));

  return { trips };
};
