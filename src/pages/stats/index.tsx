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
import styles from "./stats.module.css";
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
  typeof value === "number" ? value.toLocaleString() : value ?? "—";

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
};

type OverviewCard = {
  label: string;
  value: string;
};

const buildYearSearchHref = (year: string): string =>
  buildSearchHref({
    facets: [{ facetId: "year", value: year }],
  });

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

const INITIAL_AVERAGE_EXAMPLES = 4;
const INITIAL_REPEATED_EXAMPLES = 2;
const INITIAL_DISTINCT_EXAMPLES = 4;
const INITIAL_RECURRING_LOOKS = 4;
const LOAD_MORE_AVERAGE_EXAMPLES = 4;
const LOAD_MORE_REPEATED_EXAMPLES = 2;
const LOAD_MORE_DISTINCT_EXAMPLES = 4;
const LOAD_MORE_RECURRING_LOOKS = 2;

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
      <h2 className={styles.sectionTitle}>{title}</h2>
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
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, description, actions, children }) => (
  <section id={id} className={styles.group}>
    <div className={styles.groupHeader}>
      <div className={styles.groupTitleRow}>
        <h2 className={styles.groupTitle}>
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
        </h2>
        {actions ? <div className={styles.groupActions}>{actions}</div> : null}
      </div>
      <p className={styles.groupDescription}>{description}</p>
    </div>
    <div className={styles.groupGrid}>{children}</div>
  </section>
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
        <span className={styles.sectionFilterLabel}>Camera</span>
        <select
          className={styles.sectionSelect}
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
        </select>
      </label>
      <label className={styles.sectionFilter}>
        <span className={styles.sectionFilterLabel}>Lens</span>
        <select
          className={styles.sectionSelect}
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
        </select>
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
              detail: `${stats.lensTypeStats.prime.toLocaleString()} prime vs ${stats.lensTypeStats.zoom.toLocaleString()} zoom shots.`,
            },
    topComfortPath
      ? {
          label: "Comfort settings",
          value: topComfortPath.values.join(" · "),
          detail: `${topComfortPath.count.toLocaleString()} photos use this combo most often.`,
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
          label: "Color mood",
          value: topColorMood.label,
          detail: `${topColorMood.count.toLocaleString()} photos lean most strongly into this family.`,
          actionHref: COLOR_SEARCH_PARAMS[topColorMood.label]
            ? `/search?color=${COLOR_SEARCH_PARAMS[topColorMood.label]}`
            : null,
        }
      : {
          label: "Color mood",
          value: "Not enough palette data",
          detail: "Needs extracted color swatches to show a dominant mood.",
        },
    stats.revisitedPlace
      ? {
          label: "Revisited after years",
          value: stats.revisitedPlace.label,
          detail: `Seen from ${stats.revisitedPlace.firstYear} to ${stats.revisitedPlace.lastYear} across ${stats.revisitedPlace.photoCount.toLocaleString()} photos.`,
          actionHref: buildSearchFacetHref({
            facetId: stats.revisitedPlace.facetId,
            value: stats.revisitedPlace.facetValue,
          }),
        }
      : {
          label: "Revisited after years",
          value: "No long-return place yet",
          detail: "Needs dated photos from the same place across multiple years.",
        },
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
        pathname="/stats"
        jsonLd={[]}
      />

      <main className={styles.main}>
        <GlobalNav currentPage="stats" hasPadding={false} />

        <header className={styles.header}>
          <div className={styles.headerBody}>
            <h1 className={styles.title}>Explore</h1>
            {stats.dateRange ? (
              <p className={styles.kicker}>
                A read on how this archive has evolved across time, place, gear, and visual rhythm.
                {` `}
                {stats.totalPhotos.toLocaleString()} photos across {stats.totalAlbums} albums,{" "}
                {stats.dateRange[0]}–{stats.dateRange[1]}.
              </p>
            ) : (
              <p className={styles.kicker}>
                A read on how this archive has evolved across time, place, gear, and visual rhythm.
              </p>
            )}
          </div>
        </header>

        <section className={styles.overview}>
          {overviewCards.map((card) => (
            <div key={card.label} className={styles.overviewCard}>
              <div className={styles.overviewLabel}>{card.label}</div>
              <div className={styles.overviewValue}>{card.value}</div>
            </div>
          ))}
        </section>

        <div className={styles.groups}>
          {visualSameness ? (
            <StatGroup
              id="visual-sameness"
              title="Visual sameness"
              description="A lightweight embeddings-based read on how visually repetitive the archive feels."
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.visualSummaryGrid}>
                  <article className={styles.visualSummaryCard}>
                    <div className={styles.funStatLabel}>Sameness</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.samenessPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Average nearest-neighbor similarity across {visualSameness.sampleSize.toLocaleString()} embedded photos in the archive.
                    </div>
                  </article>
                  <article className={styles.visualSummaryCard}>
                    <div className={styles.funStatLabel}>Repeated motifs</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.repeatedMotifPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos with a very close visual neighbor at or above {Math.round(visualSameness.highSimilarityThreshold * 100)}% similarity.
                    </div>
                  </article>
                  <article className={styles.visualSummaryCard}>
                    <div className={styles.funStatLabel}>Distinct frames</div>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.distinctPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos whose nearest visual neighbor stays below {Math.round(visualSameness.lowSimilarityThreshold * 100)}% similarity.
                    </div>
                  </article>
                  {visualSameness.lookDrift ? (
                    <article className={styles.visualSummaryCard}>
                      <div className={styles.funStatLabel}>Changed look over time</div>
                      <div className={styles.visualSummaryValue}>
                        {visualSameness.lookDrift.similarityPercent}%
                      </div>
                      <div className={styles.funStatDetail}>
                        The archive’s early and recent look stays {visualSameness.lookDrift.similarityPercent}% aligned from {visualSameness.lookDrift.firstYear} to {visualSameness.lookDrift.lastYear}.
                      </div>
                    </article>
                  ) : null}
                  {visualSameness.visualEras.length > 0 ? (
                    <article className={styles.visualSummaryCard}>
                      <div className={styles.funStatLabel}>Recurring looks</div>
                      <div className={styles.visualSummaryValue}>
                        {visualSameness.visualEras.length}
                      </div>
                      <div className={styles.funStatDetail}>
                        The biggest era covers {visualSameness.visualEras[0]?.sharePercent ?? 0}% of embedded photos.
                      </div>
                    </article>
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
                          <h3 className={styles.sectionTitle}>Most average photos</h3>
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
                              <Link
                                href={buildSimilaritySearchHref(example.photo.path)}
                                className={styles.visualThumbLink}
                              >
                                <img
                                  src={example.photo.src}
                                  alt={example.photo.label}
                                  className={styles.visualThumb}
                                />
                              </Link>
                              <div className={styles.visualExampleMeta}>
                                <span>
                                  {example.centroidSimilarityPercent}% to archive center
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.averageExamples.length > averageExamples.length ? (
                          <button
                            type="button"
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
                          </button>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.distinctExamples.length > 0 ? (
                      <section className={styles.visualExampleSection}>
                        <div className={styles.sectionHeader}>
                          <h3 className={styles.sectionTitle}>Distinct frames</h3>
                          <span className={styles.coverage}>
                            Weakest nearest-neighbor matches
                          </span>
                        </div>
                        <div className={styles.visualSingles}>
                          {distinctExamples.map((example) => (
                            <div key={example.photo.path} className={styles.visualSingleCard}>
                              <Link
                                href={buildSimilaritySearchHref(example.photo.path)}
                                className={styles.visualThumbLink}
                              >
                                <img
                                  src={example.photo.src}
                                  alt={example.photo.label}
                                  className={styles.visualThumb}
                                />
                              </Link>
                              <div className={styles.visualExampleMeta}>
                                <span>{example.nearestSimilarityPercent}% nearest match</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.distinctExamples.length > distinctExamples.length ? (
                          <button
                            type="button"
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
                          </button>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.repeatedExamples.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <h3 className={styles.sectionTitle}>Repeated motifs</h3>
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
                                <Link
                                  href={buildSimilaritySearchHref(example.left.path)}
                                  className={styles.visualThumbLink}
                                >
                                  <img
                                    src={example.left.src}
                                    alt={example.left.label}
                                    className={styles.visualThumb}
                                  />
                                </Link>
                                <Link
                                  href={buildSimilaritySearchHref(example.right.path)}
                                  className={styles.visualThumbLink}
                                >
                                  <img
                                    src={example.right.src}
                                    alt={example.right.label}
                                    className={styles.visualThumb}
                                  />
                                </Link>
                              </div>
                              <div className={styles.visualExampleMeta}>
                                <span>{example.similarityPercent}% match</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.repeatedExamples.length > repeatedExamples.length ? (
                          <button
                            type="button"
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
                          </button>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.visualEras.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <h3 className={styles.sectionTitle}>Recurring looks</h3>
                          <span className={styles.coverage}>
                            Recurring visual modes in the archive
                          </span>
                        </div>
                        <div className={styles.visualSingles}>
                          {recurringLooks.map((era) => (
                            <div key={era.label} className={styles.visualSingleCard}>
                              <Link
                                href={buildSimilaritySearchHref(era.photo.path)}
                                className={styles.visualThumbLink}
                              >
                                <img
                                  src={era.photo.src}
                                  alt={era.photo.label}
                                  className={styles.visualThumb}
                                />
                              </Link>
                              <div className={styles.visualExampleMeta}>
                                <span>{era.label}</span>
                                <br />
                                <span>
                                  {era.sharePercent}% of archive · {era.count.toLocaleString()} photos
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {visualSameness.visualEras.length > recurringLooks.length ? (
                          <button
                            type="button"
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
                          </button>
                        ) : null}
                      </section>
                    ) : null}
                    {visualSameness.lookTimeline.length > 0 ? (
                      <section
                        className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}
                      >
                        <div className={styles.sectionHeader}>
                          <h3 className={styles.sectionTitle}>Changed look over time</h3>
                          <span className={styles.coverage}>
                            Yearly representative frames
                          </span>
                        </div>
                        <div className={styles.visualSingles}>
                          {visualSameness.lookTimeline.map((entry) => (
                            <div key={entry.year} className={styles.visualSingleCard}>
                              <Link
                                href={buildSimilaritySearchHref(entry.photo.path)}
                                className={styles.visualThumbLink}
                              >
                                <img
                                  src={entry.photo.src}
                                  alt={entry.photo.label}
                                  className={styles.visualThumb}
                                />
                              </Link>
                              <div className={styles.visualExampleMeta}>
                                <span>{entry.year}</span>
                                <br />
                                <span>{entry.count.toLocaleString()} photos</span>
                              </div>
                            </div>
                          ))}
                        </div>
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
            description="A few quick personality reads pulled from the archive."
          >
            <section className={`${styles.section} ${styles.sectionWide}`}>
              <div className={styles.funStatsGrid}>
                {funStats.map((stat) => (
                  <article key={stat.label} className={styles.funStatCard}>
                    <div className={styles.funStatLabel}>{stat.label}</div>
                    <div className={styles.funStatValue}>{stat.value}</div>
                    <div className={styles.funStatDetail}>{stat.detail}</div>
                    {stat.actionHref ? (
                      <Link href={stat.actionHref} className={styles.funStatLink}>
                        <span>Open in Search</span>
                        <span aria-hidden="true">↗</span>
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </StatGroup>

          {(stats.recentMonthStats.length > 0 || stats.recentYearStats.length > 0) ? (
            <StatGroup
              id="recent-trends"
              title="Recent trends"
              description="A smaller look at how the archive has been moving lately."
              actions={
                <Link href="/timeline" className={styles.inlineLink}>
                  <span>Open Timeline</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              }
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.recentTrendsGrid}>
                  {stats.recentMonthStats.length > 0 ? (
                    <MiniHistogram
                      title="Last 12 months"
                      data={stats.recentMonthStats}
                    />
                  ) : null}
                  {stats.recentYearStats.length > 0 ? (
                    <YearSplitHistogram
                      title="Last 5 years"
                      data={stats.recentYearStats}
                      getHref={buildYearSearchHref}
                    />
                  ) : null}
                </div>
              </section>
            </StatGroup>
          ) : null}

          <StatGroup
            id="when-you-shoot"
            title="When You Shoot"
            description="Time-based patterns across the archive."
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
                  <h2 className={styles.sectionTitle}>Archive cadence</h2>
                  <span className={styles.coverage}>
                    {formatCoverage(activeCalendarCoverage)}
                  </span>
                  <Link href="/timeline" className={styles.inlineLink}>
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
            description="Focal length, aperture, and ISO usage."
            actions={renderScopeFilterControls()}
          >
            {activeTechnicalFacets.map(renderNumericFacet)}
            {stats.technicalRelationships ? (
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Settings relationships</h2>
                  <span className={styles.coverage}>
                    {filteredTechnicalRelationships
                      ? `Based on ${filteredTechnicalRelationships.total.toLocaleString()} photos with focal length, aperture, and ISO`
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
            description="Places from reverse-geocoded photos."
            actions={
              <div className={styles.groupActionsStack}>
                <Link href="/map" className={styles.inlineLink}>
                  <span>Open Map</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <div
                  className={styles.viewToggle}
                  role="tablist"
                  aria-label="Location chart view"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={locationView === "map"}
                    className={[
                      styles.viewToggleButton,
                      locationView === "map"
                        ? styles.viewToggleButtonActive
                        : "",
                    ].join(" ")}
                    onClick={() => {
                      setLocationView("map");
                    }}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={locationView === "sankey"}
                    className={[
                      styles.viewToggleButton,
                      locationView === "sankey"
                        ? styles.viewToggleButtonActive
                        : "",
                    ].join(" ")}
                    onClick={() => {
                      setLocationView("sankey");
                    }}
                  >
                    Sankey
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={locationView === "bars"}
                    className={[
                      styles.viewToggleButton,
                      locationView === "bars"
                        ? styles.viewToggleButtonActive
                        : "",
                    ].join(" ")}
                    onClick={() => {
                      setLocationView("bars");
                    }}
                  >
                    Bars
                  </button>
                </div>
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
            <div
              className={[
                styles.desktopOnly,
                locationView === "sankey" ? "" : styles.hidden,
              ].join(" ")}
            >
              <SankeyChart
                flow={stats.locationFlow}
                emptyMessage="Not enough linked location data yet."
                labelMaxLength={16}
                minHeight={1400}
              />
            </div>
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
            description="How lenses distribute across camera bodies."
            actions={
              <div
                className={styles.viewToggle}
                role="tablist"
                aria-label="Gear chart view"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={gearView === "sankey"}
                  className={[
                    styles.viewToggleButton,
                    gearView === "sankey" ? styles.viewToggleButtonActive : "",
                  ].join(" ")}
                  onClick={() => {
                    setGearView("sankey");
                  }}
                >
                  Sankey
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={gearView === "bars"}
                  className={[
                    styles.viewToggleButton,
                    gearView === "bars" ? styles.viewToggleButtonActive : "",
                  ].join(" ")}
                  onClick={() => {
                    setGearView("bars");
                  }}
                >
                  Bars
                </button>
              </div>
            }
          >
            <div
              className={[
                styles.desktopOnly,
                gearView === "sankey" ? "" : styles.hidden,
              ].join(" ")}
            >
              <SankeyChart flow={stats.gearFlow} />
            </div>
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
            description="Dominant tones across the archive."
          >
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Dominant colour families</h2>
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
                    actionHref={
                      COLOR_SEARCH_PARAMS[bucket.label]
                        ? `/search?color=${COLOR_SEARCH_PARAMS[bucket.label]}`
                        : null
                    }
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
          </StatGroup>

        </div>
      </main>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./stats.getStaticProps", async () => {
    const albums = await getAlbums();
    const stats = computePhotoStats(albums);
    const visualSameness = await computeVisualSamenessStats(albums);
    return { props: { stats, visualSameness } };
  });
};

export default StatsPage;
