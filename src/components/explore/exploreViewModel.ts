import type {
  BucketedStat,
  NumericFacetStat,
  PhotoStats,
  ShootingScopeStats,
  StringFacetStat,
} from "../../util/computeStats";
import { buildSearchHref } from "../../util/searchFacets";

export type FunStatCard = {
  label: string;
  value: string;
  detail: string;
  actionHref?: string | null;
  examples?: Array<{
    year: number;
    src: string;
    label: string;
    href: string;
  }>;
};

export type OverviewCard = {
  label: string;
  value: string;
};

export const COLOR_SWATCHES: Record<string, string> = {
  Neutral: "#8f8a84",
  Red: "#d9534f",
  Orange: "#df8b39",
  Yellow: "#d7b44a",
  Green: "#68a36b",
  Cyan: "#4fa8ae",
  Blue: "#5d84d6",
  Purple: "#8f67c7",
  Pink: "#d86ba7",
};

export const COLOR_SEARCH_PARAMS: Record<string, string> = {
  Neutral: "143,138,132",
  Red: "217,83,79",
  Orange: "223,139,57",
  Yellow: "215,180,74",
  Green: "104,163,107",
  Cyan: "79,168,174",
  Blue: "93,132,214",
  Purple: "143,103,199",
  Pink: "216,107,167",
};

export const COLOR_FAMILY_ORDER = [
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

export const EXPLORE_SECTION_LINKS = [
  { href: "#visual-sameness", label: "Visual sameness" },
  { href: "#embedding-space", label: "The cloud" },
  { href: "#fun-stats", label: "Fun stats" },
  { href: "#recent-trends", label: "Recent trends" },
  { href: "#revisited-places", label: "Revisited places" },
  { href: "#when-you-shoot", label: "When" },
  { href: "#how-you-shoot", label: "How" },
  { href: "#where-you-shoot", label: "Where" },
  { href: "#what-you-shoot-with", label: "What" },
  { href: "#colour", label: "Colour" },
] as const;

export const formatCoverage = (coverage: number): string =>
  `Available for ${Math.round(coverage * 100)}% of archive`;

export const findNumericFacet = (
  stats: Pick<PhotoStats, "numericFacets"> | Pick<ShootingScopeStats, "numericFacets">,
  facetId: string,
): NumericFacetStat | null =>
  stats.numericFacets.find((facet) => facet.facetId === facetId) ?? null;

export const findStringFacet = (stats: PhotoStats, facetId: string): StringFacetStat | null =>
  stats.stringFacets.find((facet) => facet.facetId === facetId) ?? null;

const getTopLabel = (facet: StringFacetStat | null): string => facet?.data[0]?.label ?? "—";

const getPeakBucketLabel = (data: BucketedStat[]): string => {
  const top = data.reduce<BucketedStat | null>((current, bucket) => {
    if (bucket.count <= 0) return current;
    if (!current || bucket.count > current.count) return bucket;
    return current;
  }, null);

  return top?.label ?? "—";
};

const sumBuckets = (data: BucketedStat[], labels: string[]): number =>
  data.reduce((total, bucket) => total + (labels.includes(bucket.label) ? bucket.count : 0), 0);

export const buildYearSearchHref = (year: string): string =>
  buildSearchHref({ facets: [{ facetId: "year", value: year }] });

export const buildColorSearchHref = (colorLabel: string, year?: string): string | null => {
  const color = COLOR_SEARCH_PARAMS[colorLabel];
  if (!color) return null;

  const params = new URLSearchParams();
  params.set("color", color);
  if (year) params.append("facet", `year:${year}`);
  return `/search?${params.toString()}`;
};

export const isAggregateLocationBucket = (label: string): boolean => label.startsWith("Other ");

export const buildExploreOverviewCards = (stats: PhotoStats): OverviewCard[] => [
  { label: "Photos", value: stats.totalPhotos.toLocaleString("en") },
  { label: "Albums", value: stats.totalAlbums.toLocaleString("en") },
  {
    label: "Years",
    value: stats.dateRange ? `${stats.dateRange[0]}–${stats.dateRange[1]}` : "—",
  },
  {
    label: "Top camera",
    value: getTopLabel(findStringFacet(stats, "camera")),
  },
  {
    label: "Top lens",
    value: getTopLabel(findStringFacet(stats, "lens")),
  },
  {
    label: "Top country",
    value: getTopLabel(findStringFacet(stats, "location")),
  },
  {
    label: "Peak hour",
    value: getPeakBucketLabel(findNumericFacet(stats, "hour")?.data ?? []),
  },
];

export const buildExploreFunStats = (stats: PhotoStats): FunStatCard[] => {
  const timeFacet = findNumericFacet(stats, "hour");
  const weekdayTotal = stats.weekdayStats.reduce((sum, bucket) => sum + bucket.count, 0);
  const weekendCount = sumBuckets(stats.weekdayStats, ["Sat", "Sun"]);
  const weekendShare = weekdayTotal > 0 ? weekendCount / weekdayTotal : 0;
  const primeZoomTotal = stats.lensTypeStats.prime + stats.lensTypeStats.zoom;
  const primeShare = primeZoomTotal > 0 ? stats.lensTypeStats.prime / primeZoomTotal : 0;
  const topComfortPath = stats.technicalRelationships?.paths[0] ?? null;
  const earlyBirdCount = sumBuckets(timeFacet?.data ?? [], [
    "05:00",
    "06:00",
    "07:00",
    "08:00",
    "09:00",
  ]);
  const nightOwlCount = sumBuckets(timeFacet?.data ?? [], [
    "18:00",
    "19:00",
    "20:00",
    "21:00",
    "22:00",
    "23:00",
  ]);
  const daypartTotal = earlyBirdCount + nightOwlCount;
  const topColorMood = stats.colorStats.reduce<BucketedStat | null>((current, bucket) => {
    if (bucket.count <= 0) return current;
    if (!current || bucket.count > current.count) return bucket;
    return current;
  }, null);

  return [
    weekdayTotal === 0
      ? {
          label: "Weekend photographer",
          value: "Not enough date data",
          detail: "Needs dated photos to compare weekdays and weekends.",
        }
      : weekendShare >= 0.55
        ? {
            label: "Weekend photographer",
            value: "Weekend leaning",
            detail: `${Math.round(weekendShare * 100)}% of dated photos were shot on Sat–Sun.`,
          }
        : weekendShare <= 0.35
          ? {
              label: "Weekend photographer",
              value: "Weekday leaning",
              detail: `${Math.round((1 - weekendShare) * 100)}% of dated photos were shot Mon–Fri.`,
            }
          : {
              label: "Weekend photographer",
              value: "All-week shooter",
              detail: `${Math.round(weekendShare * 100)}% of dated photos were shot on Sat–Sun.`,
            },
    primeZoomTotal === 0
      ? {
          label: "Prime vs zoom",
          value: "Lens mix unclear",
          detail: "Not enough recognisable lens names yet.",
        }
      : primeShare >= 0.6
        ? {
            label: "Prime vs zoom",
            value: "Prime person",
            detail: `${Math.round(primeShare * 100)}% of recognised lens shots were on primes.`,
          }
        : primeShare <= 0.4
          ? {
              label: "Prime vs zoom",
              value: "Zoom leaning",
              detail: `${Math.round((1 - primeShare) * 100)}% of recognised lens shots were on zooms.`,
            }
          : {
              label: "Prime vs zoom",
              value: "Balanced bag",
              detail: `${stats.lensTypeStats.prime.toLocaleString("en")} prime vs ${stats.lensTypeStats.zoom.toLocaleString("en")} zoom shots.`,
            },
    topComfortPath
      ? {
          label: "Comfort settings",
          value: topComfortPath.values.join(" · "),
          detail: `${topComfortPath.count.toLocaleString("en")} photos use this combo most often.`,
          actionHref: buildSearchHref({
            // invariant: comfort paths are built from exactly three facets
            // (focal length, aperture, ISO), so all three values are present
            facets: [
              { facetId: "focal-length-35mm", value: topComfortPath.values[0]! },
              { facetId: "aperture", value: topComfortPath.values[1]! },
              { facetId: "iso", value: topComfortPath.values[2]! },
            ],
          }),
        }
      : {
          label: "Comfort settings",
          value: "Not enough settings data",
          detail: "Needs focal length, aperture, and ISO together.",
        },
    daypartTotal === 0
      ? {
          label: "Night owl / early bird",
          value: "Not enough time data",
          detail: "Needs reliable local capture times to compare.",
        }
      : nightOwlCount >= earlyBirdCount
        ? {
            label: "Night owl / early bird",
            value: "Night owl",
            detail: `${Math.round((nightOwlCount / daypartTotal) * 100)}% of early/late photos land after 18:00.`,
          }
        : {
            label: "Night owl / early bird",
            value: "Early bird",
            detail: `${Math.round((earlyBirdCount / daypartTotal) * 100)}% of early/late photos land before 10:00.`,
          },
    topColorMood
      ? {
          label: "Colour mood",
          value: topColorMood.label,
          detail: `${topColorMood.count.toLocaleString("en")} photos lean most strongly into this family.`,
          actionHref: COLOR_SEARCH_PARAMS[topColorMood.label]
            ? `/search?color=${COLOR_SEARCH_PARAMS[topColorMood.label]}`
            : null,
        }
      : {
          label: "Colour mood",
          value: "Not enough palette data",
          detail: "Needs extracted colour swatches to show a dominant mood.",
        },
  ];
};
