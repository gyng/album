import { getDegLatLngFromExif } from "../../util/dms2deg";
import { getMapPhotoHref, hasMapCoordinates } from "../../util/mapSearchIndex";
import { packMapWorldEntry, type MapWorldEntryRow } from "../../util/pageDataRows";
import type { MapWorldEntry } from "../../util/pageDataTypes";
import { getAlbums } from "../album";
import { toVideoBlockEntry } from "../../util/videoBlockEntry";

export type MapPageData = { photoRows: MapWorldEntryRow[] };

// A geotagged clip is a place you stood, the same as a photo taken beside it.
// Its coordinates come from the container's own location tag, read when the
// poster frame was extracted, and the frame is what the map draws.
const videoMapEntries = (album: Awaited<ReturnType<typeof getAlbums>>[number]) =>
  album.blocks.flatMap((block): MapWorldEntry[] => {
    const video = toVideoBlockEntry(block);
    if (!video || video.decLat === null || video.decLng === null) return [];
    const tags = video.block._build?.tags;
    const color = tags?.colors?.[0];

    return [
      {
        album: album._build.slug,
        mediaKind: "video",
        clipPath: `../albums/${album._build.slug}/${video.anchor}`,
        src: video.poster,
        decLng: video.decLng,
        decLat: video.decLat,
        date: video.capturedAtLocal,
        // The zone the indexer derived for the clip, as a photograph's pin has.
        dateOffset: tags?.tz_offset ?? null,
        href: `/album/${album._build.slug}#${encodeURIComponent(video.anchor)}`,
        // The poster's own colour from the clip's indexed row, as a photograph's.
        placeholderColor: color ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)` : "transparent",
        placeholderHeight: video.poster.height,
        placeholderWidth: video.poster.width,
      },
    ];
  });

export const loadMapPageData = async (): Promise<MapPageData> => {
  const albums = await getAlbums();
  const entries = albums.flatMap((album) => [
    ...videoMapEntries(album),
    ...album.blocks.filter(hasMapCoordinates).flatMap((photo) => {
      const src = photo._build.srcset?.[0];
      if (!src) return [];
      const {
        GPSLongitude,
        GPSLatitude,
        GPSLongitudeRef,
        GPSLatitudeRef,
        DateTimeOriginal,
        OffsetTime,
      } = photo._build.exif;
      const { decLng, decLat } = getDegLatLngFromExif({
        ...(GPSLongitude !== undefined ? { GPSLongitude } : {}),
        ...(GPSLatitude !== undefined ? { GPSLatitude } : {}),
        ...(GPSLongitudeRef !== undefined ? { GPSLongitudeRef } : {}),
        ...(GPSLatitudeRef !== undefined ? { GPSLatitudeRef } : {}),
      });
      const color = photo._build.tags?.colors?.[0];
      const entry: MapWorldEntry = {
        album: album._build.slug,
        src,
        decLng,
        decLat,
        date: DateTimeOriginal ?? null,
        // Derived-from-location wins over the camera's own tag; see Photo.tsx.
        dateOffset: photo._build.tags?.tz_offset ?? OffsetTime ?? null,
        href: getMapPhotoHref(album._build.slug, photo),
        placeholderColor: color ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)` : "transparent",
        placeholderHeight: photo._build.height,
        placeholderWidth: photo._build.width,
      };
      return [entry];
    }),
  ]);
  return { photoRows: entries.map(packMapWorldEntry) };
};
