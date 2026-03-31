import { useMemo, useState } from "react";
import Link from "next/link";
import type { GetStaticProps, NextPage } from "next";
import { GlobalNav } from "../../components/GlobalNav";
import { MiniHistogram } from "../../components/MiniHistogram";
import { SankeyChart } from "../../components/SankeyChart";
import { Seo } from "../../components/Seo";
import { StatBar } from "../../components/StatBar";
import { StatsWorldMap } from "../../components/StatsWorldMap";
import { TechnicalHeatmaps } from "../../components/TechnicalHeatmaps";
import { TimeRelationshipExplorer } from "../../components/TimeRelationshipExplorer";
import { YearSplitHistogram } from "../../components/YearSplitHistogram";
import { getAlbums } from "../../services/album";
import {
  computeVisualSamenessStats,
  VisualSamenessStats,
} from "../../util/computeEmbeddingStats";
import {
  computePhotoStats,
  BucketedStat,
  NumericFacetStat,
  PhotoStats,
  ShootingScopeStats,
  StringFacetStat,
} from "../../util/computeStats";
import { measureBuild } from "../../services/buildTiming";
import { Thumb, Footer, SegmentedToggle, Card, Heading, Pill, PillButton, pillStyles, Select } from "../../components/ui";
import styles from "./explore.module.css";
import {
  buildSearchHref,
  buildSearchFacetHref,
  buildSimilaritySearchHref,
  isSearchableFacetId,
} from "../../util/searchFacets";

type PageProps = {
  stats: PhotoStats;
  visualSameness: VisualSamenessStats | null;
};

const formatCoverage = (coverage: number): string =>
  `Available for ${Math.round(coverage * 100)}% of archive`;

const findNumericFacet = (
  stats: Pick<PhotoStats, "numericFacets"> | Pick<ShootingScopeStats, "numericFacets">,
  facetId: string,
): NumericFacetStat | null =>
  stats.numericFacets.find((facet) => facet.facetId === facetId) ?? null;

const findStringFacet = (
  stats: PhotoStats,
  facetId: string,
): StringFacetStat | null =>
  stats.stringFacets.find((facet) => facet.facetId === facetId) ?? null;

const getTopLabel = (
  facet: StringFacetStat | null,
): string =>
  facet?.data[0]?.label ?? "—";

const getOverviewValue = (value: number | string | null): string =>
  typeof value === "number" ? value.toLocaleString("en") : value ?? "—";

const getPeakBucketLabel = (data: BucketedStat[]): string => {
  const top = data.reduce<BucketedStat | null>((current, bucket) => {
    if (bucket.count <= 0) {
      return current;
    }

    if (!current || bucket.count > current.count) {
      return bucket;
    }

    return current;
  }, null);

  return top?.label ?? "—";
};

const sumBuckets = (data: BucketedStat[], labels: string[]): number =>
  data.reduce(
    (total, bucket) => total + (labels.includes(bucket.label) ? bucket.count : 0),
    0,
  );

type FunStatCard = {
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

type OverviewCard = {
  label: string;
  value: string;
};

const buildYearSearchHref = (year: string): string =>
  buildSearchHref({
    facets: [{ facetId: "year", value: year }],
  });

const buildColorSearchHref = (colorLabel: string, year?: string): string | null => {
  const color = COLOR_SEARCH_PARAMS[colorLabel];
  if (!color) {
    return null;
  }

  const params = new URLSearchParams();
  params.set("color", color);
  if (year) {
    params.append("facet", `year:${year}`);
  }
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
};

const isAggregateLocationBucket = (label: string): boolean =>
  label.startsWith("Other ");

const COLOR_SWATCHES: Record<string, string> = {
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

const COLOR_SEARCH_PARAMS: Record<string, string> = {
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

const COLOR_FAMILY_ORDER = [
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

const INITIAL_AVERAGE_EXAMPLES = 4;
const INITIAL_REPEATED_EXAMPLES = 2;
const INITIAL_DISTINCT_EXAMPLES = 4;
const INITIAL_RECURRING_LOOKS = 4;
const INITIAL_LOOK_TIMELINE = 4;
const LOAD_MORE_AVERAGE_EXAMPLES = 4;
const LOAD_MORE_REPEATED_EXAMPLES = 2;
const LOAD_MORE_DISTINCT_EXAMPLES = 4;
const LOAD_MORE_RECURRING_LOOKS = 2;
const LOAD_MORE_LOOK_TIMELINE = 4;

const StatSection: React.FC<{
  facetId: string;
  title: string;
  coverage: number;
  children: React.ReactNode;
}> = ({ facetId, title, coverage, children }) => (
  <section
    className={[
      styles.section,
      facetId === "hour" ? styles.sectionWide : "",
    ].join(" ")}
  >
    <div className={styles.sectionHeader}>
      <Heading level={2} as="h2">{title}</Heading>
      <span className={styles.coverage}>{formatCoverage(coverage)}</span>
    </div>
    {coverage === 0 ? (
      <p className={styles.noData}>No data available.</p>
    ) : (
      <div className={styles.bars}>{children}</div>
    )}
  </section>
);

const StatGroup: React.FC<{
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, description, actions, children }) => (
  <section id={id} className={styles.group}>
    <div className={styles.groupHeader}>
      <div className={styles.groupTitleRow}>
        <Heading level={1}>
          {id ? (
            <a href={`#${id}`} className={styles.groupAnchorLink}>
              <span>{title}</span>
              <span className={styles.groupAnchorMark} aria-hidden="true">
                #
              </span>
            </a>
          ) : (
            title
          )}
        </Heading>
        {actions ? <div className={styles.groupActions}>{actions}</div> : null}
      </div>
      {description ? <p className={styles.groupDescription}>{description}</p> : null}
    </div>
    <div className={styles.groupGrid}>{children}</div>
  </section>
);

const VisualSimilarityThumb: React.FC<{
  photo: {
    path: string;
    src: string;
    href: string;
    label: string;
  };
  className?: string;
  imageClassName?: string;
}> = ({ photo, className, imageClassName }) => (
  <div className={`${styles.visualThumbWrap} ${className ?? ""}`.trim()}>
    <Link href={photo.href} className={styles.visualThumbLink}>
      <Thumb
        src={photo.src}
        alt={photo.label}
        className={`${styles.visualThumb} ${imageClassName ?? ""}`.trim()}
      />
    </Link>
    <Link
      href={buildSimilaritySearchHref(photo.path)}
      className={styles.visualThumbSearchLink}
      aria-label={`Find photos visually similar to ${photo.label}`}
      title="Open similarity search"
    >
      <span aria-hidden="true">🔍</span>
      <span>Similar</span>
      <span aria-hidden="true">↗</span>
    </Link>
  </div>
);

const StatsPage: NextPage<PageProps> = ({ stats, visualSameness }) => {
  const [locationView, setLocationView] = useState<"map" | "sankey" | "bars">("map");
  const [gearView, setGearView] = useState<"sankey" | "bars">("sankey");
  const [selectedTechnicalCamera, setSelectedTechnicalCamera] = useState("all");
  const [selectedTechnicalLens, setSelectedTechnicalLens] = useState("all");
  const [visibleAverageExamples, setVisibleAverageExamples] = useState(
    INITIAL_AVERAGE_EXAMPLES,
  );
  const [visibleRepeatedExamples, setVisibleRepeatedExamples] = useState(
    INITIAL_REPEATED_EXAMPLES,
  );
  const [visibleDistinctExamples, setVisibleDistinctExamples] = useState(
    INITIAL_DISTINCT_EXAMPLES,
  );
  const [visibleRecurringLooks, setVisibleRecurringLooks] = useState(
    INITIAL_RECURRING_LOOKS,
  );
  const [visibleLookTimeline, setVisibleLookTimeline] = useState(
    INITIAL_LOOK_TIMELINE,
  );
  const timeFacet = findNumericFacet(stats, "hour");
  const technicalFacets = [
    findNumericFacet(stats, "focal-length-35mm"),
    findNumericFacet(stats, "focal-length-actual"),
    findNumericFacet(stats, "aperture"),
    findNumericFacet(stats, "iso"),
  ].filter(Boolean) as NumericFacetStat[];
  const availableTechnicalLenses = useMemo(() => {
    if (selectedTechnicalCamera !== "all") {
      return stats.technicalRelationshipFilters.lensesByCamera[selectedTechnicalCamera] ?? [];
    }

    return stats.technicalRelationshipFilters.lenses;
  }, [
    selectedTechnicalCamera,
    stats.technicalRelationshipFilters.lenses,
    stats.technicalRelationshipFilters.lensesByCamera,
  ]);
  const activeTechnicalLens =
    selectedTechnicalLens !== "all" &&
    !availableTechnicalLenses.includes(selectedTechnicalLens)
      ? "all"
      : selectedTechnicalLens;
  const scopeStats = useMemo((): ShootingScopeStats | null => {
    if (selectedTechnicalCamera !== "all" && activeTechnicalLens !== "all") {
      return (
        stats.technicalRelationshipFilters.byCameraLens[selectedTechnicalCamera]?.[
          activeTechnicalLens
        ] ?? null
      );
    }

    if (selectedTechnicalCamera !== "all") {
      return stats.technicalRelationshipFilters.byCamera[selectedTechnicalCamera] ?? null;
    }

    if (activeTechnicalLens !== "all") {
      return stats.technicalRelationshipFilters.byLens[activeTechnicalLens] ?? null;
    }

    return null;
  }, [
    activeTechnicalLens,
    selectedTechnicalCamera,
    stats.technicalRelationshipFilters.byCamera,
    stats.technicalRelationshipFilters.byCameraLens,
    stats.technicalRelationshipFilters.byLens,
  ]);
  const activeTimeFacet = scopeStats
    ? findNumericFacet(scopeStats, "hour")
    : timeFacet;
  const activeTechnicalFacets = scopeStats
    ? [
        findNumericFacet(scopeStats, "focal-length-35mm"),
        findNumericFacet(scopeStats, "focal-length-actual"),
        findNumericFacet(scopeStats, "aperture"),
        findNumericFacet(scopeStats, "iso"),
      ].filter(Boolean) as NumericFacetStat[]
    : technicalFacets;
  const activeWeekdayStats = scopeStats?.weekdayStats ?? stats.weekdayStats;
  const activeMonthStats = scopeStats?.monthStats ?? stats.monthStats;
  const activeCalendarCoverage = scopeStats?.calendarCoverage ?? stats.calendarCoverage;
  const activeTimeRelationships = scopeStats?.timeRelationships ?? stats.timeRelationships;
  const filteredTechnicalRelationships =
    scopeStats?.technicalRelationships ?? stats.technicalRelationships;
  const renderScopeFilterControls = () => (
    <div className={styles.sectionFilters}>
      <label className={styles.sectionFilter}>
        <Select
          variant="compact"
          value={selectedTechnicalCamera}
          onChange={(event) => {
            setSelectedTechnicalCamera(event.target.value);
          }}
        >
          <option value="all">All cameras</option>
          {stats.technicalRelationshipFilters.cameras.map((camera) => (
            <option key={camera} value={camera}>
              {camera}
            </option>
          ))}
        </Select>
      </label>
      <label className={styles.sectionFilter}>
        <Select
          variant="compact"
          value={activeTechnicalLens}
          onChange={(event) => {
            setSelectedTechnicalLens(event.target.value);
          }}
        >
          <option value="all">All lenses</option>
          {availableTechnicalLenses.map((lens) => (
            <option key={lens} value={lens}>
              {lens}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
  const placeFacets = [
    findStringFacet(stats, "location"),
    findStringFacet(stats, "region"),
    findStringFacet(stats, "subregion"),
    findStringFacet(stats, "city"),
  ].filter(Boolean) as StringFacetStat[];
  const placeBarFacets = placeFacets
    .map((facet, depth) => {
      const data = stats.locationFlow.nodes
        .filter((node) => node.depth === depth)
        .map((node) => ({
          key: node.id,
          label: node.displayLabel ?? node.label,
          value: node.facetValue ?? node.label,
          count: node.count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      return data.length > 0
        ? {
            ...facet,
            data,
          }
        : facet;
    });
  const gearFacets = [
    findStringFacet(stats, "camera"),
    findStringFacet(stats, "lens"),
  ].filter(Boolean) as StringFacetStat[];

  const topCamera = getTopLabel(findStringFacet(stats, "camera"));
  const topLens = getTopLabel(findStringFacet(stats, "lens"));
  const topCountry = getTopLabel(findStringFacet(stats, "location"));
  const topHour = getPeakBucketLabel(findNumericFacet(stats, "hour")?.data ?? []);
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
    if (bucket.count <= 0) {
      return current;
    }

    if (!current || bucket.count > current.count) {
      return bucket;
    }

    return current;
  }, null);
  const repeatedExamples = visualSameness?.repeatedExamples.slice(
    0,
    visibleRepeatedExamples,
  ) ?? [];
  const averageExamples = visualSameness?.averageExamples.slice(
    0,
    visibleAverageExamples,
  ) ?? [];
  const distinctExamples = visualSameness?.distinctExamples.slice(
    0,
    visibleDistinctExamples,
  ) ?? [];
  const recurringLooks = visualSameness?.visualEras.slice(
    0,
    visibleRecurringLooks,
  ) ?? [];
  const lookTimeline = visualSameness?.lookTimeline.toReversed().slice(
    0,
    visibleLookTimeline,
  ) ?? [];
  const overviewCards: OverviewCard[] = [
    {
      label: "Photos",
      value: getOverviewValue(stats.totalPhotos),
    },
    {
      label: "Albums",
      value: getOverviewValue(stats.totalAlbums),
    },
    {
      label: "Years",
      value: stats.dateRange
        ? `${stats.dateRange[0]}–${stats.dateRange[1]}`
        : "—",
    },
    {
      label: "Top camera",
      value: topCamera,
    },
    {
      label: "Top lens",
      value: topLens,
    },
    {
      label: "Top country",
      value: topCountry,
    },
    {
      label: "Peak hour",
      value: topHour,
    },
  ];
  const funStats: FunStatCard[] = [
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
          detail: "Not enough recognizable lens names yet.",
        }
      : primeShare >= 0.6
        ? {
            label: "Prime vs zoom",
            value: "Prime person",
            detail: `${Math.round(primeShare * 100)}% of recognized lens shots were on primes.`,
          }
        : primeShare <= 0.4
          ? {
              label: "Prime vs zoom",
              value: "Zoom leaning",
              detail: `${Math.round((1 - primeShare) * 100)}% of recognized lens shots were on zooms.`,
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
            facets: [
              { facetId: "focal-length-35mm", value: topComfortPath.values[0] },
              { facetId: "aperture", value: topComfortPath.values[1] },
              { facetId: "iso", value: topComfortPath.values[2] },
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
          detail: "Needs extracted color swatches to show a dominant mood.",
        },
  ];
  const sectionLinks = [
    { href: "#visual-sameness", label: "Visual sameness" },
    { href: "#fun-stats", label: "Fun stats" },
    { href: "#recent-trends", label: "Recent trends" },
    { href: "#revisited-places", label: "Revisited places" },
    { href: "#when-you-shoot", label: "When" },
    { href: "#how-you-shoot", label: "How" },
    { href: "#where-you-shoot", label: "Where" },
    { href: "#what-you-shoot-with", label: "What" },
    { href: "#colour", label: "Colour" },
  ];
  const renderNumericFacet = (facet: NumericFacetStat) => {
    const max = Math.max(...facet.data.map((b) => b.count), 1);
    const hasData = facet.data.some((b) => b.count > 0);
    if (!hasData && facet.coverage === 0) {
      return null;
    }

    return (
      <StatSection
        key={facet.facetId}
        facetId={facet.facetId}
        title={facet.displayName}
        coverage={facet.coverage}
      >
        {facet.data.map((bucket) => (
          <StatBar
            key={bucket.label}
            label={bucket.label}
            count={bucket.count}
            maxCount={max}
            actionHref={
              isSearchableFacetId(facet.facetId) &&
              !isAggregateLocationBucket(bucket.label)
                ? buildSearchFacetHref({
                    facetId: facet.facetId,
                    value: bucket.label,
                  })
                : null
            }
            actionLabel={`Find photos with ${facet.displayName.toLowerCase()} ${bucket.label}`}
          />
        ))}
      </StatSection>
    );
  };

  const renderStringFacet = (facet: StringFacetStat) => {
    if (facet.data.length === 0) {
      return null;
    }

    const max = Math.max(...facet.data.map((b) => b.count), 1);

    return (
      <StatSection
        key={facet.facetId}
        facetId={facet.facetId}
        title={facet.displayName}
        coverage={facet.coverage}
      >
        {facet.data.map((bucket) => {
          const keyedBucket = bucket as typeof bucket & {
            key?: string;
            value?: string;
          };

          return (
            <StatBar
              key={keyedBucket.key ?? bucket.label}
              label={bucket.label}
              count={bucket.count}
              maxCount={max}
              actionHref={
                isSearchableFacetId(facet.facetId)
                  ? buildSearchFacetHref({
                      facetId: facet.facetId,
                      value: keyedBucket.value ?? bucket.label,
                    })
                  : null
              }
              actionLabel={`Find photos with ${facet.displayName.toLowerCase()} ${bucket.label}`}
            />
          );
        })}
      </StatSection>
    );
  };

  return (
    <div className={styles.page}>
      <Seo
        title="Explore | Snapshots"
        description="Explore the archive through time, place, gear, colour, and visual similarity."
        pathname="/explore"
        jsonLd={[]}
      />

      <main className={styles.main}>
        <GlobalNav currentPage="explore" hasPadding={false} />

        <nav className={styles.jumpNav} aria-label="Jump to section">
          <span className={styles.jumpNavLabel}>Jump to</span>
          <div className={styles.jumpNavLinks}>
            {sectionLinks.map((link) => (
              <Pill key={link.href} href={link.href} className={styles.jumpNavLink}>
                {link.label}
              </Pill>
            ))}
          </div>
        </nav>

        <header className={styles.header}>
          <div className={styles.headerBody}>
            <h1 className={styles.title}>Explore</h1>
          </div>
        </header>

        <section className={styles.overview}>
          {overviewCards.map((card) => (
            <Card key={card.label} className={styles.overviewCard}>
              <div className={styles.overviewLabel}>{card.label}</div>
              <div className={styles.overviewValue}>{card.value}</div>
            </Card>
          ))}
        </section>

        <div className={styles.groups}>
          {visualSameness ? (
            <StatGroup
              id="visual-sameness"
              title="Visual sameness"
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.visualSummaryGrid}>
                  <Card as="article" className={styles.overviewCard}>
                    <div className={styles.funStatLabel}>Sameness</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.samenessPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Average nearest-neighbor similarity across {visualSameness.sampleSize.toLocaleString("en")} embedded photos in the archive.
                    </div>
                  </Card>
                  <Card as="article" className={styles.overviewCard}>
                    <div className={styles.funStatLabel}>Repeated motifs</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.repeatedMotifPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos with a very close visual neighbor at or above {Math.round(visualSameness.highSimilarityThreshold * 100)}% similarity.
                    </div>
                  </Card>
                  <Card as="article" className={styles.overviewCard}>
                    <div className={styles.funStatLabel}>Distinct frames</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.distinctPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos whose nearest visual neighbor stays below {Math.round(visualSameness.lowSimilarityThreshold * 100)}% similarity.
                    </div>
                  </Card>
                  {visualSameness.lookDrift ? (
                    <Card as="article" className={styles.overviewCard}>
                      <div className={styles.funStatLabel}>Changed look over time</div>
                      <div className={styles.visualSummaryValue}>
                        {visualSameness.lookDrift.similarityPercent}%
                      </div>
                      <div className={styles.funStatDetail}>
                        The archive’s early and recent look stays {visualSameness.lookDrift.similarityPercent}% aligned from {visualSameness.lookDrift.firstYear} to {visualSameness.lookDrift.lastYear}.
                      </div>
                    </Card>
                  ) : null}
                  {visualSameness.visualEras.length > 0 ? (
                    <Card as="article" className={styles.overviewCard}>
                      <div className={styles.funStatLabel}>Recurring looks</div>
                      <div className={styles.visualSummaryValue}>
                        {visualSameness.visualEras.length}
                      </div>
                      <div className={styles.funStatDetail}>
                        The biggest era covers {visualSameness.visualEras[0]?.sharePercent ?? 0}% of embedded photos.
                      </div>
                    </Card>
                  ) : null}
                </div>
                {(visualSameness.averageExamples.length > 0 ||
                  visualSameness.repeatedExamples.length > 0 ||
                  visualSameness.distinctExamples.length > 0 ||
                  visualSameness.visualEras.length > 0 ||
                  visualSameness.lookTimeline.length > 0) ? (
                  <div className={styles.visualExamplesGrid}>
                    {visualSameness.averageExamples.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualAverageSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <Heading level={2}>Most average photos</Heading>
                          <span className={styles.coverage}>
                            Closest to the archive center
                          </span>
                        </div>
                        <div className={styles.visualSingles}>
                          {averageExamples.map((example) => (
                            <div
                              key={example.photo.path}
                              className={styles.visualSingleCard}
                            >
                              <VisualSimilarityThumb photo={example.photo} />
                              <div className={styles.visualExampleMeta}>
                                <span>
                                  {example.centroidSimilarityPercent}% to archive center
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.averageExamples.length > averageExamples.length ? (
                          <PillButton
                            className={styles.loadMoreButton}
                            onClick={() => {
                              setVisibleAverageExamples((count) =>
                                Math.min(
                                  count + LOAD_MORE_AVERAGE_EXAMPLES,
                                  visualSameness.averageExamples.length,
                                ),
                              );
                            }}
                          >
                            <span>Load more average photos</span>
                          </PillButton>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.distinctExamples.length > 0 ? (
                      <section className={styles.visualExampleSection}>
                        <div className={styles.sectionHeader}>
                          <Heading level={2}>Distinct frames</Heading>
                          <span className={styles.coverage}>
                            Weakest nearest-neighbor matches
                          </span>
                        </div>
                        <div className={styles.visualSingles}>
                          {distinctExamples.map((example) => (
                            <div key={example.photo.path} className={styles.visualSingleCard}>
                              <VisualSimilarityThumb photo={example.photo} />
                              <div className={styles.visualExampleMeta}>
                                <span>{example.nearestSimilarityPercent}% nearest match</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.distinctExamples.length > distinctExamples.length ? (
                          <PillButton
                            className={styles.loadMoreButton}
                            onClick={() => {
                              setVisibleDistinctExamples((count) =>
                                Math.min(
                                  count + LOAD_MORE_DISTINCT_EXAMPLES,
                                  visualSameness.distinctExamples.length,
                                ),
                              );
                            }}
                          >
                            <span>Load more distinct frames</span>
                          </PillButton>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.repeatedExamples.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <Heading level={2}>Repeated motifs</Heading>
                          <span className={styles.coverage}>
                            Closest recurring visual matches
                          </span>
                        </div>
                        <div className={styles.visualPairs}>
                          {repeatedExamples.map((example) => (
                            <div
                              key={`${example.left.path}-${example.right.path}`}
                              className={styles.visualPairCard}
                            >
                              <div className={styles.visualPairImages}>
                                <VisualSimilarityThumb photo={example.left} />
                                <VisualSimilarityThumb photo={example.right} />
                              </div>
                              <div className={styles.visualExampleMeta}>
                                <span>{example.similarityPercent}% match</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.repeatedExamples.length > repeatedExamples.length ? (
                          <PillButton
                            className={styles.loadMoreButton}
                            onClick={() => {
                              setVisibleRepeatedExamples((count) =>
                                Math.min(
                                  count + LOAD_MORE_REPEATED_EXAMPLES,
                                  visualSameness.repeatedExamples.length,
                                ),
                              );
                            }}
                          >
                            <span>Load more repeated motifs</span>
                          </PillButton>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.visualEras.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <Heading level={2}>Recurring looks</Heading>
                          <span className={styles.coverage}>
                            Recurring visual modes in the archive
                          </span>
                        </div>
                        <div className={styles.visualEraGrid}>
                          {recurringLooks.map((era) => (
                            <div key={era.label} className={styles.visualEraCard}>
                              <div className={styles.visualEraThumbs}>
                                {era.photos.map((photo) => (
                                  <VisualSimilarityThumb
                                    key={photo.path}
                                    photo={photo}
                                    className={styles.visualEraThumbWrap}
                                    imageClassName={styles.visualEraThumb}
                                  />
                                ))}
                              </div>
                              <div className={styles.visualExampleMeta}>
                                <span>{era.label}</span>
                                <br />
                                <span>
                                  {era.sharePercent}% of archive · {era.count.toLocaleString("en")} photos
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.visualEras.length > recurringLooks.length ? (
                          <PillButton
                            className={styles.loadMoreButton}
                            onClick={() => {
                              setVisibleRecurringLooks((count) =>
                                Math.min(
                                  count + LOAD_MORE_RECURRING_LOOKS,
                                  visualSameness.visualEras.length,
                                ),
                              );
                            }}
                          >
                            <span>Load more recurring looks</span>
                          </PillButton>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.lookTimeline.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection} ${styles.timelineSectionAligned}`}
                      >
                        <div className={styles.sectionHeader}>
                          <Heading level={2}>Changed look over time</Heading>
                          <span className={styles.coverage}>
                            Yearly representative sets
                          </span>
                        </div>
                        <div className={styles.visualTimeline}>
                          {lookTimeline.map((entry, index) => (
                            <div
                              key={entry.year}
                              className={`${styles.visualTimelineRow} ${
                                index === lookTimeline.length - 1
                                  ? visualSameness.lookTimeline.length > lookTimeline.length
                                    ? styles.visualTimelineRowContinues
                                    : styles.visualTimelineRowLast
                                  : ""
                              }`}
                            >
                              <div className={styles.visualTimelineMeta}>
                                <span className={styles.visualTimelineYear}>{entry.year}</span>
                                <span>{entry.count.toLocaleString("en")} photos</span>
                              </div>
                              <div className={styles.visualTimelineRail} aria-hidden="true">
                                <span className={styles.visualTimelineDot} />
                              </div>
                              <div className={styles.visualTimelineThumbs}>
                                {entry.photos.map((photo) => (
                                  <VisualSimilarityThumb
                                    key={photo.path}
                                    photo={photo}
                                    className={styles.visualTimelineThumbWrap}
                                    imageClassName={`${styles.visualEraThumb} ${styles.visualTimelineThumb}`}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.lookTimeline.length > lookTimeline.length ? (
                          <PillButton
                            className={styles.loadMoreButton}
                            onClick={() => {
                              setVisibleLookTimeline((count) =>
                                Math.min(
                                  count + LOAD_MORE_LOOK_TIMELINE,
                                  visualSameness.lookTimeline.length,
                                ),
                              );
                            }}
                          >
                            <span>Load more years</span>
                          </PillButton>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </StatGroup>
          ) : null}

          <StatGroup
            id="fun-stats"
            title="Fun stats"
          >
            <section className={`${styles.section} ${styles.sectionWide}`}>
              <div className={styles.funStatsGrid}>
                {funStats.map((stat) => (
                  <Card as="article" key={stat.label}>
                    <div className={styles.funStatLabel}>{stat.label}</div>
                    <div className={styles.funStatValue}>{stat.value}</div>
                    <div className={styles.funStatDetail}>{stat.detail}</div>
                    {stat.examples && stat.examples.length > 0 ? (
                      <div className={styles.funStatThumbs}>
                        {stat.examples.map((example) => (
                          <Link
                            key={`${stat.label}-${example.year}-${example.src}`}
                            href={example.href}
                            className={styles.funStatThumbLink}
                          >
                            <img
                              src={example.src}
                              alt={`${example.label} (${example.year})`}
                              className={styles.funStatThumb}
                            />
                            <span className={styles.funStatThumbYear}>{example.year}</span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {stat.actionHref ? (
                      <Link href={stat.actionHref} className={styles.funStatLink}>
                        <span>Open in Search</span>
                        <span aria-hidden="true">↗</span>
                      </Link>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          </StatGroup>

          {stats.recentYearStats.length > 0 ? (
            <StatGroup
              id="recent-trends"
              title="Recent trends"
              actions={
                <Link href="/timeline" className={`${pillStyles.base} ${pillStyles.ghost}`}>
                  <span>Open Timeline</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              }
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.recentTrendsGrid}>
                  <YearSplitHistogram
                    title="Last 5 years"
                    data={stats.recentYearStats}
                    getHref={buildYearSearchHref}
                  />
                </div>
              </section>
            </StatGroup>
          ) : null}

          {stats.revisitedPlaces.length > 0 ? (
            <StatGroup
              id="revisited-places"
              title="Revisited places"
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.revisitedPlacesGrid}>
                  {stats.revisitedPlaces.map((place) => (
                    <section
                      key={`${place.facetId}:${place.facetValue}`}
                      className={`${styles.revisitedPlaceCard} ${styles.timelineSectionAligned}`}
                    >
                      <div className={styles.sectionHeader}>
                        <Heading level={2}>{place.label}</Heading>
                        <span className={styles.coverage}>
                          Seen from {place.firstYear} to {place.lastYear}
                          {` `}across {place.photoCount.toLocaleString("en")} photos
                        </span>
                        <Link
                          href={buildSearchHref({
                            facets: [
                              {
                                facetId: place.facetId,
                                value: place.facetValue,
                              },
                            ],
                          })}
                          className={`${pillStyles.base} ${pillStyles.ghost}`}
                        >
                          <span>Open in Search</span>
                          <span aria-hidden="true">↗</span>
                        </Link>
                      </div>
                      <div className={styles.visualTimeline}>
                        {place.timeline.toReversed().map((entry, index, entries) => {
                          const nextEntry = entries[index + 1];
                          return (
                            <div
                              key={entry.year}
                              className={`${styles.visualTimelineRow} ${!nextEntry ? styles.visualTimelineRowLast : ""}`}
                            >
                              <div className={styles.visualTimelineMeta}>
                                <span className={styles.visualTimelineYear}>{entry.year}</span>
                                <span>{entry.count.toLocaleString("en")} photos</span>
                              </div>
                              <div className={`${styles.visualTimelineRail} ${styles.revisitTimelineRail}`} aria-hidden="true">
                                <span className={styles.visualTimelineDot} />
                                {nextEntry ? (
                                  <span className={styles.revisitGapLabelInline}>
                                    {entry.year - nextEntry.year}{" "}
                                    {entry.year - nextEntry.year === 1 ? "year" : "years"}
                                  </span>
                                ) : null}
                              </div>
                              <div className={styles.revisitThumbs}>
                                {entry.photos.map((photo, photoIndex) => (
                                  <Link
                                    key={`${entry.year}-${photo.src}-${photoIndex}`}
                                    href={buildSearchHref({
                                      facets: [
                                        {
                                          facetId: place.facetId,
                                          value: place.facetValue,
                                        },
                                        { facetId: "year", value: String(entry.year) },
                                      ],
                                    })}
                                    className={`${styles.visualThumbLink} ${styles.visualEraThumbLink}`}
                                  >
                                    <Thumb
                                      src={photo.src}
                                      alt={`${photo.label} (${entry.year})`}
                                      className={`${styles.visualThumb} ${styles.visualEraThumb} ${styles.revisitThumb}`}
                                    />
                                  </Link>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </StatGroup>
          ) : null}

          <StatGroup
            id="when-you-shoot"
            title="When You Shoot"
            actions={renderScopeFilterControls()}
          >
            {activeTimeFacet && activeTimeRelationships ? (
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <TimeRelationshipExplorer
                  hourFacet={activeTimeFacet}
                  relationships={activeTimeRelationships}
                  formatCoverage={formatCoverage}
                />
              </section>
            ) : null}
            {activeCalendarCoverage > 0 ? (
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.sectionHeader}>
                  <Heading level={2} as="h2">Archive cadence</Heading>
                  <span className={styles.coverage}>
                    {formatCoverage(activeCalendarCoverage)}
                  </span>
                  <Link href="/timeline" className={`${pillStyles.base} ${pillStyles.ghost}`}>
                    <span>Open Timeline</span>
                    <span aria-hidden="true">↗</span>
                  </Link>
                </div>
                <div className={styles.cadenceGrid}>
                  <MiniHistogram
                    title="Day of week"
                    data={activeWeekdayStats}
                  />
                  <MiniHistogram
                    title="Month"
                    data={activeMonthStats}
                  />
                </div>
              </section>
            ) : null}
          </StatGroup>

          <StatGroup
            id="how-you-shoot"
            title="How You Shoot"
            actions={renderScopeFilterControls()}
          >
            {activeTechnicalFacets.map(renderNumericFacet)}
            {stats.technicalRelationships ? (
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.sectionHeader}>
                  <Heading level={2} as="h2">Settings relationships</Heading>
                  <span className={styles.coverage}>
                    {filteredTechnicalRelationships
                      ? `Based on ${filteredTechnicalRelationships.total.toLocaleString("en")} photos with focal length, aperture, and ISO`
                      : "No matching photos with focal length, aperture, and ISO for this combination"}
                  </span>
                </div>
                {filteredTechnicalRelationships ? (
                  <TechnicalHeatmaps
                    data={filteredTechnicalRelationships}
                    layout="tri-grid"
                  />
                ) : (
                  <p className={styles.noData}>No data available.</p>
                )}
              </section>
            ) : null}
          </StatGroup>

          <StatGroup
            id="where-you-shoot"
            title="Where You Shoot"
            actions={
              <div className={styles.groupActionsStack}>
                <Link href="/map" className={`${pillStyles.base} ${pillStyles.ghost}`}>
                  <span>Open Map</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <SegmentedToggle
                  options={[
                    { value: "map" as const, label: "Map" },
                    { value: "sankey" as const, label: "Sankey" },
                    { value: "bars" as const, label: "Bars" },
                  ]}
                  value={locationView}
                  onChange={setLocationView}
                  ariaLabel="Location chart view"
                />
              </div>
            }
          >
            <div
              className={[
                styles.fullWidthView,
                locationView === "map" ? "" : styles.hidden,
              ].join(" ")}
            >
              <StatsWorldMap points={stats.mapPoints} />
            </div>
            {locationView === "sankey" && (
              <div className={styles.desktopOnly}>
                <SankeyChart
                  flow={stats.locationFlow}
                  emptyMessage="Not enough linked location data yet."
                  labelMaxLength={16}
                  minHeight={1400}
                />
              </div>
            )}
            <div
              className={[
                styles.desktopBarView,
                locationView === "bars" ? "" : styles.hidden,
              ].join(" ")}
            >
              <div className={styles.stackedBarGroups}>
                {placeBarFacets.map(renderStringFacet)}
              </div>
            </div>
            <div className={styles.mobileOnly}>
              <div className={styles.stackedBarGroups}>
                {placeBarFacets.map(renderStringFacet)}
              </div>
            </div>
          </StatGroup>

          <StatGroup
            id="what-you-shoot-with"
            title="What You Shoot With"
            actions={
              <SegmentedToggle
                options={[
                  { value: "sankey" as const, label: "Sankey" },
                  { value: "bars" as const, label: "Bars" },
                ]}
                value={gearView}
                onChange={setGearView}
                ariaLabel="Gear chart view"
              />
            }
          >
            {gearView === "sankey" && (
              <div className={styles.desktopOnly}>
                <SankeyChart flow={stats.gearFlow} />
              </div>
            )}
            <div
              className={[
                styles.desktopBarView,
                gearView === "bars" ? "" : styles.hidden,
              ].join(" ")}
            >
              <div className={styles.stackedBarGroups}>
                {gearFacets.map(renderStringFacet)}
              </div>
            </div>
            <div className={styles.mobileOnly}>
              <div className={styles.stackedBarGroups}>
                {gearFacets.map(renderStringFacet)}
              </div>
            </div>
          </StatGroup>

          <StatGroup
            id="colour"
            title="Colour"
          >
            <section className={`${styles.section} ${styles.sectionWide}`}>
              <div className={styles.colourSectionGrid}>
                <section className={styles.colourPanel}>
                  <div className={styles.sectionHeader}>
                    <Heading level={2} as="h2">Dominant colour families</Heading>
                    <span className={styles.coverage}>
                      {formatCoverage(stats.colorCoverage)}
                    </span>
                  </div>
                  <div className={styles.bars}>
                    {stats.colorStats.map((bucket) => (
                      <StatBar
                        key={bucket.label}
                        label={bucket.label}
                        count={bucket.count}
                        maxCount={Math.max(...stats.colorStats.map((item) => item.count), 1)}
                        barColor={COLOR_SWATCHES[bucket.label] ?? undefined}
                        actionHref={buildColorSearchHref(bucket.label)}
                        actionLabel={`Find photos with similar ${bucket.label.toLowerCase()} tones`}
                        labelPrefix={
                          <span
                            className={styles.colorSwatch}
                            style={{ backgroundColor: COLOR_SWATCHES[bucket.label] ?? "#999" }}
                            aria-hidden="true"
                          />
                        }
                      />
                    ))}
                  </div>
                </section>

                {stats.colorFamilyExamples.length > 0 ? (
                  <section className={`${styles.colourPanel} ${styles.colourFamilyPanel}`}>
                    <div className={styles.sectionHeader}>
                      <Heading level={2} as="h2">Representative colour looks</Heading>
                    </div>
                    <div className={styles.colorFamilyRows}>
                      {stats.colorFamilyExamples.map((family) => (
                        <div key={family.label} className={styles.colorFamilyRow}>
                          <div className={styles.colorFamilyMeta}>
                            <div className={styles.colorFamilyHeading}>
                              <span
                                className={styles.colorSwatch}
                                style={{ backgroundColor: COLOR_SWATCHES[family.label] ?? "#999" }}
                                aria-hidden="true"
                              />
                              <span>{family.label}</span>
                            </div>
                            <div className={styles.colorFamilyStat}>
                              {family.sharePercent}% of colour-tagged photos
                            </div>
                            {buildColorSearchHref(family.label) ? (
                              <Link
                                href={buildColorSearchHref(family.label) ?? "/search"}
                                className={`${pillStyles.base} ${pillStyles.ghost}`}
                              >
                                <span>Search</span>
                                <span aria-hidden="true">↗</span>
                              </Link>
                            ) : null}
                          </div>
                          <div className={styles.colorFamilyThumbs}>
                            {family.photos.slice(0, 4).map((photo) => (
                              <Link
                                key={`${family.label}-${photo.href}-${photo.src}`}
                                href={photo.href}
                                className={styles.colorFamilyThumbLink}
                              >
                                <Thumb
                                  src={photo.src}
                                  alt={photo.label}
                                  size="small"
                                />
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {stats.colorYearRibbons.length > 0 ? (
                  <section className={`${styles.colourPanel} ${styles.colourFullRowPanel}`}>
                    <div className={styles.sectionHeader}>
                      <Heading level={2} as="h2">Colour over time</Heading>
                    </div>
                    <div className={styles.colorTimeLegend}>
                      {COLOR_FAMILY_ORDER.map((label) => (
                        <div key={`legend-${label}`} className={styles.colorTimeLegendItem}>
                          <span
                            className={styles.colorSwatch}
                            style={{ backgroundColor: COLOR_SWATCHES[label] ?? "#999" }}
                            aria-hidden="true"
                          />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.colorTimeSeries}>
                      {stats.colorYearRibbons.map((year) => {
                        return (
                          <div key={year.label} className={styles.colorTimeRow}>
                            <div className={styles.colorTimeMeta}>
                              <span className={styles.colorTimeYear}>{year.label}</span>
                              <span className={styles.colorTimeDetail}>{year.total.toLocaleString("en")}</span>
                            </div>
                            <div className={styles.colorTimeBar}>
                              {year.slices.map((slice, index) => {
                                const share = year.total > 0 ? (slice.count / year.total) * 100 : 0;
                                return (
                                  <Link
                                    key={`${year.label}-${slice.family}-${index}`}
                                    href={buildColorSearchHref(slice.family, year.label) ?? "/search"}
                                    className={styles.colorTimeSegment}
                                    title={`${slice.family} around ${year.label}: ${slice.count} photos (${Math.round(share)}%)`}
                                    style={{
                                      left: `${slice.position * 100}%`,
                                      width: `max(3px, ${100 / Math.max(year.total, 1)}%)`,
                                      backgroundColor: slice.rgb,
                                    }}
                                  >
                                    <span className={styles.colorTimeTooltip} aria-hidden="true">
                                      <img
                                        src={slice.thumbSrc}
                                        alt={slice.photoLabel}
                                        className={styles.colorTimeTooltipImage}
                                      />
                                      <span className={styles.colorTimeTooltipBody}>
                                        <span
                                          className={styles.colorTimeTooltipSwatch}
                                          style={{ backgroundColor: slice.rgb }}
                                        />
                                        <span className={styles.colorTimeTooltipText}>
                                          <span>{slice.family}</span>
                                          <span>{slice.dateLabel}</span>
                                        </span>
                                      </span>
                                    </span>
                                  </Link>
                                );
                              })}
                            </div>
                            <div className={styles.colorTimeSummary}>
                              {year.dominantFamily ? (
                                <>
                                  <span
                                    className={styles.colorSwatch}
                                    style={{ backgroundColor: COLOR_SWATCHES[year.dominantFamily] ?? "#999" }}
                                    aria-hidden="true"
                                  />
                                  <span>{year.dominantFamily}</span>
                                </>
                              ) : (
                                <span>—</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          </StatGroup>

        </div>
      </main>
      <Footer />
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./explore.getStaticProps", async () => {
    const albums = await getAlbums();
    const stats = computePhotoStats(albums);
    const visualSameness = await computeVisualSamenessStats(albums);
    return { props: { stats, visualSameness } };
  });
};

export default StatsPage;
