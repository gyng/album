import { exifWallClockTimestamp, parseExifLocalDateTime } from "../util/exifTime";
import { recencyColor } from "../util/mapColor";
import type { MapWorldEntry, TimeRange } from "../util/pageDataTypes";

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type PhotoDateStats = {
  oldest: MapWorldEntry | undefined;
  newest: MapWorldEntry | undefined;
  oldestMs: number | null;
  range: number;
};

export type PhotoWithStyle = MapWorldEntry & {
  relative: number;
  markerColor: string;
};

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatMapPhotoDate = (value: string | null): string | null => {
  const date = parseExifLocalDateTime(value);
  return date ? `${date.day} ${SHORT_MONTH_NAMES[date.month - 1]} ${date.year}` : null;
};

export const formatMapPhotoDateTime = (value: string | null): string | null => {
  const date = parseExifLocalDateTime(value);
  return date
    ? `${date.day} ${SHORT_MONTH_NAMES[date.month - 1]} ${date.year}, ${pad2(date.hour)}:${pad2(date.minute)}`
    : null;
};

export const isPhotoInTimeRange = (
  photo: Pick<MapWorldEntry, "date">,
  range: TimeRange,
): boolean => {
  const ms = exifWallClockTimestamp(photo.date);
  return ms !== null && ms >= range.fromMs && ms <= range.toMs;
};

export const getPhotoDateStats = (photos: MapWorldEntry[]): PhotoDateStats => {
  const dated = photos
    .map((photo) => ({ photo, ms: exifWallClockTimestamp(photo.date) }))
    .filter((entry): entry is { photo: MapWorldEntry; ms: number } => entry.ms !== null)
    .sort((left, right) => left.ms - right.ms);

  const oldestEntry = dated.at(0);
  const newestEntry = dated.at(-1);
  const oldestMs = oldestEntry?.ms ?? null;
  const range = oldestMs === null || !newestEntry ? 0 : newestEntry.ms - oldestMs;

  return {
    oldest: oldestEntry?.photo,
    newest: newestEntry?.photo,
    oldestMs,
    range,
  };
};

export const stylePhotosByRecency = (
  photos: MapWorldEntry[],
  dateStats: PhotoDateStats,
): PhotoWithStyle[] =>
  photos
    .map((photo) => ({ photo, ms: exifWallClockTimestamp(photo.date) }))
    .sort(
      (left, right) =>
        (left.ms ?? Number.NEGATIVE_INFINITY) - (right.ms ?? Number.NEGATIVE_INFINITY),
    )
    .map(({ photo, ms }) => {
      const rawRelative =
        dateStats.range > 0 && ms !== null && dateStats.oldestMs !== null
          ? (ms - dateStats.oldestMs) / dateStats.range
          : 0;
      const relative = Number.isFinite(rawRelative) ? Math.min(1, Math.max(0, rawRelative)) : 0;

      return {
        ...photo,
        relative,
        markerColor: recencyColor(relative),
      };
    });

export const filterPhotosByBounds = (
  photos: PhotoWithStyle[],
  bounds: MapBounds | null,
): PhotoWithStyle[] => {
  if (!bounds) {
    return [];
  }

  return photos.filter((photo) => {
    if (photo.decLat === null || photo.decLng === null) {
      return false;
    }

    const inLatitude = photo.decLat >= bounds.south && photo.decLat <= bounds.north;
    const inLongitude =
      bounds.west <= bounds.east
        ? photo.decLng >= bounds.west && photo.decLng <= bounds.east
        : photo.decLng >= bounds.west || photo.decLng <= bounds.east;

    return inLatitude && inLongitude;
  });
};

const normaliseMapSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const filterPhotosByQuery = <T extends MapWorldEntry>(
  photos: T[],
  query: string,
  searchTextByHref?: ReadonlyMap<string, string>,
): T[] => {
  const terms = normaliseMapSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return photos;
  }

  return photos.filter((photo) => {
    const corpus = normaliseMapSearchText(
      `${photo.album} ${photo.date ?? ""} ${photo.href} ${searchTextByHref?.get(photo.href) ?? ""}`,
    );
    return terms.every((term) => corpus.includes(term));
  });
};

export const getLegendYears = (
  dateStats: Pick<PhotoDateStats, "oldest" | "newest">,
): { older: string; newer: string } => {
  const older = dateStats.oldest?.date?.match(/^\d{4}/)?.[0] ?? null;
  const newer = dateStats.newest?.date?.match(/^\d{4}/)?.[0] ?? null;

  if (!older || !newer || older === newer) {
    return { older: "Older", newer: "Newer" };
  }

  return { older, newer };
};

/* -------------------------------------------------------------------------- */
/* Thumbnail reveal                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What the photo markers are doing about their thumbnails right now.
 *
 * `hidden` is the bulk GPU layer, `shown` is a DOM marker each with its image.
 * `warming` is neither: still the GPU layer, but close enough to the reveal
 * that the images worth showing are worth fetching, so the swap lands on
 * pictures the browser already has rather than on empty boxes.
 */
export type ThumbnailStage = "hidden" | "warming" | "shown";

/** Above this zoom the markers carry their thumbnails. */
export const THUMBNAIL_REVEAL_ZOOM = 8.5;
/**
 * And below *this* one they give them up again — deliberately not the same
 * number. A single threshold is a coin balanced on its edge: a trackpad pinch
 * or a momentum zoom settling on 8.5 flips the entire marker path, GPU layer to
 * DOM markers and back, on consecutive frames. The gap is the wobble a gesture
 * is allowed before the map changes its mind.
 */
export const THUMBNAIL_HIDE_ZOOM = 8.2;
/**
 * Where the images start loading, half a zoom level before anything shows them.
 * A thumbnail that arrives with the marker fades in from nothing; one that has
 * to be fetched first shows its placeholder colour, then snaps to the photo.
 */
export const THUMBNAIL_WARM_ZOOM = 8;

export const nextThumbnailStage = (zoom: number, current: ThumbnailStage): ThumbnailStage => {
  // Which threshold applies depends on where the markers already are: the
  // reveal zoom going up, the lower hide zoom coming back down.
  const revealed = current === "shown" ? zoom >= THUMBNAIL_HIDE_ZOOM : zoom > THUMBNAIL_REVEAL_ZOOM;
  if (revealed) {
    return "shown";
  }

  return zoom > THUMBNAIL_WARM_ZOOM ? "warming" : "hidden";
};

/* -------------------------------------------------------------------------- */
/* Thumbnail thinning                                                          */
/* -------------------------------------------------------------------------- */

export type ScreenCellOptions = {
  bounds: MapBounds;
  /** The map container's size, which is what turns a cell in pixels into one in degrees. */
  width: number;
  height: number;
  cellPx: number;
};

/**
 * Splits photos into the ones worth a DOM thumbnail and the ones a drawn pin
 * will do for.
 *
 * Over a dense city every photo in view used to get its own marker — 164 of
 * them at one measured pose, ~80px each in a 1280x800 viewport, so their
 * thumbnails covered more area than the screen has and almost all of them were
 * hidden behind each other. They were not free: the map repositions every marker
 * every frame, measured at ~0.045ms each, which is where a dense pan's stutter
 * comes from (frame p95 67ms against 33ms with no photos at the same pose).
 *
 * So at most one thumbnail per cell of the screen, and the rest keep a pin on
 * the GPU layer, which costs nothing per marker. The grid is anchored to the
 * world rather than to the viewport, so panning does not reshuffle which photo
 * in a cell is the one wearing the thumbnail.
 */
export const thinPhotosByScreenCell = <T extends MapWorldEntry>(
  photos: T[],
  { bounds, width, height, cellPx }: ScreenCellOptions,
  /**
   * The photos that already carry a thumbnail. They keep their cell for as long
   * as they are in range: a pan brings new photos into range constantly, and
   * without incumbency a newcomer could take the cell from the picture the
   * reader is looking at — swapping one photo for another in the same spot.
   */
  incumbents: ReadonlySet<string> = new Set(),
): { thumbnails: T[]; pins: T[] } => {
  const latitudeSpan = bounds.north - bounds.south;
  const rawLongitudeSpan = bounds.east - bounds.west;
  const longitudeSpan = rawLongitudeSpan >= 0 ? rawLongitudeSpan : rawLongitudeSpan + 360;
  const cellLat = (cellPx / height) * latitudeSpan;
  const cellLng = (cellPx / width) * longitudeSpan;

  // Nothing measurable to thin by — a container with no size, or a viewport
  // with no span. Keep every thumbnail rather than dropping photos on the
  // strength of a degenerate calculation.
  if (!Number.isFinite(cellLat) || !Number.isFinite(cellLng) || cellLat <= 0 || cellLng <= 0) {
    return { thumbnails: photos, pins: [] };
  }

  const cellOf = (photo: T): string | null =>
    photo.decLat === null || photo.decLng === null
      ? null
      : `${Math.floor(photo.decLat / cellLat)}:${Math.floor(photo.decLng / cellLng)}`;

  // Incumbents first, so they claim their cells before anything else can.
  const taken = new Set<string>();
  photos.forEach((photo) => {
    if (!incumbents.has(photo.href)) {
      return;
    }
    const cell = cellOf(photo);
    if (cell !== null) {
      taken.add(cell);
    }
  });

  const thumbnails: T[] = [];
  const pins: T[] = [];
  photos.forEach((photo) => {
    const cell = cellOf(photo);
    // A photo with no coordinates is not on the map to begin with; it is not the
    // thinning's business to drop it.
    if (cell === null) {
      thumbnails.push(photo);
      return;
    }

    if (incumbents.has(photo.href)) {
      thumbnails.push(photo);
      return;
    }

    if (taken.has(cell)) {
      pins.push(photo);
      return;
    }

    taken.add(cell);
    thumbnails.push(photo);
  });

  return { thumbnails, pins };
};
