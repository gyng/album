import { getDegLatLngFromExif } from "../../util/dms2deg";
import { formatExifWallClockIso, parseExifLocalDateTime } from "../../util/exifTime";
import { packTimelineEntry, type TimelineEntryRow } from "../../util/pageDataRows";
import type { TimelineEntry } from "../../util/pageDataTypes";
import { getAlbums } from "../album";
import { toVideoBlockEntry } from "../../util/videoBlockEntry";
import type { Block, PhotoBlock } from "../types";

export type TimelinePageData = { entryRows: TimelineEntryRow[] };

const isTimelinePhoto = (block: Block): block is PhotoBlock =>
  block.kind === "photo" && Boolean(block._build.exif.DateTimeOriginal);

const videoTimelineEntries = (album: Awaited<ReturnType<typeof getAlbums>>[number]) =>
  album.blocks.flatMap((block): TimelineEntry[] => {
    const video = toVideoBlockEntry(block);
    if (!video) return [];

    const wallClock = parseExifLocalDateTime(video.capturedAtLocal);
    if (!wallClock) return [];
    const wallClockIso = formatExifWallClockIso(wallClock);

    return [
      {
        album: album._build.slug,
        mediaKind: "video",
        date: wallClockIso.slice(0, 10),
        dateTimeOriginal: wallClockIso,
        decLat: video.decLat,
        decLng: video.decLng,
        geocode: null,
        src: video.poster,
        href: `/album/${album._build.slug}#${encodeURIComponent(video.anchor)}`,
        // The same shape a photo's path takes here: a public media path, which
        // the "find similar" link maps back to the source path the database
        // indexed this clip under.
        path: `/data/albums/${album._build.slug}/${video.anchor}`,
        // A poster's own palette is not extracted at build time, so the tile
        // falls back to the neutral placeholder photos use when uncoloured.
        placeholderColor: "transparent",
        placeholderWidth: video.poster.width,
        placeholderHeight: video.poster.height,
      },
    ];
  });

export const loadTimelinePageData = async (): Promise<TimelinePageData> => {
  const albums = await getAlbums();
  const entries = albums
    .flatMap((album) => [
      ...videoTimelineEntries(album),
      ...album.blocks.filter(isTimelinePhoto).flatMap((photo) => {
        const dateTimeOriginal = photo._build.exif.DateTimeOriginal;
        const src = photo._build.srcset?.[0];
        if (!src) return [] as TimelineEntry[];

        // EXIF time is camera-local wall-clock time; never pass through UTC.
        const wallClock = parseExifLocalDateTime(dateTimeOriginal);
        if (!wallClock) return [] as TimelineEntry[];
        const wallClockIso = formatExifWallClockIso(wallClock);
        const filename = photo.data.src.split("/").at(-1)!;
        const primaryColor = photo._build.tags?.colors?.[0];
        const geocode = photo._build.tags?.geocode ?? null;
        const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef } = photo._build.exif;
        const { decLng, decLat } =
          GPSLongitude && GPSLatitude && GPSLongitudeRef && GPSLatitudeRef
            ? getDegLatLngFromExif({
                GPSLongitude,
                GPSLatitude,
                GPSLongitudeRef,
                GPSLatitudeRef,
              })
            : { decLng: null, decLat: null };

        return [
          {
            album: album._build.slug,
            date: wallClockIso.slice(0, 10),
            dateTimeOriginal: wallClockIso,
            dateOffset: photo._build.tags?.tz_offset ?? photo._build.exif.OffsetTime ?? null,
            decLat,
            decLng,
            geocode,
            src,
            href: `/album/${album._build.slug}#${encodeURIComponent(filename)}`,
            path: photo.data.src,
            placeholderColor: primaryColor
              ? `rgba(${primaryColor[0]}, ${primaryColor[1]}, ${primaryColor[2]}, 1)`
              : "transparent",
            placeholderWidth: photo._build.width,
            placeholderHeight: photo._build.height,
          },
        ];
      }),
    ])
    .sort((left, right) => {
      if (left.date !== right.date) return right.date.localeCompare(left.date);
      if (left.dateTimeOriginal !== right.dateTimeOriginal) {
        return right.dateTimeOriginal.localeCompare(left.dateTimeOriginal);
      }
      return left.href.localeCompare(right.href);
    });
  return { entryRows: entries.map(packTimelineEntry) };
};
