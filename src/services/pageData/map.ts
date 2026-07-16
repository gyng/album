import { getDegLatLngFromExif } from "../../util/dms2deg";
import { getMapPhotoHref, hasMapCoordinates } from "../../util/mapSearchIndex";
import { packMapWorldEntry, type MapWorldEntryRow } from "../../util/pageDataRows";
import type { MapWorldEntry } from "../../util/pageDataTypes";
import { getAlbums } from "../album";

export type MapPageData = { photoRows: MapWorldEntryRow[] };

export const loadMapPageData = async (): Promise<MapPageData> => {
  const albums = await getAlbums();
  const entries = albums.flatMap((album) =>
    album.blocks.filter(hasMapCoordinates).flatMap((photo) => {
      const src = photo._build.srcset?.[0];
      if (!src) return [];
      const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef, DateTimeOriginal } =
        photo._build.exif;
      const { decLng, decLat } = getDegLatLngFromExif({
        GPSLongitude,
        GPSLatitude,
        GPSLongitudeRef,
        GPSLatitudeRef,
      });
      const color = photo._build.tags?.colors?.[0];
      const entry: MapWorldEntry = {
        album: album._build.slug,
        src,
        decLng,
        decLat,
        date: DateTimeOriginal ?? null,
        href: getMapPhotoHref(album._build.slug, photo),
        placeholderColor: color ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)` : "transparent",
        placeholderHeight: photo._build.height,
        placeholderWidth: photo._build.width,
      };
      return [entry];
    }),
  );
  return { photoRows: entries.map(packMapWorldEntry) };
};
