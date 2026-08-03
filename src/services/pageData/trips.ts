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
      // thumbnail and a link and nothing else — everything else it arrived with
      // has already been folded into the trip or the day (gear and tags into
      // the summary, coordinates into `point`, places into `places`), which is
      // what keeps 1,470 of them affordable.
      photos: day.photos.map((photo) => ({
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
