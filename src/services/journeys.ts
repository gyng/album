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
  width?: number;
  height?: number;
  placeholderColor?: string;
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
  albumTitle: string;
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
};

type CoordinateEntry = {
  decLat: number;
  decLng: number;
};

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

const getPlaceLabel = (geocode: string | null): string | null => {
  if (!geocode) {
    return null;
  }

  const parts = geocode
    .split(",")
    .map((part) => part.trim())
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
  album: Content,
  startPlace: string | null,
  endPlace: string | null,
): string => {
  if (album.title && album.title.trim()) {
    return album.title.trim();
  }

  if (startPlace && endPlace && startPlace !== endPlace) {
    return `${startPlace} to ${endPlace}`;
  }

  return album._build.slug;
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

export const buildJourneys = (
  albums: Content[],
  options?: BuildJourneysOptions,
): Journey[] => {
  const enrichmentOverrides = options?.enrichmentOverrides ?? null;

  return albums
    .map((album) => {
      const entries = buildJourneyEntries(album);
      if (entries.length < 2) {
        return null;
      }

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

      const stops = route.simplifiedPoints.map(
        (stopPoint, index): JourneyStop => {
          const coverEntryForStop =
            findEntryForHref(entriesByHref, stopPoint.memberHrefs) ??
            coverEntry;
          const stopTitle =
            getStopPlaceLabel(stopPoint, entriesByHref) ?? `Stop ${index + 1}`;
          const stopId = `${album._build.slug}:${index}`;
          const enrichedStop = enrichmentOverrides?.stops?.[stopId];

          const stop: JourneyStop = {
            id: stopId,
            journeyId: album._build.slug,
            sequenceIndex: index,
            albumSlug: album._build.slug,
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
                stopPoint.placeholderWidth,
              height:
                coverEntryForStop?.placeholderHeight ??
                stopPoint.placeholderHeight,
              placeholderColor:
                coverEntryForStop?.placeholderColor ??
                stopPoint.placeholderColor,
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
        id: album._build.slug,
        albumSlug: album._build.slug,
        albumTitle: album.title,
        title: buildDefaultJourneyTitle(album, startPlace, endPlace),
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
            `/album/${album._build.slug}`,
          src: coverEntry?.src.src ?? stops[0]?.cover.src ?? "",
          width: coverEntry?.placeholderWidth,
          height: coverEntry?.placeholderHeight,
          placeholderColor: coverEntry?.placeholderColor,
        },
        mapHref: `/map?filter_album=${album._build.slug}`,
        timelineHref: `/timeline?filter_album=${album._build.slug}`,
        albumHref: `/album/${album._build.slug}`,
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
    .filter((journey): journey is Journey => journey !== null)
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
