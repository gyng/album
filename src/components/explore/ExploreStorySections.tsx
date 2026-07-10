import Link from "next/link";
import type { PhotoStats } from "../../util/computeStats";
import { buildSearchHref } from "../../util/searchFacets";
import { YearSplitHistogram } from "../YearSplitHistogram";
import { Caption, Card, Heading, Thumb, pillStyles } from "../ui";
import styles from "../../pages/explore/explore.module.css";
import { ExploreStatGroup } from "./ExplorePrimitives";
import type { FunStatCard } from "./exploreViewModel";
import { buildYearSearchHref } from "./exploreViewModel";

export const ExploreFunStatsSection = ({
  cards,
}: {
  cards: FunStatCard[];
}) => (
  <ExploreStatGroup id="fun-stats" title="Fun stats">
    <section className={`${styles.section} ${styles.sectionWide}`}>
      <div className={styles.funStatsGrid}>
        {cards.map((stat) => (
          <Card as="article" key={stat.label}>
            <Caption as="div">{stat.label}</Caption>
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
                    <span className={styles.funStatThumbYear}>
                      {example.year}
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
            {stat.actionHref ? (
              <Link
                href={stat.actionHref}
                className={`${pillStyles.base} ${pillStyles.ghost}`}
              >
                <span>Open in Search</span>
                <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  </ExploreStatGroup>
);

export const ExploreRecentTrendsSection = ({
  data,
}: {
  data: PhotoStats["recentYearStats"];
}) =>
  data.length > 0 ? (
    <ExploreStatGroup
      id="recent-trends"
      title="Recent trends"
      actions={
        <Link
          href="/timeline"
          className={`${pillStyles.base} ${pillStyles.ghost}`}
        >
          <span>Open Timeline</span>
          <span aria-hidden="true">↗</span>
        </Link>
      }
    >
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <div className={styles.recentTrendsGrid}>
          <YearSplitHistogram
            title="Last 5 years"
            data={data}
            getHref={buildYearSearchHref}
          />
        </div>
      </section>
    </ExploreStatGroup>
  ) : null;

export const ExploreRevisitedPlacesSection = ({
  places,
}: {
  places: PhotoStats["revisitedPlaces"];
}) =>
  places.length > 0 ? (
    <ExploreStatGroup id="revisited-places" title="Revisited places">
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <div className={styles.revisitedPlacesGrid}>
          {places.map((place) => (
            <section
              key={`${place.facetId}:${place.facetValue}`}
              className={`${styles.revisitedPlaceCard} ${styles.timelineSectionAligned}`}
            >
              <div className={styles.sectionHeader}>
                <Heading level={2}>{place.label}</Heading>
                <Caption as="span">
                  Seen from {place.firstYear} to {place.lastYear} across{" "}
                  {place.photoCount.toLocaleString("en")} photos
                </Caption>
                <Link
                  href={buildSearchHref({
                    facets: [
                      { facetId: place.facetId, value: place.facetValue },
                    ],
                  })}
                  className={`${pillStyles.base} ${pillStyles.ghost}`}
                >
                  <span>Open in Search</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <div className={styles.visualTimeline}>
                {place.timeline
                  .toReversed()
                  .map((entry, index, entries) => {
                    const nextEntry = entries[index + 1];
                    return (
                      <div
                        key={entry.year}
                        className={`${styles.visualTimelineRow} ${!nextEntry ? styles.visualTimelineRowLast : ""}`}
                      >
                        <div className={styles.visualTimelineMeta}>
                          <span className={styles.visualTimelineYear}>
                            {entry.year}
                          </span>
                          <span>{entry.count.toLocaleString("en")} photos</span>
                        </div>
                        <div
                          className={`${styles.visualTimelineRail} ${styles.revisitTimelineRail}`}
                          aria-hidden="true"
                        >
                          <span className={styles.visualTimelineDot} />
                          {nextEntry ? (
                            <span className={styles.revisitGapLabelInline}>
                              {entry.year - nextEntry.year}{" "}
                              {entry.year - nextEntry.year === 1
                                ? "year"
                                : "years"}
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
                                  {
                                    facetId: "year",
                                    value: String(entry.year),
                                  },
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
    </ExploreStatGroup>
  ) : null;
