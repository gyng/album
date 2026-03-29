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
  timeRelationships: ParallelRelationshipData | null;
  weekdayStats: BucketedStat[];
  monthStats: BucketedStat[];
  calendarCoverage: number;
  recentMonthStats: BucketedStat[];
  recentYearStats: BucketedStat[];
  mapPoints: Array<{ lat: number; lng: number }>;
  colorStats: BucketedStat[];
  colorCoverage: number;
  paletteSizeStats: BucketedStat[];
  lensTypeStats: {
    prime: number;
    zoom: number;
    unknown: number;
  };
};

const TOP_N_STRING = 20;
const TOP_N_CAMERAS = 8;
const TOP_N_LENSES_PER_CAMERA = 6;
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
    .slice(0, TOP_N_STRING);

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
    const lens = LENS_FACET.extract(exif, photo._build.tags ?? undefined);
    if (!camera || !lens) {
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
    })
    .slice(0, TOP_N_CAMERAS);

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
      })
      .slice(0, TOP_N_LENSES_PER_CAMERA);

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
  recentYearStats: BucketedStat[];
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
  const yearCounts = new Map<string, number>(
    yearKeys.map((year) => [String(year), 0]),
  );

  for (const value of dated) {
    const monthKey = `${value.year}-${value.month}`;
    if (monthCounts.has(monthKey)) {
      monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    }

    const yearKey = String(value.year);
    if (yearCounts.has(yearKey)) {
      yearCounts.set(yearKey, (yearCounts.get(yearKey) ?? 0) + 1);
    }
  }

  return {
    recentMonthStats: monthKeys.map(({ year, month }) => ({
      label: `${MONTH_LABELS[month - 1]} '${String(year).slice(-2)}`,
      count: monthCounts.get(`${year}-${month}`) ?? 0,
    })),
    recentYearStats: yearKeys.map((year) => ({
      label: String(year),
      count: yearCounts.get(String(year)) ?? 0,
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
  const colorStats = computeColorStats(photos);
  const lensTypeStats = computeLensTypeStats(photos);
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
    lensTypeStats,
  };
}
