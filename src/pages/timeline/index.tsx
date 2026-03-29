import { GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { CalendarHeatmap } from "../../components/CalendarHeatmap";
import { GlobalNav } from "../../components/GlobalNav";
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
import heatmapStyles from "../../components/CalendarHeatmap.module.css";
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

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

type ConnectorCurve = {
  startX: number;
  startY: number;
  control1X: number;
  control1Y: number;
  control2X: number;
  control2Y: number;
  endX: number;
  endY: number;
};

const toConnectorPath = (curve: ConnectorCurve) => {
  return [
    `M ${curve.startX} ${curve.startY}`,
    `C ${curve.control1X} ${curve.control1Y} ${curve.control2X} ${curve.control2Y} ${curve.endX} ${curve.endY}`,
  ].join(" ");
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
  const initialDateFromUrl =
    typeof router.query.date === "string" ? router.query.date : null;
  const [selectedDate, setSelectedDate] = React.useState<string | null>(
    initialDateFromUrl && availableDates.includes(initialDateFromUrl)
      ? initialDateFromUrl
      : (availableDates[0] ?? null),
  );
  const [todayDate, setTodayDate] = React.useState<string | null>(null);
  const [memoryScrollTargetDate, setMemoryScrollTargetDate] = React.useState<
    string | null
  >(null);
  const layoutRef = React.useRef<HTMLDivElement | null>(null);
  const heatmapPanelRef = React.useRef<HTMLElement | null>(null);
  const dayHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const selectedConnectorSvgRef = React.useRef<SVGSVGElement | null>(null);
  const selectedConnectorPathRef = React.useRef<SVGPathElement | null>(null);
  const highlightedHeatmapElementsRef = React.useRef<HTMLElement[]>([]);
  const routePathname = router.pathname;
  const routeQuery = router.query;
  const routeDateQuery =
    typeof routeQuery.date === "string" ? routeQuery.date : null;
  const replaceRoute = router.replace;

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

  const applyMemoryHighlight = React.useCallback(
    (cluster: (typeof memories)[number]) => {
      const heatmapPanel = heatmapPanelRef.current;
      if (!heatmapPanel) {
        return;
      }

      highlightedHeatmapElementsRef.current.forEach((element) => {
        element.classList.remove(heatmapStyles.memoryHighlighted);
        element.classList.remove(heatmapStyles.highlightedYearHeading);
      });

      const nextElements: HTMLElement[] = [];
      const uniqueDates = Array.from(
        new Set(cluster.items.map((entry) => entry.date)),
      );
      uniqueDates.forEach((date) => {
        const element = heatmapPanel.querySelector<HTMLElement>(
          `[data-date="${date}"]`,
        );
        if (element) {
          element.classList.add(heatmapStyles.memoryHighlighted);
          nextElements.push(element);
        }
      });

      const yearHeading = heatmapPanel.querySelector<HTMLElement>(
        `[data-year-heading="${cluster.year}"]`,
      );
      if (yearHeading) {
        yearHeading.classList.add(heatmapStyles.highlightedYearHeading);
        nextElements.push(yearHeading);
      }

      highlightedHeatmapElementsRef.current = nextElements;
    },
    [],
  );

  const clearMemoryHighlight = React.useCallback(() => {
    highlightedHeatmapElementsRef.current.forEach((element) => {
      element.classList.remove(heatmapStyles.memoryHighlighted);
      element.classList.remove(heatmapStyles.highlightedYearHeading);
    });
    highlightedHeatmapElementsRef.current = [];
  }, []);

  const clearSelectedConnectorPath = React.useCallback(() => {
    if (selectedConnectorPathRef.current) {
      selectedConnectorPathRef.current.setAttribute("d", "");
    }
  }, []);

  const updateSelectedConnectorPath = React.useCallback(() => {
    if (
      !selectedDate ||
      typeof window === "undefined" ||
      window.innerWidth < 960
    ) {
      clearSelectedConnectorPath();
      return;
    }

    const layout = layoutRef.current;
    const heading = dayHeadingRef.current;
    const connectorSvg = selectedConnectorSvgRef.current;
    const connectorPath = selectedConnectorPathRef.current;
    if (!layout || !heading || !connectorSvg || !connectorPath) {
      return;
    }

    const target = layout.querySelector<HTMLElement>(
      `[data-date="${selectedDate}"]`,
    );
    if (!target) {
      clearSelectedConnectorPath();
      return;
    }

    const layoutRect = layout.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    connectorSvg.setAttribute(
      "viewBox",
      `0 0 ${layout.clientWidth} ${layout.clientHeight}`,
    );

    const startX = headingRect.left - layoutRect.left - 16;
    const startY = headingRect.top + headingRect.height / 2 - layoutRect.top;
    const endX = clamp(
      targetRect.left + targetRect.width / 2 - layoutRect.left,
      10,
      layoutRect.width - 10,
    );
    const endY = clamp(
      targetRect.top + targetRect.height / 2 - layoutRect.top,
      10,
      layoutRect.height - 10,
    );
    const controlOffset = Math.max(48, Math.abs(startX - endX) * 0.18);
    const nextCurve: ConnectorCurve = {
      startX,
      startY,
      control1X: startX - controlOffset,
      control1Y: startY,
      control2X: endX + controlOffset,
      control2Y: endY,
      endX,
      endY,
    };

    connectorPath.setAttribute("d", toConnectorPath(nextCurve));
  }, [clearSelectedConnectorPath, selectedDate]);

  React.useEffect(() => {
    updateSelectedConnectorPath();

    if (typeof window === "undefined") {
      return;
    }

    let frameId: number | null = null;
    const handleResize = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSelectedConnectorPath();
      });
    };

    const handleScroll = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSelectedConnectorPath();
      });
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [updateSelectedConnectorPath, filteredEntries, todayDate]);

  // If availableDates changes and selectedDate is null, default to latest
  React.useEffect(() => {
    if (!selectedDate && availableDates.length > 0) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  // On mount or when router.query.date changes, update selectedDate if needed
  React.useEffect(() => {
    if (routeDateQuery && availableDates.includes(routeDateQuery)) {
      setSelectedDate((current) =>
        current === routeDateQuery ? current : routeDateQuery,
      );
    }
  }, [availableDates, routeDateQuery]);

  // When selectedDate changes, update the URL param (shallow push)
  React.useEffect(() => {
    if (!selectedDate) return;
    const url = {
      pathname: routePathname,
      query: { ...routeQuery, date: selectedDate },
    };
    if (routeDateQuery !== selectedDate) {
      replaceRoute(url, undefined, { shallow: true });
    }
  }, [replaceRoute, routeDateQuery, routePathname, routeQuery, selectedDate]);

  React.useEffect(() => {
    if (
      selectedDate &&
      (!availableDates.includes(selectedDate) ||
        (todayDate && selectedDate > todayDate))
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

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleSelectOlderDate();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleSelectNewerDate();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSelectNewerDate, handleSelectOlderDate]);

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
        <GlobalNav currentPage="timeline" hasPadding={false} />

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

        {filteredEntries.length === 0 ? (
          <div className={styles.emptyState}>
            No dated photos are available for this view yet.
          </div>
        ) : (
          <>
            <div className={styles.layout} ref={layoutRef}>
              <svg
                ref={selectedConnectorSvgRef}
                className={styles.selectedConnector}
                aria-hidden="true"
                preserveAspectRatio="none"
              >
                <path
                  ref={selectedConnectorPathRef}
                  className={styles.selectedConnectorPath}
                  d=""
                />
              </svg>
              <div className={styles.leftColumn}>
                <section
                  ref={heatmapPanelRef}
                  className={styles.heatmapPanel}
                  aria-label="Timeline heatmap panel"
                >
                  <CalendarHeatmap
                    entries={filteredEntries}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    todayDate={todayDate ?? undefined}
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
                          formatMemoryDateRange(
                            cluster.startDate,
                            cluster.endDate,
                          ),
                        ].filter(Boolean);
                        const swatches = Array.from(
                          new Set(
                            previewItems
                              .map((entry) => entry.placeholderColor)
                              .filter(
                                (color) => color && color !== "transparent",
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
                              if (
                                !event.currentTarget.contains(
                                  event.relatedTarget as Node | null,
                                )
                              ) {
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
                                <span className={styles.memoryClusterAge}>
                                  {ageLabel}
                                </span>
                                {metaLabel ? (
                                  <span className={styles.memoryClusterLabel}>
                                    {metaLabel}
                                  </span>
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
                                <li
                                  key={entry.href}
                                  className={styles.memoryItem}
                                >
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
                                      style={{
                                        backgroundColor: entry.placeholderColor,
                                      }}
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
                  dateHeadingRef={dayHeadingRef}
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
          const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef } =
            photo._build?.exif ?? {};
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
