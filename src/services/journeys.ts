import fs from "fs";
import path from "path";
import { buildMapRoute, distanceMetersBetween } from "../components/mapRoute";
import type { MapWorldEntry } from "../components/MapWorld";
import { getDegLatLngFromExif } from "../util/dms2deg";
import { measureBuild } from "./buildTiming";
import { Content, PhotoBlock } from "./types";

type JourneyCover = {
  href: string;
  src: string;
  width: number | null;
  height: number | null;
  placeholderColor: string | null;
};

export type JourneyStop = {
  id: string;
  journeyId: string;
  sequenceIndex: number;
  albumSlug: string;
  title: string;
  summary: string;
  tags: string[];
  placeLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  photoCount: number;
  decLat: number;
  decLng: number;
  coverHref: string;
  cover: JourneyCover;
  memberHrefs: string[];
};

export type Journey = {
  id: string;
  albumSlug: string;
  albumTitle: string | null;
  albumCount: number;
  title: string;
  summary: string;
  tags: string[];
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  distanceKm: number;
  stopCount: number;
  geotaggedPhotoCount: number;
  startPlace: string | null;
  endPlace: string | null;
  cover: JourneyCover;
  mapHref: string;
  timelineHref: string;
  albumHref: string;
  memberHrefs: string[];
  stops: JourneyStop[];
};

type JourneyEnrichment = {
  title?: string;
  summary?: string;
  tags?: string[];
};

type JourneyStopEnrichment = {
  title?: string;
  summary?: string;
  tags?: string[];
};

export type JourneyEnrichmentOverrides = {
  journeys?: Record<string, JourneyEnrichment>;
  stops?: Record<string, JourneyStopEnrichment>;
};

type BuildJourneysOptions = {
  enrichmentOverrides?: JourneyEnrichmentOverrides | null;
};

type JourneySourceEntry = MapWorldEntry & {
  geocode: string | null;
  albumTitle: string | null;
};

type CoordinateEntry = {
  decLat: number;
  decLng: number;
};

const TRIP_GAP_BREAK_MS = 5 * 24 * 60 * 60 * 1000;

const isPhotoBlockWithGps = (block: PhotoBlock): boolean => {
  const exif = block._build?.exif ?? {};
  return Boolean(
    exif.GPSLongitude &&
    exif.GPSLatitude &&
    exif.GPSLongitudeRef &&
    exif.GPSLatitudeRef &&
    exif.DateTimeOriginal,
  );
};

const getPhotoFilename = (src: string): string => {
  return src.split("/").at(-1) ?? src;
};

const toPlaceholderColor = (color?: [number, number, number]): string => {
  if (!color) {
    return "transparent";
  }

  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
};

const isNumericGeocodeToken = (token: string): boolean => {
  return /^-?\d+(?:\.\d+)?$/.test(token);
};

const cleanGeocodeFragment = (fragment: string): string | null => {
  const cleanedTokens = fragment
    .replace(/[()[\]]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !isNumericGeocodeToken(token))
    .filter((token) => !/^\d{4,}$/.test(token))
    .filter((token) => !/^[A-Z]{2,3}$/.test(token));

  const dedupedTokens = cleanedTokens.filter((token, index) => {
    return cleanedTokens.findIndex(
      (candidate) => candidate.toLowerCase() === token.toLowerCase(),
    ) === index;
  });

  if (dedupedTokens.length === 0) {
    return null;
  }

  if (dedupedTokens.length === 1) {
    return dedupedTokens[0] ?? null;
  }

  return dedupedTokens.slice(0, 2).join(" ");
};

const getPlaceLabel = (geocode: string | null): string | null => {
  if (!geocode) {
    return null;
  }

  const parts = geocode
    .split(",")
    .map((part) => cleanGeocodeFragment(part))
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    return parts[0] ?? null;
  }

  if (parts[0] && parts[1] && parts[0] !== parts[1]) {
    return parts[0];
  }

  return parts[0] ?? null;
};

const formatDistanceKm = (distanceKm: number): string => {
  if (distanceKm >= 100) {
    return `${Math.round(distanceKm)} km`;
  }

  if (distanceKm >= 10) {
    return `${distanceKm.toFixed(1)} km`;
  }

  return `${distanceKm.toFixed(1)} km`;
};

const formatStopDate = (date: string | null): string => {
  if (!date) {
    return "Undated";
  }

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getDurationDays = (
  startDate: string | null,
  endDate: string | null,
): number | null => {
  if (!startDate || !endDate) {
    return null;
  }

  const start = new Date(startDate).valueOf();
  const end = new Date(endDate).valueOf();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
};

const formatDurationLabel = (durationDays: number | null): string | null => {
  if (!durationDays) {
    return null;
  }

  return `${durationDays} day${durationDays === 1 ? "" : "s"}`;
};

const buildJourneyEntries = (album: Content): JourneySourceEntry[] => {
  return album.blocks
    .filter((block): block is PhotoBlock => block.kind === "photo")
    .filter(isPhotoBlockWithGps)
    .map((block) => {
      const exif = block._build?.exif ?? {};
      const { decLat, decLng } = getDegLatLngFromExif({
        GPSLongitude: exif.GPSLongitude,
        GPSLatitude: exif.GPSLatitude,
        GPSLongitudeRef: exif.GPSLongitudeRef,
        GPSLatitudeRef: exif.GPSLatitudeRef,
      });
      const src = block._build?.srcset?.[0];
      const filename = getPhotoFilename(block.data.src);

      return {
        album: album._build.slug,
        albumTitle: album.title ?? null,
        src: src ?? { src: block.data.src, width: 0, height: 0 },
        decLat,
        decLng,
        date: exif.DateTimeOriginal ?? null,
        href: `/album/${album._build.slug}#${filename}`,
        placeholderColor: toPlaceholderColor(block._build?.tags?.colors?.[0]),
        placeholderWidth: block._build?.width,
        placeholderHeight: block._build?.height,
        geocode: block._build?.tags?.geocode ?? null,
      };
    })
    .filter(
      (entry) =>
        typeof entry.decLat === "number" && typeof entry.decLng === "number",
    ) as JourneySourceEntry[];
};

const flattenJourneyEntries = (albums: Content[]): JourneySourceEntry[] => {
  return albums.flatMap((album) => buildJourneyEntries(album));
};

const buildStopSummary = (stop: JourneyStop): string => {
  const dateLabel = formatStopDate(stop.startDate);
  return `${stop.photoCount} photo${stop.photoCount === 1 ? "" : "s"} • ${dateLabel}`;
};

const buildJourneySummary = (journey: {
  stopCount: number;
  distanceKm: number;
  durationDays: number | null;
  startPlace: string | null;
  endPlace: string | null;
}): string => {
  const parts = [
    `${journey.stopCount} stop${journey.stopCount === 1 ? "" : "s"}`,
    formatDistanceKm(journey.distanceKm),
    formatDurationLabel(journey.durationDays),
  ].filter(Boolean);

  const routeLabel =
    journey.startPlace &&
    journey.endPlace &&
    journey.startPlace !== journey.endPlace
      ? `${journey.startPlace} to ${journey.endPlace}`
      : journey.startPlace;

  return routeLabel
    ? `${parts.join(" • ")} • ${routeLabel}`
    : parts.join(" • ");
};

const getJourneyDistanceKm = (entries: CoordinateEntry[]): number => {
  return entries.slice(0, -1).reduce((total, entry, index) => {
    const next = entries[index + 1];
    if (!next) {
      return total;
    }

    return (
      total +
      distanceMetersBetween(
        { decLat: entry.decLat as number, decLng: entry.decLng as number },
        { decLat: next.decLat as number, decLng: next.decLng as number },
      ) /
        1000
    );
  }, 0);
};

const getStopPlaceLabel = (
  stopPoint: { href: string; memberHrefs: string[] },
  entriesByHref: Map<string, JourneySourceEntry>,
): string | null => {
  const entry =
    findEntryForHref(entriesByHref, stopPoint.memberHrefs) ??
    entriesByHref.get(stopPoint.href) ??
    null;

  return getPlaceLabel(entry?.geocode ?? null);
};

const buildDefaultJourneyTitle = (
  startPlace: string | null,
  endPlace: string | null,
  fallbackLabel: string,
): string => {
  if (startPlace && endPlace && startPlace !== endPlace) {
    return `${startPlace} to ${endPlace}`;
  }

  if (startPlace) {
    return startPlace;
  }

  if (endPlace) {
    return endPlace;
  }

  return fallbackLabel;
};

const findEntryForHref = (
  entriesByHref: Map<string, JourneySourceEntry>,
  hrefs: string[],
): JourneySourceEntry | null => {
  for (const href of hrefs) {
    const entry = entriesByHref.get(href);
    if (entry) {
      return entry;
    }
  }

  return null;
};

export const loadJourneyEnrichmentOverrides = (
  filePath = process.env.JOURNEY_ENRICHMENT_FILE,
): JourneyEnrichmentOverrides | null => {
  if (!filePath) {
    return null;
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(resolvedPath, "utf-8"),
  ) as JourneyEnrichmentOverrides;
};

const sortEntriesChronologically = (
  entries: JourneySourceEntry[],
): JourneySourceEntry[] => {
  return [...entries].sort((left, right) => {
    const leftTimestamp = left.date ? new Date(left.date).valueOf() : NaN;
    const rightTimestamp = right.date ? new Date(right.date).valueOf() : NaN;

    if (Number.isNaN(leftTimestamp) && Number.isNaN(rightTimestamp)) {
      return left.href.localeCompare(right.href);
    }

    if (Number.isNaN(leftTimestamp)) {
      return 1;
    }

    if (Number.isNaN(rightTimestamp)) {
      return -1;
    }

    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.href.localeCompare(right.href);
  });
};

const splitEntriesIntoTrips = (
  entries: JourneySourceEntry[],
): JourneySourceEntry[][] => {
  const orderedEntries = sortEntriesChronologically(entries);
  const trips: JourneySourceEntry[][] = [];
  let currentTrip: JourneySourceEntry[] = [];

  for (const entry of orderedEntries) {
    const previous = currentTrip.at(-1);
    if (!previous) {
      currentTrip.push(entry);
      continue;
    }

    const previousTimestamp = previous.date
      ? new Date(previous.date).valueOf()
      : NaN;
    const currentTimestamp = entry.date ? new Date(entry.date).valueOf() : NaN;

    const gapMs =
      Number.isNaN(previousTimestamp) || Number.isNaN(currentTimestamp)
        ? 0
        : currentTimestamp - previousTimestamp;

    if (gapMs > TRIP_GAP_BREAK_MS) {
      if (currentTrip.length >= 2) {
        trips.push(currentTrip);
      }
      currentTrip = [entry];
      continue;
    }

    currentTrip.push(entry);
  }

  if (currentTrip.length >= 2) {
    trips.push(currentTrip);
  }

  return trips;
};

const getPrimaryAlbumSlug = (entries: JourneySourceEntry[]): string => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.album, (counts.get(entry.album) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0]);
  })[0]?.[0] as string;
};

const getJourneyFallbackLabel = (
  entries: JourneySourceEntry[],
  primaryAlbumTitle: string | null,
): string => {
  const startDate = entries[0]?.date ? new Date(entries[0].date) : null;

  if (startDate && !Number.isNaN(startDate.valueOf())) {
    return startDate.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  }

  return primaryAlbumTitle?.trim() || entries[0]?.album || "Trip";
};

const getTripId = (entries: JourneySourceEntry[]): string => {
  const first = entries[0];
  const startDate = first?.date ? first.date.slice(0, 10) : "undated";
  const hrefSlug =
    first?.href
      .split("#")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "trip";

  return `${startDate}:${first?.album ?? "archive"}:${hrefSlug}`;
};

export const buildJourneys = (
  albums: Content[],
  options?: BuildJourneysOptions,
): Journey[] => {
  const enrichmentOverrides = options?.enrichmentOverrides ?? null;
  const tripEntries = splitEntriesIntoTrips(flattenJourneyEntries(albums));

  return tripEntries
    .map((entries) => {
      const entriesByHref = new Map(
        entries.map((entry) => [entry.href, entry] as const),
      );
      const route = buildMapRoute(entries);
      const startDate = route.fullPoints[0]?.date ?? null;
      const endDate = route.fullPoints.at(-1)?.date ?? null;
      const durationDays = getDurationDays(startDate, endDate);
      const startPlace = route.simplifiedPoints[0]
        ? getStopPlaceLabel(route.simplifiedPoints[0], entriesByHref)
        : null;
      const endPlace = route.simplifiedPoints.at(-1)
        ? getStopPlaceLabel(route.simplifiedPoints.at(-1)!, entriesByHref)
        : null;
      const coverEntry = entries[0] ?? null;
      const primaryAlbumSlug = getPrimaryAlbumSlug(entries);
      const primaryAlbumTitle =
        entries.find((entry) => entry.album === primaryAlbumSlug)?.albumTitle ??
        null;
      const sourceAlbumSlugs = Array.from(
        new Set(entries.map((entry) => entry.album)),
      );
      const journeyId = getTripId(entries);

      const stops = route.simplifiedPoints.map(
        (stopPoint, index): JourneyStop => {
          const coverEntryForStop =
            findEntryForHref(entriesByHref, stopPoint.memberHrefs) ??
            coverEntry;
          const stopTitle =
            getStopPlaceLabel(stopPoint, entriesByHref) ?? `Stop ${index + 1}`;
          const stopAlbumSlug = coverEntryForStop?.album ?? primaryAlbumSlug;
          const stopId = `${journeyId}:${index}`;
          const enrichedStop = enrichmentOverrides?.stops?.[stopId];

          const stop: JourneyStop = {
            id: stopId,
            journeyId,
            sequenceIndex: index,
            albumSlug: stopAlbumSlug,
            title: enrichedStop?.title ?? stopTitle,
            summary: enrichedStop?.summary ?? "",
            tags: enrichedStop?.tags ?? [],
            placeLabel: getStopPlaceLabel(stopPoint, entriesByHref),
            startDate: stopPoint.date,
            endDate: stopPoint.date,
            photoCount: stopPoint.stopPhotoCount,
            decLat: stopPoint.decLat as number,
            decLng: stopPoint.decLng as number,
            coverHref: coverEntryForStop?.href ?? stopPoint.href,
            cover: {
              href: coverEntryForStop?.href ?? stopPoint.href,
              src: coverEntryForStop?.src.src ?? stopPoint.src.src,
              width:
                coverEntryForStop?.placeholderWidth ??
                stopPoint.placeholderWidth ??
                null,
              height:
                coverEntryForStop?.placeholderHeight ??
                stopPoint.placeholderHeight ??
                null,
              placeholderColor:
                coverEntryForStop?.placeholderColor ??
                stopPoint.placeholderColor ??
                null,
            },
            memberHrefs:
              stopPoint.memberHrefs.length > 0
                ? stopPoint.memberHrefs
                : [stopPoint.href],
          };

          return {
            ...stop,
            summary: stop.summary || buildStopSummary(stop),
          };
        },
      );

      const baseJourney: Journey = {
        id: journeyId,
        albumSlug: primaryAlbumSlug,
        albumTitle: primaryAlbumTitle,
        albumCount: sourceAlbumSlugs.length,
        title: buildDefaultJourneyTitle(
          startPlace,
          endPlace,
          getJourneyFallbackLabel(entries, primaryAlbumTitle),
        ),
        summary: "",
        tags: [],
        startDate,
        endDate,
        durationDays,
        distanceKm: Number(
          getJourneyDistanceKm(
            route.fullPoints.map((point) => ({
              decLat: point.decLat as number,
              decLng: point.decLng as number,
            })),
          ).toFixed(1),
        ),
        stopCount: stops.length,
        geotaggedPhotoCount: route.geotaggedCount,
        startPlace,
        endPlace,
        cover: {
          href:
            coverEntry?.href ??
            stops[0]?.coverHref ??
            `/album/${primaryAlbumSlug}`,
          src: coverEntry?.src.src ?? stops[0]?.cover.src ?? "",
          width: coverEntry?.placeholderWidth ?? null,
          height: coverEntry?.placeholderHeight ?? null,
          placeholderColor: coverEntry?.placeholderColor ?? null,
        },
        mapHref:
          sourceAlbumSlugs.length === 1
            ? `/map?filter_album=${primaryAlbumSlug}`
            : "/map",
        timelineHref:
          sourceAlbumSlugs.length === 1
            ? `/timeline?filter_album=${primaryAlbumSlug}`
            : "/timeline",
        albumHref: `/album/${primaryAlbumSlug}`,
        memberHrefs: route.fullPoints.map((point) => point.href),
        stops,
      };

      const enrichedJourney = enrichmentOverrides?.journeys?.[baseJourney.id];
      const journey = {
        ...baseJourney,
        title: enrichedJourney?.title ?? baseJourney.title,
        summary: enrichedJourney?.summary ?? "",
        tags: enrichedJourney?.tags ?? [],
      };

      return {
        ...journey,
        summary: journey.summary || buildJourneySummary(journey),
      };
    })
    .sort((left, right) => {
      const leftDate = left.endDate ? new Date(left.endDate).valueOf() : 0;
      const rightDate = right.endDate ? new Date(right.endDate).valueOf() : 0;
      return rightDate - leftDate;
    });
};

export const getJourneys = async (
  albums: Content[],
  options?: BuildJourneysOptions,
): Promise<Journey[]> => {
  return measureBuild("journeys.getJourneys", async () => {
    return buildJourneys(albums, {
      enrichmentOverrides:
        options?.enrichmentOverrides ?? loadJourneyEnrichmentOverrides(),
    });
  });
};
