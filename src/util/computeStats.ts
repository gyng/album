import { Content, PhotoBlock } from "../services/types";
import {
  CAMERA_FACET,
  HOUR_FACET,
  LENS_FACET,
  NUMERIC_FACETS,
  STRING_FACETS,
  PhotoFacet,
} from "./photoBuckets";
import {
  formatPlaceDisplayLabel,
  getGeocodeCity,
  getGeocodeCountry,
  getGeocodeRegion,
  getGeocodeSubregion,
} from "./geocode";
import { parseExifLocalDateTime } from "./exifTime";
import { getDegLatLngFromExif } from "./dms2deg";

export type BucketedStat = {
  label: string;
  count: number;
};

export type BucketedStatGroup = {
  label: string;
  data: BucketedStat[];
};

export type NumericFacetStat = {
  facetId: string;
  displayName: string;
  data: BucketedStat[];
  /** Fraction 0–1: how many photos had this field vs totalPhotos */
  coverage: number;
};

export type StringFacetStat = {
  facetId: string;
  displayName: string;
  /** Top N by count, descending */
  data: BucketedStat[];
  coverage: number;
};

export type PhotoStats = {
  totalPhotos: number;
  totalAlbums: number;
  /** [earliest year, latest year] inclusive. null if no dated photos. */
  dateRange: [number, number] | null;
  numericFacets: NumericFacetStat[];
  stringFacets: StringFacetStat[];
  gearFlow: SankeyFlow;
  locationFlow: SankeyFlow;
  technicalRelationships: ParallelRelationshipData | null;
  technicalRelationshipFilters: TechnicalRelationshipFilters;
  timeRelationships: ParallelRelationshipData | null;
  weekdayStats: BucketedStat[];
  monthStats: BucketedStat[];
  calendarCoverage: number;
  recentMonthStats: BucketedStat[];
  recentYearStats: BucketedStatGroup[];
  mapPoints: Array<{ lat: number; lng: number }>;
  colorStats: BucketedStat[];
  colorCoverage: number;
  paletteSizeStats: BucketedStat[];
  colorFamilyExamples: Array<{
    label: string;
    count: number;
    sharePercent: number;
    photos: Array<{
      src: string;
      href: string;
      label: string;
    }>;
  }>;
  colorYearStats: BucketedStatGroup[];
  colorYearRibbons: Array<{
    label: string;
    total: number;
    dominantFamily: string | null;
    slices: Array<{
      rgb: string;
      family: string;
      count: number;
      position: number;
      dateLabel: string;
      thumbSrc: string;
      photoLabel: string;
    }>;
  }>;
  colorDrift: {
    earlyLabel: string;
    recentLabel: string;
    buckets: Array<{
      label: string;
      earlyCount: number;
      recentCount: number;
      earlySharePercent: number;
      recentSharePercent: number;
    }>;
  } | null;
  lensTypeStats: {
    prime: number;
    zoom: number;
    unknown: number;
  };
  revisitedPlaces: Array<{
    label: string;
    facetId: "location" | "region" | "subregion" | "city";
    facetValue: string;
    firstYear: number;
    lastYear: number;
    spanYears: number;
    photoCount: number;
    timeline: Array<{
      year: number;
      count: number;
      photos: Array<{
        src: string;
        label: string;
      }>;
    }>;
    examples: Array<{
      year: number;
      src: string;
      label: string;
    }>;
  }>;
};

const TOP_N_STRING = 20;
const GEAR_FALLBACK_LENS_LABEL = "Unknown / built-in lens";
const MAX_REVISITED_PLACES = 4;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
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
];
const COLOR_FAMILY_LABELS = [
  "Neutral",
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Cyan",
  "Blue",
  "Purple",
  "Pink",
] as const;
const PALETTE_SIZE_LABELS = ["1", "2", "3", "4", "5+"] as const;

export type SankeyNode = {
  id: string;
  label: string;
  displayLabel?: string;
  count: number;
  depth: number;
  facetId?: string;
  facetValue?: string;
};

export type SankeyLink = {
  source: string;
  target: string;
  count: number;
};

export type SankeyFlow = {
  nodes: SankeyNode[];
  links: SankeyLink[];
};

export type ParallelRelationshipAxis = {
  facetId: string;
  label: string;
  buckets: string[];
};

export type ParallelRelationshipPath = {
  values: string[];
  count: number;
};

export type ParallelRelationshipData = {
  axes: ParallelRelationshipAxis[];
  paths: ParallelRelationshipPath[];
  total: number;
};

export type ShootingScopeStats = {
  numericFacets: NumericFacetStat[];
  technicalRelationships: ParallelRelationshipData | null;
  timeRelationships: ParallelRelationshipData | null;
  weekdayStats: BucketedStat[];
  monthStats: BucketedStat[];
  calendarCoverage: number;
};

export type TechnicalRelationshipFilters = {
  cameras: string[];
  lenses: string[];
  lensesByCamera: Record<string, string[]>;
  byCamera: Record<string, ShootingScopeStats>;
  byLens: Record<string, ShootingScopeStats>;
  byCameraLens: Record<string, Record<string, ShootingScopeStats>>;
};

function computeNumericFacet(
  photos: PhotoBlock[],
  facet: PhotoFacet<number>,
): NumericFacetStat {
  const counts = new Map<string, number>(
    facet.buckets.map((b) => [b.label, 0]),
  );
  let withField = 0;

  for (const photo of photos) {
    const value = facet.extract(photo._build.exif, photo._build.tags ?? undefined);
    if (value === null) continue;
    withField++;
    const bucket = facet.buckets.find((b) => b.match(value));
    if (bucket) {
      counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1);
    }
  }

  return {
    facetId: facet.id,
    displayName: facet.displayName,
    data: facet.buckets.map((b) => ({
      label: b.label,
      count: counts.get(b.label) ?? 0,
    })),
    coverage: photos.length > 0 ? withField / photos.length : 0,
  };
}

function computeStringFacet(
  photos: PhotoBlock[],
  facet: PhotoFacet<string>,
): StringFacetStat {
  const counts = new Map<string, number>();
  let withField = 0;

  for (const photo of photos) {
    const value = facet.extract(photo._build.exif, photo._build.tags ?? undefined);
    if (value === null) continue;
    withField++;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const sorted: BucketedStat[] = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(
      0,
      facet.id === CAMERA_FACET.id || facet.id === LENS_FACET.id
        ? counts.size
        : TOP_N_STRING,
    );

  return {
    facetId: facet.id,
    displayName: facet.displayName,
    data: sorted,
    coverage: photos.length > 0 ? withField / photos.length : 0,
  };
}

function computeGearFlow(photos: PhotoBlock[]): SankeyFlow {
  const cameraCounts = new Map<string, number>();
  const lensCountsByCamera = new Map<string, Map<string, number>>();

  for (const photo of photos) {
    const exif = photo._build.exif;
    const camera = CAMERA_FACET.extract(exif, photo._build.tags ?? undefined);
    const lens =
      LENS_FACET.extract(exif, photo._build.tags ?? undefined) ?? GEAR_FALLBACK_LENS_LABEL;
    if (!camera) {
      continue;
    }

    cameraCounts.set(camera, (cameraCounts.get(camera) ?? 0) + 1);
    const currentLensCounts = lensCountsByCamera.get(camera) ?? new Map<string, number>();
    currentLensCounts.set(lens, (currentLensCounts.get(lens) ?? 0) + 1);
    lensCountsByCamera.set(camera, currentLensCounts);
  }

  const topCameras = Array.from(cameraCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    });

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const lensNodeCounts = new Map<string, number>();

  topCameras.forEach(([camera, count]) => {
    const cameraId = `camera:${camera}`;
    nodes.push({
      id: cameraId,
      label: camera,
      displayLabel: camera,
      count,
      depth: 0,
      facetId: CAMERA_FACET.id,
      facetValue: camera,
    });

    const topLenses = Array.from(lensCountsByCamera.get(camera)?.entries() ?? [])
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      });

    topLenses.forEach(([lens, lensCount]) => {
      const lensId = `lens:${lens}`;
      lensNodeCounts.set(lens, (lensNodeCounts.get(lens) ?? 0) + lensCount);

      links.push({
        source: cameraId,
        target: lensId,
        count: lensCount,
      });
    });
  });

  Array.from(lensNodeCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .forEach(([lens, count]) => {
      nodes.push({
        id: `lens:${lens}`,
        label: lens,
        displayLabel: lens,
        count,
        depth: 1,
        facetId: LENS_FACET.id,
        facetValue: lens,
      });
    });

  return { nodes, links };
}

function sortCounts<T extends string>(
  counts: Map<T, number>,
): Array<[T, number]> {
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
}

function computeLocationFlow(photos: PhotoBlock[]): SankeyFlow {
  type CityPath = {
    country: string;
    region: string;
    subregion: string;
    city: string;
    count: number;
  };

  const cityPathCounts = new Map<string, CityPath>();

  for (const photo of photos) {
    const geocode = photo._build.tags?.geocode;
    const country = getGeocodeCountry(geocode);
    const city = getGeocodeCity(geocode);
    const region = getGeocodeRegion(geocode) ?? country;
    const subregion = getGeocodeSubregion(geocode) ?? region ?? city;

    if (!country || !city || !region || !subregion) {
      continue;
    }

    const key = `${country}\u001f${region}\u001f${subregion}\u001f${city}`;
    const existing = cityPathCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      cityPathCounts.set(key, { country, region, subregion, city, count: 1 });
    }
  }

  const topPaths = Array.from(cityPathCounts.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return `${left.country}\u001f${left.region}\u001f${left.subregion}\u001f${left.city}`.localeCompare(
      `${right.country}\u001f${right.region}\u001f${right.subregion}\u001f${right.city}`,
    );
  });

  const countryCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  const subregionCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();

  topPaths.forEach((path) => {
    const countryKey = path.country;
    const regionKey = `${path.country}\u001f${path.region}`;
    const subregionKey = `${regionKey}\u001f${path.subregion}`;
    const cityKey = `${subregionKey}\u001f${path.city}`;

    countryCounts.set(countryKey, (countryCounts.get(countryKey) ?? 0) + path.count);
    regionCounts.set(regionKey, (regionCounts.get(regionKey) ?? 0) + path.count);
    subregionCounts.set(
      subregionKey,
      (subregionCounts.get(subregionKey) ?? 0) + path.count,
    );
    cityCounts.set(cityKey, (cityCounts.get(cityKey) ?? 0) + path.count);
  });

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const seenNodes = new Set<string>();
  const seenLinks = new Set<string>();

  const pushNode = (node: SankeyNode) => {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  };

  const pushLink = (link: SankeyLink) => {
    const key = `${link.source}->${link.target}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push(link);
  };

  topPaths.forEach((path) => {
    const countryId = `country:${path.country}`;
    const regionKey = `${path.country}\u001f${path.region}`;
    const regionId = `region:${regionKey}`;
    const subregionKey = `${regionKey}\u001f${path.subregion}`;
    const subregionId = `subregion:${subregionKey}`;
    const cityKey = `${subregionKey}\u001f${path.city}`;
    const cityId = `city:${cityKey}`;

    pushNode({
      id: countryId,
      label: path.country,
      displayLabel: formatPlaceDisplayLabel(path.country) ?? path.country,
      count: countryCounts.get(path.country) ?? path.count,
      depth: 0,
      facetId: "location",
      facetValue: path.country,
    });
    pushNode({
      id: regionId,
      label: path.region,
      displayLabel: formatPlaceDisplayLabel(path.region) ?? path.region,
      count: regionCounts.get(regionKey) ?? path.count,
      depth: 1,
      facetId: "region",
      facetValue: path.region,
    });
    pushNode({
      id: subregionId,
      label: path.subregion,
      displayLabel: formatPlaceDisplayLabel(path.subregion) ?? path.subregion,
      count: subregionCounts.get(subregionKey) ?? path.count,
      depth: 2,
      facetId: "subregion",
      facetValue: path.subregion,
    });
    pushNode({
      id: cityId,
      label: path.city,
      displayLabel: formatPlaceDisplayLabel(path.city) ?? path.city,
      count: cityCounts.get(cityKey) ?? path.count,
      depth: 3,
      facetId: "city",
      facetValue: path.city,
    });

    pushLink({
      source: countryId,
      target: regionId,
      count: regionCounts.get(regionKey) ?? path.count,
    });
    pushLink({
      source: regionId,
      target: subregionId,
      count: subregionCounts.get(subregionKey) ?? path.count,
    });
    pushLink({
      source: subregionId,
      target: cityId,
      count: cityCounts.get(cityKey) ?? path.count,
    });
  });

  return { nodes, links };
}

function computeRelationships(
  photos: PhotoBlock[],
  facets: PhotoFacet<number>[],
): ParallelRelationshipData | null {
  if (facets.length !== 3) {
    return null;
  }

  const pathCounts = new Map<string, number>();
  let total = 0;

  for (const photo of photos) {
    const values = facets.map((facet) => {
      const value = facet.extract(photo._build.exif, photo._build.tags ?? undefined);
      if (value === null) {
        return null;
      }

      return facet.buckets.find((bucket) => bucket.match(value))?.label ?? null;
    });

    if (values.some((value) => value === null)) {
      continue;
    }

    const key = values.join("\u001f");
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
    total += 1;
  }

  if (pathCounts.size === 0) {
    return null;
  }

  return {
    axes: facets.map((facet) => ({
      facetId: facet.id,
      label: facet.displayName,
      buckets: facet.buckets.map((bucket) => bucket.label),
    })),
    paths: Array.from(pathCounts.entries())
      .map(([key, count]) => ({
        values: key.split("\u001f"),
        count,
      }))
      .sort((left, right) => right.count - left.count),
    total,
  };
}

function computeTechnicalRelationships(
  photos: PhotoBlock[],
): ParallelRelationshipData | null {
  const facets = [
    NUMERIC_FACETS.find((facet) => facet.id === "focal-length-35mm"),
    NUMERIC_FACETS.find((facet) => facet.id === "aperture"),
    NUMERIC_FACETS.find((facet) => facet.id === "iso"),
  ].filter(Boolean) as PhotoFacet<number>[];

  return computeRelationships(photos, facets);
}

function computeShootingScopeStats(photos: PhotoBlock[]): ShootingScopeStats {
  const scopedNumericFacetIds = new Set([
    "hour",
    "focal-length-35mm",
    "focal-length-actual",
    "aperture",
    "iso",
  ]);
  const numericFacets = NUMERIC_FACETS.filter((facet) =>
    scopedNumericFacetIds.has(facet.id),
  ).map((facet) => computeNumericFacet(photos, facet as PhotoFacet<number>));
  const hourFacet = computeNumericFacet(photos, HOUR_FACET);
  const calendarStats = computeCalendarStats(photos);

  return {
    numericFacets: [hourFacet, ...numericFacets],
    technicalRelationships: computeTechnicalRelationships(photos),
    timeRelationships: computeTimeRelationships(photos),
    weekdayStats: calendarStats.weekdayStats,
    monthStats: calendarStats.monthStats,
    calendarCoverage: calendarStats.coverage,
  };
}

function computeTechnicalRelationshipFilters(
  photos: PhotoBlock[],
): TechnicalRelationshipFilters {
  const photosByCamera = new Map<string, PhotoBlock[]>();
  const photosByLens = new Map<string, PhotoBlock[]>();
  const photosByCameraLens = new Map<string, Map<string, PhotoBlock[]>>();

  for (const photo of photos) {
    const tags = photo._build.tags ?? undefined;
    const camera = CAMERA_FACET.extract(photo._build.exif, tags);
    const lens = LENS_FACET.extract(photo._build.exif, tags);

    if (camera) {
      const cameraPhotos = photosByCamera.get(camera) ?? [];
      cameraPhotos.push(photo);
      photosByCamera.set(camera, cameraPhotos);
    }

    if (lens) {
      const lensPhotos = photosByLens.get(lens) ?? [];
      lensPhotos.push(photo);
      photosByLens.set(lens, lensPhotos);
    }

    if (camera && lens) {
      const cameraLensMap =
        photosByCameraLens.get(camera) ?? new Map<string, PhotoBlock[]>();
      const cameraLensPhotos = cameraLensMap.get(lens) ?? [];
      cameraLensPhotos.push(photo);
      cameraLensMap.set(lens, cameraLensPhotos);
      photosByCameraLens.set(camera, cameraLensMap);
    }
  }

  const cameras = sortCounts(
    new Map(
      Array.from(photosByCamera.entries()).map(([camera, cameraPhotos]) => [
        camera,
        cameraPhotos.length,
      ]),
    ),
  ).map(([camera]) => camera);

  const lenses = sortCounts(
    new Map(
      Array.from(photosByLens.entries()).map(([lens, lensPhotos]) => [
        lens,
        lensPhotos.length,
      ]),
    ),
  ).map(([lens]) => lens);

  const byCamera: Record<string, ShootingScopeStats> = {};
  cameras.forEach((camera) => {
    byCamera[camera] = computeShootingScopeStats(photosByCamera.get(camera) ?? []);
  });

  const byLens: Record<string, ShootingScopeStats> = {};
  lenses.forEach((lens) => {
    byLens[lens] = computeShootingScopeStats(photosByLens.get(lens) ?? []);
  });

  const lensesByCamera: Record<string, string[]> = {};
  const byCameraLens: Record<string, Record<string, ShootingScopeStats>> = {};

  cameras.forEach((camera) => {
    const lensMap = photosByCameraLens.get(camera);
    if (!lensMap) {
      return;
    }

    const sortedLenses = sortCounts(
      new Map(
        Array.from(lensMap.entries()).map(([lens, lensPhotos]) => [
          lens,
          lensPhotos.length,
        ]),
      ),
    ).map(([lens]) => lens);
    lensesByCamera[camera] = sortedLenses;

    sortedLenses.forEach((lens) => {
      byCameraLens[camera] = byCameraLens[camera] ?? {};
      byCameraLens[camera][lens] = computeShootingScopeStats(lensMap.get(lens) ?? []);
    });
  });

  return {
    cameras,
    lenses,
    lensesByCamera,
    byCamera,
    byLens,
    byCameraLens,
  };
}

function computeTimeRelationships(
  photos: PhotoBlock[],
): ParallelRelationshipData | null {
  const facets = [
    HOUR_FACET,
    NUMERIC_FACETS.find((facet) => facet.id === "aperture"),
    NUMERIC_FACETS.find((facet) => facet.id === "iso"),
  ].filter(Boolean) as PhotoFacet<number>[];

  return computeRelationships(photos, facets);
}

function computeCalendarStats(photos: PhotoBlock[]): {
  weekdayStats: BucketedStat[];
  monthStats: BucketedStat[];
  coverage: number;
} {
  const weekdayCounts = new Map<string, number>(
    WEEKDAY_LABELS.map((label) => [label, 0]),
  );
  const monthCounts = new Map<string, number>(
    MONTH_LABELS.map((label) => [label, 0]),
  );
  let withDate = 0;

  for (const photo of photos) {
    const parsed = parseExifLocalDateTime(photo._build?.exif?.DateTimeOriginal);
    if (!parsed) {
      continue;
    }

    withDate += 1;
    const weekday = new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day),
    ).getUTCDay();
    weekdayCounts.set(
      WEEKDAY_LABELS[weekday],
      (weekdayCounts.get(WEEKDAY_LABELS[weekday]) ?? 0) + 1,
    );
    monthCounts.set(
      MONTH_LABELS[parsed.month - 1],
      (monthCounts.get(MONTH_LABELS[parsed.month - 1]) ?? 0) + 1,
    );
  }

  return {
    weekdayStats: WEEKDAY_LABELS.map((label) => ({
      label,
      count: weekdayCounts.get(label) ?? 0,
    })),
    monthStats: MONTH_LABELS.map((label) => ({
      label,
      count: monthCounts.get(label) ?? 0,
    })),
    coverage: photos.length > 0 ? withDate / photos.length : 0,
  };
}

function computeRecentTrendStats(photos: PhotoBlock[]): {
  recentMonthStats: BucketedStat[];
  recentYearStats: BucketedStatGroup[];
} {
  const dated = photos
    .map((photo) => parseExifLocalDateTime(photo._build?.exif?.DateTimeOriginal))
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (dated.length === 0) {
    return {
      recentMonthStats: [],
      recentYearStats: [],
    };
  }

  const latest = dated.reduce((current, value) => {
    const currentKey = current.year * 100 + current.month;
    const nextKey = value.year * 100 + value.month;
    return nextKey > currentKey ? value : current;
  });

  const monthKeys = Array.from({ length: 12 }, (_, index) => {
    const totalMonths = latest.year * 12 + (latest.month - 1) - (11 - index);
    const year = Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    return { year, month };
  });
  const monthCounts = new Map<string, number>(
    monthKeys.map(({ year, month }) => [`${year}-${month}`, 0]),
  );

  const yearKeys = Array.from({ length: 5 }, (_, index) => latest.year - (4 - index));
  const yearMonthCounts = new Map<string, Map<string, number>>(
    yearKeys.map((year) => [
      String(year),
      new Map<string, number>(MONTH_LABELS.map((month) => [month, 0])),
    ]),
  );

  for (const value of dated) {
    const monthKey = `${value.year}-${value.month}`;
    if (monthCounts.has(monthKey)) {
      monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    }

    const yearKey = String(value.year);
    const yearData = yearMonthCounts.get(yearKey);
    if (yearData) {
      const monthLabel = MONTH_LABELS[value.month - 1];
      yearData.set(monthLabel, (yearData.get(monthLabel) ?? 0) + 1);
    }
  }

  return {
    recentMonthStats: monthKeys.map(({ year, month }) => ({
      label: `${MONTH_LABELS[month - 1]} '${String(year).slice(-2)}`,
      count: monthCounts.get(`${year}-${month}`) ?? 0,
    })),
    recentYearStats: yearKeys.map((year) => ({
      label: String(year),
      data: MONTH_LABELS.map((month) => ({
        label: month,
        count: yearMonthCounts.get(String(year))?.get(month) ?? 0,
      })),
    })),
  };
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number,
): { h: number; s: number; l: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
      break;
  }

  return { h: h * 60, s, l };
}

function getColorFamilyLabel(rgb: [number, number, number]): (typeof COLOR_FAMILY_LABELS)[number] {
  const { h, s, l } = rgbToHsl(rgb[0], rgb[1], rgb[2]);

  if (s < 0.16 || l < 0.12 || l > 0.88) {
    return "Neutral";
  }

  if (h < 15 || h >= 345) return "Red";
  if (h < 40) return "Orange";
  if (h < 65) return "Yellow";
  if (h < 165) return "Green";
  if (h < 200) return "Cyan";
  if (h < 255) return "Blue";
  if (h < 310) return "Purple";
  return "Pink";
}

function computeColorStats(photos: PhotoBlock[]): {
  colorStats: BucketedStat[];
  colorCoverage: number;
  paletteSizeStats: BucketedStat[];
  colorFamilyExamples: PhotoStats["colorFamilyExamples"];
  colorYearStats: BucketedStatGroup[];
  colorYearRibbons: PhotoStats["colorYearRibbons"];
  colorDrift: PhotoStats["colorDrift"];
} {
  const colorCounts = new Map<string, number>(
    COLOR_FAMILY_LABELS.map((label) => [label, 0]),
  );
  const paletteCounts = new Map<string, number>(
    PALETTE_SIZE_LABELS.map((label) => [label, 0]),
  );
  let withPalette = 0;

  for (const photo of photos) {
    const palette = photo._build?.tags?.colors;
    if (!palette || palette.length === 0) {
      continue;
    }

    withPalette += 1;
    const dominant = palette[0] as [number, number, number];
    const family = getColorFamilyLabel(dominant);
    colorCounts.set(family, (colorCounts.get(family) ?? 0) + 1);

    const paletteLabel =
      palette.length >= 5 ? "5+" : String(palette.length);
    paletteCounts.set(paletteLabel, (paletteCounts.get(paletteLabel) ?? 0) + 1);
  }

  return {
    colorStats: COLOR_FAMILY_LABELS.map((label) => ({
      label,
      count: colorCounts.get(label) ?? 0,
    })),
    colorCoverage: photos.length > 0 ? withPalette / photos.length : 0,
    paletteSizeStats: PALETTE_SIZE_LABELS.map((label) => ({
      label,
      count: paletteCounts.get(label) ?? 0,
    })),
    colorFamilyExamples: [],
    colorYearStats: [],
    colorYearRibbons: [],
    colorDrift: null,
  };
}

function computeRichColorStats(albums: Content[]): {
  colorStats: BucketedStat[];
  colorCoverage: number;
  paletteSizeStats: BucketedStat[];
  colorFamilyExamples: PhotoStats["colorFamilyExamples"];
  colorYearStats: BucketedStatGroup[];
  colorYearRibbons: PhotoStats["colorYearRibbons"];
  colorDrift: PhotoStats["colorDrift"];
} {
  const photoEntries = albums.flatMap((album) =>
    album.blocks.flatMap((block) => {
      if (block.kind !== "photo") {
        return [];
      }

      const photo = block as PhotoBlock;
      return [{ album, photo }];
    }),
  );
  const photos = photoEntries.map(({ photo }) => photo);
  const base = computeColorStats(photos);
  const exampleBuckets = new Map<
    string,
    Array<{ src: string; href: string; label: string }>
  >(COLOR_FAMILY_LABELS.map((label) => [label, []]));
  const yearCounts = new Map<string, Map<string, number>>();
  const yearPhotoColors = new Map<
    string,
    Array<{
      sortKey: number;
      rgb: [number, number, number];
      family: string;
      position: number;
      dateLabel: string;
      thumbSrc: string;
      photoLabel: string;
    }>
  >();
  const datedColorEntries: Array<{ year: number; family: string }> = [];

  for (const { album, photo } of photoEntries) {
    const palette = photo._build?.tags?.colors;
    if (!palette || palette.length === 0) {
      continue;
    }

    const dominant = palette[0] as [number, number, number];
    const family = getColorFamilyLabel(dominant);
    const examples = exampleBuckets.get(family);
    const src = photo._build?.srcset?.[0]?.src ?? photo.data.src;
    if (examples && src && examples.length < 6) {
      examples.push({
        src,
        href: `/album/${album._build.slug}#${photo.id ?? photo.data.src}`,
        label: photo.data.title ?? photo.data.src.split("/").at(-1) ?? family,
      });
    }

    const parsed = parseExifLocalDateTime(photo._build?.exif?.DateTimeOriginal);
    if (!parsed) {
      continue;
    }

    const yearKey = String(parsed.year);
    const yearBucket =
      yearCounts.get(yearKey) ??
      new Map<string, number>(COLOR_FAMILY_LABELS.map((label) => [label, 0]));
    yearBucket.set(family, (yearBucket.get(family) ?? 0) + 1);
    yearCounts.set(yearKey, yearBucket);
    const sortKey =
      parsed.year * 100000000 +
      parsed.month * 1000000 +
      parsed.day * 10000 +
      parsed.hour * 100 +
      parsed.minute;
    const yearPhotos = yearPhotoColors.get(yearKey) ?? [];
    const yearStart = Date.UTC(parsed.year, 0, 1, 0, 0, 0, 0);
    const nextYearStart = Date.UTC(parsed.year + 1, 0, 1, 0, 0, 0, 0);
    const currentTime = Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      0,
      0,
    );
    const position =
      nextYearStart > yearStart
        ? (currentTime - yearStart) / (nextYearStart - yearStart)
        : 0;
    yearPhotos.push({
      sortKey,
      rgb: dominant,
      family,
      position: Math.max(0, Math.min(1, position)),
      dateLabel: `${MONTH_LABELS[parsed.month - 1]} ${parsed.day}`,
      thumbSrc: src,
      photoLabel: photo.data.title ?? photo.data.src.split("/").at(-1) ?? family,
    });
    yearPhotoColors.set(yearKey, yearPhotos);
    datedColorEntries.push({ year: parsed.year, family });
  }

  const colorFamilyExamples = COLOR_FAMILY_LABELS.map((label) => {
    const count = base.colorStats.find((bucket) => bucket.label === label)?.count ?? 0;
    return {
      label,
      count,
      sharePercent:
        base.colorCoverage > 0 && photos.length > 0
          ? Math.round((count / Math.max(1, Math.round(base.colorCoverage * photos.length))) * 100)
          : 0,
      photos: exampleBuckets.get(label) ?? [],
    };
  }).filter((bucket) => bucket.count > 0 && bucket.photos.length > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const sortedYears = Array.from(yearCounts.keys())
    .map((year) => Number(year))
    .sort((left, right) => right - left)
    .slice(0, 5);

  const colorYearStats = sortedYears.map((year) => ({
    label: String(year),
    data: COLOR_FAMILY_LABELS.map((label) => ({
      label,
      count: yearCounts.get(String(year))?.get(label) ?? 0,
    })),
  }));
  const colorYearRibbons = sortedYears.map((year) => {
    const yearKey = String(year);
    const entries = (yearPhotoColors.get(yearKey) ?? [])
      .slice()
      .sort((left, right) => left.sortKey - right.sortKey);
    const total = entries.length;
    const slices = entries.map((entry) => ({
      rgb: `rgb(${entry.rgb[0]}, ${entry.rgb[1]}, ${entry.rgb[2]})`,
      family: entry.family,
      count: 1,
      position: entry.position,
      dateLabel: entry.dateLabel,
      thumbSrc: entry.thumbSrc,
      photoLabel: entry.photoLabel,
    }));

    const dominantFamily =
      colorYearStats
        .find((group) => group.label === yearKey)
        ?.data.slice()
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))[0]
        ?.label ?? null;

    return {
      label: yearKey,
      total,
      dominantFamily,
      slices,
    };
  });

  let colorDrift: PhotoStats["colorDrift"] = null;
  if (datedColorEntries.length > 0) {
    const years = Array.from(new Set(datedColorEntries.map((entry) => entry.year))).sort(
      (left, right) => left - right,
    );
    const windowSize =
      years.length <= 2 ? 1 : Math.min(3, Math.max(1, Math.floor(years.length / 2)));
    const earlyYears = years.slice(0, windowSize);
    const recentYears = years.slice(-windowSize);
    const earlyCounts = new Map<string, number>(COLOR_FAMILY_LABELS.map((label) => [label, 0]));
    const recentCounts = new Map<string, number>(COLOR_FAMILY_LABELS.map((label) => [label, 0]));

    datedColorEntries.forEach((entry) => {
      if (earlyYears.includes(entry.year)) {
        earlyCounts.set(entry.family, (earlyCounts.get(entry.family) ?? 0) + 1);
      }
      if (recentYears.includes(entry.year)) {
        recentCounts.set(entry.family, (recentCounts.get(entry.family) ?? 0) + 1);
      }
    });

    const earlyTotal = Array.from(earlyCounts.values()).reduce((sum, value) => sum + value, 0);
    const recentTotal = Array.from(recentCounts.values()).reduce((sum, value) => sum + value, 0);
    colorDrift = {
      earlyLabel:
        earlyYears.length === 1
          ? String(earlyYears[0])
          : `${earlyYears[0]}–${earlyYears[earlyYears.length - 1]}`,
      recentLabel:
        recentYears.length === 1
          ? String(recentYears[0])
          : `${recentYears[0]}–${recentYears[recentYears.length - 1]}`,
      buckets: COLOR_FAMILY_LABELS.map((label) => ({
        label,
        earlyCount: earlyCounts.get(label) ?? 0,
        recentCount: recentCounts.get(label) ?? 0,
        earlySharePercent:
          earlyTotal > 0 ? Math.round(((earlyCounts.get(label) ?? 0) / earlyTotal) * 100) : 0,
        recentSharePercent:
          recentTotal > 0 ? Math.round(((recentCounts.get(label) ?? 0) / recentTotal) * 100) : 0,
      }))
        .filter((bucket) => bucket.earlyCount > 0 || bucket.recentCount > 0)
        .sort(
          (left, right) =>
            right.recentSharePercent +
            right.earlySharePercent -
            (left.recentSharePercent + left.earlySharePercent) ||
            left.label.localeCompare(right.label),
        ),
    };
  }

  return {
    ...base,
    colorFamilyExamples,
    colorYearStats,
    colorYearRibbons,
    colorDrift,
  };
}

function classifyLensType(lensLabel: string): "prime" | "zoom" | "unknown" {
  const lens = lensLabel.toLowerCase();

  if (/zoom/.test(lens) || /\d{1,3}(?:\.\d+)?-\d{1,3}(?:\.\d+)?mm/.test(lens)) {
    return "zoom";
  }

  if (/\d{1,3}(?:\.\d+)?mm/.test(lens)) {
    return "prime";
  }

  return "unknown";
}

function computeLensTypeStats(photos: PhotoBlock[]): PhotoStats["lensTypeStats"] {
  const counts: PhotoStats["lensTypeStats"] = {
    prime: 0,
    zoom: 0,
    unknown: 0,
  };

  for (const photo of photos) {
    const lens = LENS_FACET.extract(photo._build.exif, photo._build.tags ?? undefined);
    if (!lens) {
      counts.unknown += 1;
      continue;
    }

    counts[classifyLensType(lens)] += 1;
  }

  return counts;
}

function computeRevisitedPlace(
  photos: PhotoBlock[],
): PhotoStats["revisitedPlaces"] {
  const placeYears = new Map<
    string,
    {
      label: string;
      facetId: "location" | "region" | "subregion" | "city";
      facetValue: string;
      years: Set<number>;
      photoCount: number;
      photos: Array<{
        year: number;
        src: string;
        label: string;
      }>;
    }
  >();

  for (const photo of photos) {
    const parsed = parseExifLocalDateTime(photo._build?.exif?.DateTimeOriginal);
    if (!parsed) {
      continue;
    }

    const geocode = photo._build.tags?.geocode;
    const placeCandidates = [
      { facetId: "city" as const, value: getGeocodeCity(geocode) },
      { facetId: "subregion" as const, value: getGeocodeSubregion(geocode) },
      { facetId: "region" as const, value: getGeocodeRegion(geocode) },
      { facetId: "location" as const, value: getGeocodeCountry(geocode) },
    ];
    const place = placeCandidates.find((candidate) => candidate.value);
    if (!place?.value) {
      continue;
    }

    const key = `${place.facetId}:${place.value}`;
    const thumbSrc = photo._build.srcset?.[0]?.src ?? photo.data.src;
    const existing = placeYears.get(key) ?? {
      label: formatPlaceDisplayLabel(place.value) ?? place.value,
      facetId: place.facetId,
      facetValue: place.value,
      years: new Set<number>(),
      photoCount: 0,
      photos: [],
    };
    existing.years.add(parsed.year);
    existing.photoCount += 1;
    if (thumbSrc) {
      existing.photos.push({
        year: parsed.year,
        src: thumbSrc,
        label: photo.data.title ?? place.value,
      });
    }
    placeYears.set(key, existing);
  }

  return Array.from(placeYears.values())
    .map((place) => {
      const years = Array.from(place.years).sort((left, right) => left - right);
      return {
        ...place,
        firstYear: years[0],
        lastYear: years[years.length - 1],
        spanYears: years.length > 1 ? years[years.length - 1] - years[0] : 0,
      };
    })
    .filter((place) => place.years.size > 1 && place.spanYears > 0)
    .sort((left, right) => {
      if (right.spanYears !== left.spanYears) {
        return right.spanYears - left.spanYears;
      }
      if (right.photoCount !== left.photoCount) {
        return right.photoCount - left.photoCount;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, MAX_REVISITED_PLACES)
    .map((place) => ({
      label: place.label,
      facetId: place.facetId,
      facetValue: place.facetValue,
      firstYear: place.firstYear,
      lastYear: place.lastYear,
      spanYears: place.spanYears,
      photoCount: place.photoCount,
      timeline: Array.from(
        place.photos.reduce((groups, photo) => {
          const current = groups.get(photo.year) ?? [];
          current.push(photo);
          groups.set(photo.year, current);
          return groups;
        }, new Map<number, typeof place.photos>()).entries(),
      )
        .sort((left, right) => left[0] - right[0])
        .map(([year, photos]) => ({
          year,
          count: photos.length,
          photos: photos.slice(0, 3).map((photo) => ({
            src: photo.src,
            label: photo.label,
          })),
        })),
      examples: place.photos
        .sort((left, right) => left.year - right.year)
        .filter((photo, index, all) =>
          index === all.findIndex((candidate) => candidate.year === photo.year),
        )
        .slice(0, 3),
    }));
}

export function computePhotoStats(albums: Content[]): PhotoStats {
  const photos = albums.flatMap((album) =>
    album.blocks.filter((b): b is PhotoBlock => b.kind === "photo"),
  );

  let minYear = Infinity;
  let maxYear = -Infinity;

  for (const photo of photos) {
    const raw = photo._build?.exif?.DateTimeOriginal;
    if (!raw) continue;
    const year = parseInt(raw.slice(0, 4), 10);
    if (Number.isFinite(year) && year >= 1900 && year <= 2100) {
      if (year < minYear) minYear = year;
      if (year > maxYear) maxYear = year;
    }
  }

  const dateRange: [number, number] | null =
    minYear !== Infinity ? [minYear, maxYear] : null;
  const calendarStats = computeCalendarStats(photos);
  const recentTrendStats = computeRecentTrendStats(photos);
  const colorStats = computeRichColorStats(albums);
  const lensTypeStats = computeLensTypeStats(photos);
  const technicalRelationshipFilters = computeTechnicalRelationshipFilters(photos);
  const revisitedPlaces = computeRevisitedPlace(photos);
  const mapPoints = photos.flatMap((photo) => {
    const exif = photo._build?.exif ?? {};
    const { decLat, decLng } = getDegLatLngFromExif(exif);
    return typeof decLat === "number" && typeof decLng === "number"
      ? [{ lat: decLat, lng: decLng }]
      : [];
  });

  return {
    totalPhotos: photos.length,
    totalAlbums: albums.length,
    dateRange,
    numericFacets: NUMERIC_FACETS.map((f) =>
      computeNumericFacet(photos, f as PhotoFacet<number>),
    ),
    stringFacets: STRING_FACETS.map((f) =>
      computeStringFacet(photos, f as PhotoFacet<string>),
    ),
    gearFlow: computeGearFlow(photos),
    locationFlow: computeLocationFlow(photos),
    technicalRelationships: computeTechnicalRelationships(photos),
    technicalRelationshipFilters,
    timeRelationships: computeTimeRelationships(photos),
    weekdayStats: calendarStats.weekdayStats,
    monthStats: calendarStats.monthStats,
    calendarCoverage: calendarStats.coverage,
    recentMonthStats: recentTrendStats.recentMonthStats,
    recentYearStats: recentTrendStats.recentYearStats,
    mapPoints,
    colorStats: colorStats.colorStats,
    colorCoverage: colorStats.colorCoverage,
    paletteSizeStats: colorStats.paletteSizeStats,
    colorFamilyExamples: colorStats.colorFamilyExamples,
    colorYearStats: colorStats.colorYearStats,
    colorYearRibbons: colorStats.colorYearRibbons,
    colorDrift: colorStats.colorDrift,
    lensTypeStats,
    revisitedPlaces,
  };
}
