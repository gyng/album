import { GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { CalendarHeatmap } from "../../components/CalendarHeatmap";
import { Nav } from "../../components/Nav";
import { TimelineDayGrid } from "../../components/TimelineDayGrid";
import { TimelineEntry } from "../../components/timelineTypes";
import { getAlbums } from "../../services/album";
import { Block, PhotoBlock } from "../../services/types";
import { measureBuild } from "../../services/buildTiming";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import commonStyles from "../../styles/common.module.css";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import {
  formatMemoryDateRange,
  getMemoryClusters,
} from "../../util/clusterByDate";
import styles from "./timeline.module.css";

const MAX_TIMELINE_MEMORY_CLUSTERS = 2;
const MAX_TIMELINE_MEMORY_ITEMS = 4;
const TIMELINE_MEMORY_LOAD_MORE_SIZE = 2;

type PageProps = {
  entries: TimelineEntry[];
};

const isTimelinePhoto = (block: Block): block is PhotoBlock => {
  return (
    block.kind === "photo" &&
    Boolean((block as PhotoBlock)._build?.exif?.DateTimeOriginal)
  );
};

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getClusterAlbumLabel = (albums: string[]) => {
  const uniqueAlbums = Array.from(new Set(albums.filter(Boolean)));
  return uniqueAlbums.length === 1 ? uniqueAlbums[0] : null;
};

const TimelinePage: NextPage<PageProps> = ({ entries }) => {
  const router = useRouter();
  const filterAlbum =
    typeof router.query.filter_album === "string"
      ? router.query.filter_album
      : null;
  const hasRouteState =
    filterAlbum != null || typeof router.query.date === "string";

  const filteredEntries = React.useMemo(() => {
    return filterAlbum
      ? entries.filter((entry) => entry.album === filterAlbum)
      : entries;
  }, [entries, filterAlbum]);

  const availableDates = React.useMemo(() => {
    return Array.from(new Set(filteredEntries.map((entry) => entry.date))).sort(
      (left, right) => right.localeCompare(left),
    );
  }, [filteredEntries]);

  // Default to latest date (first in sorted list), but allow URL param
  const initialDateFromUrl = typeof router.query.date === "string" ? router.query.date : null;
  const [selectedDate, setSelectedDate] = React.useState<string | null>(
    initialDateFromUrl && availableDates.includes(initialDateFromUrl)
      ? initialDateFromUrl
      : availableDates[0] ?? null
  );
  const [todayDate, setTodayDate] = React.useState<string | null>(null);
  const [hoveredMemoryDates, setHoveredMemoryDates] = React.useState<string[]>(
    [],
  );
  const [hoveredMemoryYears, setHoveredMemoryYears] = React.useState<number[]>(
    [],
  );
  const [memoryScrollTargetDate, setMemoryScrollTargetDate] =
    React.useState<string | null>(null);

  const selectableDates = React.useMemo(() => {
    return todayDate
      ? availableDates.filter((date) => date <= todayDate)
      : availableDates;
  }, [availableDates, todayDate]);

  React.useEffect(() => {
    setTodayDate(getLocalDateKey());
  }, []);

  const memories = React.useMemo(() => {
    if (!todayDate) {
      return [];
    }

    return getMemoryClusters(filteredEntries, todayDate);
  }, [filteredEntries, todayDate]);
  const [visibleMemoryClusterCount, setVisibleMemoryClusterCount] =
    React.useState(MAX_TIMELINE_MEMORY_CLUSTERS);

  React.useEffect(() => {
    setVisibleMemoryClusterCount(MAX_TIMELINE_MEMORY_CLUSTERS);
  }, [filteredEntries, todayDate]);

  const visibleMemories = React.useMemo(() => {
    return memories.slice(0, visibleMemoryClusterCount);
  }, [memories, visibleMemoryClusterCount]);

  const applyMemoryHighlight = React.useCallback((cluster: (typeof memories)[number]) => {
    setHoveredMemoryDates(Array.from(new Set(cluster.items.map((entry) => entry.date))));
    setHoveredMemoryYears([cluster.year]);
  }, []);

  const clearMemoryHighlight = React.useCallback(() => {
    setHoveredMemoryDates([]);
    setHoveredMemoryYears([]);
  }, []);

  // If availableDates changes and selectedDate is null, default to latest
  React.useEffect(() => {
    if (!selectedDate && availableDates.length > 0) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  // On mount or when router.query.date changes, update selectedDate if needed
  React.useEffect(() => {
    const urlDate =
      typeof router.query.date === "string" ? router.query.date : null;
    if (urlDate && availableDates.includes(urlDate)) {
      setSelectedDate((current) => (current === urlDate ? current : urlDate));
    }
  }, [router.query.date, availableDates]);

  // When selectedDate changes, update the URL param (shallow push)
  React.useEffect(() => {
    if (!selectedDate) return;
    const url = { pathname: router.pathname, query: { ...router.query, date: selectedDate } };
    if (router.query.date !== selectedDate) {
      router.replace(url, undefined, { shallow: true });
    }
  }, [router.pathname, router.query, router.replace, selectedDate]);

  React.useEffect(() => {
    if (
      selectedDate &&
      (!availableDates.includes(selectedDate) || (todayDate && selectedDate > todayDate))
    ) {
      setSelectedDate(null);
    }
  }, [availableDates, selectedDate, todayDate]);


  const handleSelectRandomDate = React.useCallback(() => {
    if (selectableDates.length === 0) {
      return;
    }
    const randomIndex = Math.floor(Math.random() * selectableDates.length);
    setSelectedDate(selectableDates[randomIndex] ?? null);
  }, [selectableDates]);

  const handleSelectOlderDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Older = higher index (dates sorted newest first)
    if (idx >= 0 && idx < selectableDates.length - 1) {
      setSelectedDate(selectableDates[idx + 1]);
    }
  }, [selectableDates, selectedDate]);

  const handleSelectNewerDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Newer = lower index (dates sorted newest first)
    if (idx > 0) {
      setSelectedDate(selectableDates[idx - 1]);
    }
  }, [selectableDates, selectedDate]);

  const selectedEntries = React.useMemo(() => {
    return selectedDate
      ? filteredEntries.filter((entry) => entry.date === selectedDate)
      : [];
  }, [filteredEntries, selectedDate]);

  const canGoOlder = React.useMemo(() => {
    if (!selectedDate) return false;
    const idx = selectableDates.indexOf(selectedDate);
    return idx >= 0 && idx < selectableDates.length - 1;
  }, [selectableDates, selectedDate]);

  const canGoNewer = React.useMemo(() => {
    if (!selectedDate) return false;
    const idx = selectableDates.indexOf(selectedDate);
    return idx > 0;
  }, [selectableDates, selectedDate]);

  return (
    <div className={styles.page}>
      <Seo
        title="Timeline | Snapshots"
        description="Explore dated photos across the archive timeline."
        pathname="/timeline"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd({
          name: "Timeline | Snapshots",
          description: "Explore dated photos across the archive timeline.",
          pathname: "/timeline",
        })}
      />

      <main className={styles.main}>
        <Nav hasPadding={false} />

        <header className={styles.header}>
          <h1 className={styles.title}>Timeline</h1>
          {filterAlbum ? (
            <div className={commonStyles.toast}>
              only showing photos from{" "}
              <Link href={`/album/${filterAlbum}`}>
                <i>{filterAlbum}</i>
              </Link>
            </div>
          ) : null}
        </header>

        <div className={styles.browseActionsBar}>
          <Link href="/search" className={styles.exploreLink}>
            🔍 Explore photos
          </Link>
          <Link href="/map" className={styles.exploreLink}>
            🗺️ Explore the map
          </Link>
        </div>

        {filteredEntries.length === 0 ? (
          <div className={styles.emptyState}>
            No dated photos are available for this view yet.
          </div>
        ) : (
          <>
            <div className={styles.layout}>
              <div className={styles.leftColumn}>
                <section className={styles.heatmapPanel} aria-label="Timeline heatmap panel">
                  <CalendarHeatmap
                    entries={filteredEntries}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    todayDate={todayDate ?? undefined}
                    highlightedDates={hoveredMemoryDates}
                    highlightedYears={hoveredMemoryYears}
                    scrollToDate={memoryScrollTargetDate}
                  />
                </section>

                {visibleMemories.length > 0 ? (
                  <section className={styles.memories} aria-label="Memories">
                    <div className={styles.memoriesHeader}>
                      <h2 className={styles.memoriesTitle}>Memories</h2>
                      <p className={styles.memoriesCaption}>Around this time</p>
                    </div>

                    <div className={styles.memoryClusters}>
                      {visibleMemories.map((cluster) => {
                        const albumLabel = getClusterAlbumLabel(
                          cluster.items.map((entry) => entry.album),
                        );
                        const previewItems = cluster.items.slice(
                          0,
                          MAX_TIMELINE_MEMORY_ITEMS,
                        );
                        const meta = [
                          albumLabel,
                          formatMemoryDateRange(cluster.startDate, cluster.endDate),
                        ].filter(Boolean);
                        const swatches = Array.from(
                          new Set(
                            previewItems
                              .map((entry) => entry.placeholderColor)
                              .filter(
                                (color) =>
                                  color && color !== "transparent",
                              ),
                          ),
                        ).slice(0, 4);
                        const label = [
                          `${cluster.yearsAgo} year${cluster.yearsAgo === 1 ? "" : "s"} ago`,
                          ...meta,
                        ].join(" · ");
                        const ageLabel = `${cluster.yearsAgo} year${cluster.yearsAgo === 1 ? "" : "s"} ago`;
                        const metaLabel = meta.join(" · ");
                        const clusterId = `memory-cluster-${cluster.year}-${cluster.startDate}-${cluster.endDate}`;

                        return (
                          <section
                            key={`${cluster.year}-${cluster.startDate}-${cluster.endDate}`}
                            className={styles.memoryCluster}
                            data-testid={clusterId}
                            onMouseEnter={() => applyMemoryHighlight(cluster)}
                            onMouseLeave={clearMemoryHighlight}
                            onFocusCapture={() => applyMemoryHighlight(cluster)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                clearMemoryHighlight();
                              }
                            }}
                          >
                            <div className={styles.memoryClusterHeader}>
                              <button
                                type="button"
                                className={styles.memoryClusterLabelButton}
                                onClick={() => {
                                  setSelectedDate(cluster.startDate);
                                  setMemoryScrollTargetDate(cluster.startDate);
                                }}
                                aria-label={label}
                                id={clusterId}
                              >
                                <span className={styles.memoryClusterAge}>{ageLabel}</span>
                                {metaLabel ? (
                                  <span className={styles.memoryClusterLabel}>{metaLabel}</span>
                                ) : null}
                                {swatches.length > 0 ? (
                                  <span
                                    className={styles.memoryClusterSwatches}
                                    aria-hidden="true"
                                  >
                                    {swatches.map((color) => (
                                      <span
                                        key={color}
                                        className={styles.memoryClusterSwatch}
                                        style={{ backgroundColor: color }}
                                      />
                                    ))}
                                  </span>
                                ) : null}
                              </button>
                            </div>

                            <ul className={styles.memoryStrip}>
                              {previewItems.map((entry) => (
                                <li key={entry.href} className={styles.memoryItem}>
                                  <button
                                    type="button"
                                    className={styles.memoryButton}
                                    onClick={() => {
                                      setSelectedDate(entry.date);
                                    }}
                                    aria-label={`Jump to ${entry.album} on ${entry.date}`}
                                    title={`Jump to ${entry.date}`}
                                  >
                                    <img
                                      src={entry.src.src}
                                      width={entry.placeholderWidth}
                                      height={entry.placeholderHeight}
                                      style={{ backgroundColor: entry.placeholderColor }}
                                      className={styles.memoryImage}
                                      alt=""
                                    />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>

                    {memories.length > visibleMemoryClusterCount ? (
                      <button
                        type="button"
                        className={`${commonStyles.button} ${styles.memoryLoadMoreButton}`}
                        onClick={() => {
                          setVisibleMemoryClusterCount((current) =>
                            Math.min(
                              current + TIMELINE_MEMORY_LOAD_MORE_SIZE,
                              memories.length,
                            ),
                          );
                        }}
                      >
                        More memories…
                      </button>
                    ) : null}
                  </section>
                ) : null}
              </div>
              <div className={styles.dayPanel}>
                <TimelineDayGrid
                  date={selectedDate}
                  entries={selectedEntries}
                  onSelectRandomDate={handleSelectRandomDate}
                  onSelectOlderDate={handleSelectOlderDate}
                  onSelectNewerDate={handleSelectNewerDate}
                  canGoOlder={canGoOlder}
                  canGoNewer={canGoNewer}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./timeline.getStaticProps", async () => {
    const albums = await getAlbums();

    const entries = albums
      .flatMap((album) => {
        return album.blocks.filter(isTimelinePhoto).flatMap((photo) => {
          const dateTimeOriginal = photo._build?.exif?.DateTimeOriginal;
          const src = photo._build?.srcset?.[0];

          if (!dateTimeOriginal || !src) {
            return [] as TimelineEntry[];
          }

          const parsedDate = new Date(dateTimeOriginal);
          if (Number.isNaN(parsedDate.getTime())) {
            return [] as TimelineEntry[];
          }

          const filename = photo.data.src.split("/").at(-1) ?? photo.id;
          const primaryColor = photo._build?.tags?.colors?.[0];
          const geocode = photo._build?.tags?.geocode ?? null;
          const {
            GPSLongitude,
            GPSLatitude,
            GPSLongitudeRef,
            GPSLatitudeRef,
          } = photo._build?.exif ?? {};
          const { decLng, decLat } =
            GPSLongitude && GPSLatitude && GPSLongitudeRef && GPSLatitudeRef
              ? getDegLatLngFromExif({
                  GPSLongitude,
                  GPSLatitude,
                  GPSLongitudeRef,
                  GPSLatitudeRef,
                })
              : { decLng: null, decLat: null };

          return [
            {
              album: album._build.slug,
              date: parsedDate.toISOString().slice(0, 10),
              dateTimeOriginal: parsedDate.toISOString(),
              decLat,
              decLng,
              geocode,
              src,
              href: `/album/${album._build.slug}#${filename}`,
              path: photo.data.src,
              placeholderColor: primaryColor
                ? `rgba(${primaryColor[0]}, ${primaryColor[1]}, ${primaryColor[2]}, 1)`
                : "transparent",
              placeholderWidth: photo._build?.width,
              placeholderHeight: photo._build?.height,
            },
          ];
        });
      })
      .sort((left, right) => {
        if (left.date !== right.date) {
          return right.date.localeCompare(left.date);
        }

        if (left.dateTimeOriginal !== right.dateTimeOriginal) {
          return right.dateTimeOriginal.localeCompare(left.dateTimeOriginal);
        }

        return left.href.localeCompare(right.href);
      });

    return { props: { entries } };
  });
};

export default TimelinePage;
