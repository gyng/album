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
import { getAlbums } from "../../services/album";
import {
  computeVisualSamenessStats,
  VisualSamenessStats,
} from "../../util/computeEmbeddingStats";
import {
  computePhotoStats,
  NumericFacetStat,
  PhotoStats,
  ShootingScopeStats,
  StringFacetStat,
} from "../../util/computeStats";
import { measureBuild } from "../../services/buildTiming";
import { Footer, SegmentedToggle, Card, Heading, Caption, PillButton, pillStyles, Select } from "../../components/ui";
import styles from "./explore.module.css";
import { buildSearchFacetHref, isSearchableFacetId } from "../../util/searchFacets";
import {
  ExploreStatGroup as StatGroup,
  ExploreStatSection as StatSection,
  VisualSimilarityThumb,
} from "../../components/explore/ExplorePrimitives";
import {
  buildExploreFunStats,
  buildExploreOverviewCards,
  EXPLORE_SECTION_LINKS,
  findNumericFacet,
  findStringFacet,
  formatCoverage,
  isAggregateLocationBucket,
} from "../../components/explore/exploreViewModel";
import { ExploreOverview } from "../../components/explore/ExploreOverview";
import {
  ExploreFunStatsSection,
  ExploreRecentTrendsSection,
  ExploreRevisitedPlacesSection,
} from "../../components/explore/ExploreStorySections";
import { ExploreColourSection } from "../../components/explore/ExploreColourSection";

type PageProps = {
  stats: PhotoStats;
  visualSameness: VisualSamenessStats | null;
};

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
  const overviewCards = buildExploreOverviewCards(stats);
  const funStats = buildExploreFunStats(stats);
  const sectionLinks = EXPLORE_SECTION_LINKS;
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

      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="explore" hasPadding={false} />

        <ExploreOverview sectionLinks={sectionLinks} cards={overviewCards} />

        <div className={styles.groups}>
          {visualSameness ? (
            <StatGroup
              id="visual-sameness"
              title="Visual sameness"
            >
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.visualSummaryGrid}>
                  <Card as="article" className={styles.overviewCard}>
                    <Caption as="div">Sameness</Caption>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.samenessPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Average nearest-neighbour similarity across {visualSameness.sampleSize.toLocaleString("en")} embedded photos in the archive.
                    </div>
                  </Card>
                  <Card as="article" className={styles.overviewCard}>
                    <Caption as="div">Repeated motifs</Caption>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.repeatedMotifPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos with a very close visual neighbour at or above {Math.round(visualSameness.highSimilarityThreshold * 100)}% similarity.
                    </div>
                  </Card>
                  <Card as="article" className={styles.overviewCard}>
                    <Caption as="div">Distinct frames</Caption>
                    <div className={styles.visualSummaryValue}>
                      {visualSameness.distinctPercent}%
                    </div>
                    <div className={styles.funStatDetail}>
                      Photos whose nearest visual neighbour stays below {Math.round(visualSameness.lowSimilarityThreshold * 100)}% similarity.
                    </div>
                  </Card>
                  {visualSameness.lookDrift ? (
                    <Card as="article" className={styles.overviewCard}>
                      <Caption as="div">Changed look over time</Caption>
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
                      <Caption as="div">Recurring looks</Caption>
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
                          <Caption as="span">
                            Closest to the archive centre
                          </Caption>
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
                                  {example.centroidSimilarityPercent}% to archive centre
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
                          <Caption as="span">
                            Weakest nearest-neighbour matches
                          </Caption>
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
                          <Caption as="span">
                            Closest recurring visual matches
                          </Caption>
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
                          <Caption as="span">
                            Recurring visual modes in the archive
                          </Caption>
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
                          <Caption as="span">
                            Yearly representative sets
                          </Caption>
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

          <ExploreFunStatsSection cards={funStats} />
          <ExploreRecentTrendsSection data={stats.recentYearStats} />
          <ExploreRevisitedPlacesSection places={stats.revisitedPlaces} />

          <StatGroup
            id="when-you-shoot"
            title="When you shoot"
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
                  <Caption as="span">
                    {formatCoverage(activeCalendarCoverage)}
                  </Caption>
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
            title="How you shoot"
            actions={renderScopeFilterControls()}
          >
            {activeTechnicalFacets.map(renderNumericFacet)}
            {stats.technicalRelationships ? (
              <section className={`${styles.section} ${styles.sectionWide}`}>
                <div className={styles.sectionHeader}>
                  <Heading level={2} as="h2">Settings relationships</Heading>
                  <Caption as="span">
                    {filteredTechnicalRelationships
                      ? `Based on ${filteredTechnicalRelationships.total.toLocaleString("en")} photos with focal length, aperture, and ISO`
                      : "No matching photos with focal length, aperture, and ISO for this combination"}
                  </Caption>
                </div>
                {filteredTechnicalRelationships ? (
                  <TechnicalHeatmaps
                    data={filteredTechnicalRelationships}
                    layout="tri-grid"
                  />
                ) : (
                  <Caption size="sm">No data available.</Caption>
                )}
              </section>
            ) : null}
          </StatGroup>

          <StatGroup
            id="where-you-shoot"
            title="Where you shoot"
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
            title="What you shoot with"
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

          <ExploreColourSection stats={stats} />

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
    // Degrade gracefully: a corrupt or missing embeddings DB should drop the
    // visual-sameness section, not fail the whole build. The page already
    // treats visualSameness === null as "section unavailable".
    let visualSameness: VisualSamenessStats | null = null;
    try {
      visualSameness = await computeVisualSamenessStats(albums);
    } catch (err) {
      console.error("Failed to compute visual sameness stats", err);
    }
    return { props: { stats, visualSameness } };
  });
};

export default StatsPage;
