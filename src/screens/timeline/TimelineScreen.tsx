import { AppLink as Link, usePublicConfig, useUrlSearchParams } from "../../components/platform";
import React from "react";
import { CalendarHeatmap } from "../../components/CalendarHeatmap";
import { GlobalNav } from "../../components/GlobalNav";
import { Caption, Footer, Heading, PillButton } from "../../components/ui";
import { TimelineDayGrid } from "../../components/TimelineDayGrid";
import { TimelineTripsSection } from "../../components/TimelineTripsSection";
import type { TimelineEntry } from "../../util/pageDataTypes";
import commonStyles from "../../styles/common.module.css";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd, formatPageTitle } from "../../lib/seo";
import { formatMemoryDateRange, getMemoryClusters } from "../../util/clusterByDate";
import styles from "./TimelineScreen.module.css";
import { unpackTimelineEntry, type TimelineEntryRow } from "../../util/pageDataRows";
import { useHydrated } from "../../components/useHydrated";

const MAX_TIMELINE_MEMORY_CLUSTERS = 2;
const MAX_TIMELINE_MEMORY_ITEMS = 4;
const TIMELINE_MEMORY_LOAD_MORE_SIZE = 2;

export type TimelineScreenProps = {
  entries?: TimelineEntry[];
  entryRows?: TimelineEntryRow[];
};

type MemoryHighlight = {
  dates: string[];
  year: number;
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

const TimelineScreen = ({ entries: suppliedEntries, entryRows }: TimelineScreenProps) => {
  const { siteOrigin } = usePublicConfig();
  const entries = React.useMemo(
    () => suppliedEntries ?? entryRows?.map(unpackTimelineEntry) ?? [],
    [entryRows, suppliedEntries],
  );
  const {
    ready: urlReady,
    searchParams,
    getSearchParam,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const hydrated = useHydrated();
  const routeReady = hydrated && urlReady;
  const filterAlbum = routeReady ? getSearchParam("filter_album") : null;
  const hasRouteState = routeReady && (filterAlbum != null || hasSearchParam("date"));

  const filteredEntries = React.useMemo(() => {
    return filterAlbum ? entries.filter((entry) => entry.album === filterAlbum) : entries;
  }, [entries, filterAlbum]);

  const availableDates = React.useMemo(() => {
    return Array.from(new Set(filteredEntries.map((entry) => entry.date))).sort((left, right) =>
      right.localeCompare(left),
    );
  }, [filteredEntries]);

  // The static server never sees query parameters, so initialise from album
  // data only. Route state is applied after the hydration snapshot matches.
  const [selectedDate, setSelectedDate] = React.useState<string | null>(availableDates[0] ?? null);
  const [todayDate, setTodayDate] = React.useState<string | null>(null);
  const [memoryScrollTargetDate, setMemoryScrollTargetDate] = React.useState<string | null>(null);
  const layoutRef = React.useRef<HTMLDivElement | null>(null);
  const dayHeadingRef = React.useRef<HTMLDivElement | null>(null);
  const selectedConnectorSvgRef = React.useRef<SVGSVGElement | null>(null);
  const selectedConnectorPathRef = React.useRef<SVGPathElement | null>(null);
  const [memoryHighlight, setMemoryHighlight] = React.useState<MemoryHighlight | null>(null);
  const routeDateQuery = routeReady ? getSearchParam("date") : null;

  const selectableDates = React.useMemo(() => {
    return todayDate ? availableDates.filter((date) => date <= todayDate) : availableDates;
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
  const [visibleMemoryClusterCount, setVisibleMemoryClusterCount] = React.useState(
    MAX_TIMELINE_MEMORY_CLUSTERS,
  );

  React.useEffect(() => {
    setVisibleMemoryClusterCount(MAX_TIMELINE_MEMORY_CLUSTERS);
  }, [filteredEntries, todayDate]);

  const visibleMemories = React.useMemo(() => {
    return memories.slice(0, visibleMemoryClusterCount);
  }, [memories, visibleMemoryClusterCount]);

  const applyMemoryHighlight = React.useCallback((cluster: (typeof memories)[number]) => {
    setMemoryHighlight({
      dates: Array.from(new Set(cluster.items.map((entry) => entry.date))),
      year: cluster.year,
    });
  }, []);

  const clearMemoryHighlight = React.useCallback(() => {
    setMemoryHighlight(null);
  }, []);

  const clearSelectedConnectorPath = React.useCallback(() => {
    if (selectedConnectorPathRef.current) {
      selectedConnectorPathRef.current.setAttribute("d", "");
    }
  }, []);

  const updateSelectedConnectorPath = React.useCallback(() => {
    if (!selectedDate || window.innerWidth < 960) {
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

    const target = layout.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    if (!target) {
      clearSelectedConnectorPath();
      return;
    }

    const layoutRect = layout.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    connectorSvg.setAttribute("viewBox", `0 0 ${layout.clientWidth} ${layout.clientHeight}`);

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

  // If the available dates change and no date is selected, default to the
  // latest selectable date. Using all available dates here would repeatedly
  // reselect a future date that the validity effect immediately clears.
  React.useEffect(() => {
    if (!selectedDate && selectableDates.length > 0) {
      // invariant: length checked above
      setSelectedDate(selectableDates[0]!);
    }
  }, [selectableDates, selectedDate]);

  // The date the URL and the selection are agreed on — either because the
  // reader just picked it, or because it arrived in the URL and was adopted.
  // Only a reader's pick should be written back: echoing an incoming date, or
  // writing the hydration default, would clobber a real deep link.
  const chosenDateRef = React.useRef<string | null>(null);
  const chooseDate = React.useCallback((date: string | null) => {
    chosenDateRef.current = date;
    setSelectedDate(date);
  }, []);

  // On mount or when router.query.date changes, update selectedDate if needed
  React.useEffect(() => {
    if (!routeReady) return;
    if (routeDateQuery && availableDates.includes(routeDateQuery)) {
      // Adopting the URL's date counts as the current intent: the two now agree,
      // so there is nothing to write back. Claiming it here rather than after
      // the state lands also closes the window where this effect and the sync
      // effect run in the same pass and the sync still sees the previous date.
      chosenDateRef.current = routeDateQuery;
      setSelectedDate((current) => (current === routeDateQuery ? current : routeDateQuery));
    }
  }, [availableDates, routeDateQuery, routeReady]);

  // When selectedDate changes, update the URL param (shallow push).
  // Gated until the platform has populated query state so hydration cannot
  // clobber real ?date/?filter_album deep links.
  React.useEffect(() => {
    if (!routeReady || !selectedDate) return;
    if (!availableDates.includes(selectedDate)) return;
    // Write the URL only for a date the reader picked. Anything else is either
    // the deep link being applied or the hydration default, and echoing those
    // back would clobber a real ?date=. Inferring this from "the URL disagrees"
    // instead froze ?date= on whichever day was opened first.
    if (chosenDateRef.current !== selectedDate) return;
    if (routeDateQuery !== selectedDate) {
      const next = new URLSearchParams(searchParams);
      next.set("date", selectedDate);
      replaceSearchParams(next);
    }
  }, [availableDates, replaceSearchParams, routeDateQuery, routeReady, searchParams, selectedDate]);

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
    // invariant: randomIndex is within bounds (length checked above)
    chooseDate(selectableDates[randomIndex]!);
  }, [chooseDate, selectableDates]);

  const handleSelectOlderDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Older = higher index (dates sorted newest first)
    if (idx >= 0 && idx < selectableDates.length - 1) {
      // invariant: idx + 1 is within bounds (checked above)
      chooseDate(selectableDates[idx + 1]!);
    }
  }, [chooseDate, selectableDates, selectedDate]);

  const handleSelectNewerDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Newer = lower index (dates sorted newest first)
    if (idx > 0) {
      // invariant: idx - 1 is within bounds (idx > 0 checked above)
      chooseDate(selectableDates[idx - 1]!);
    }
  }, [chooseDate, selectableDates, selectedDate]);

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
    return selectedDate ? filteredEntries.filter((entry) => entry.date === selectedDate) : [];
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
        title={formatPageTitle("Timeline")}
        description="Explore dated photos across the archive timeline."
        pathname="/timeline"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd(
          {
            name: formatPageTitle("Timeline"),
            description: "Explore dated photos across the archive timeline.",
            pathname: "/timeline",
          },
          siteOrigin,
        )}
      />

      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="timeline" hasPadding={false} />

        <header className={styles.header}>
          <Heading level={1} as="h1" className={styles.title}>
            Timeline
          </Heading>
          {filterAlbum ? (
            <div className={commonStyles.toast}>
              Showing only photos from{" "}
              <Link href={`/album/${filterAlbum}`}>
                <i>{filterAlbum}</i>
              </Link>
            </div>
          ) : null}
        </header>

        {filteredEntries.length === 0 ? (
          <div className={styles.emptyState}>No dated photos are available for this view yet.</div>
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
                <section className={styles.heatmapPanel} aria-label="Timeline heatmap panel">
                  <CalendarHeatmap
                    entries={filteredEntries}
                    selectedDate={selectedDate}
                    onSelectDate={chooseDate}
                    {...(todayDate ? { todayDate } : {})}
                    highlightedDates={memoryHighlight?.dates ?? []}
                    highlightedYears={memoryHighlight ? [memoryHighlight.year] : []}
                    scrollToDate={memoryScrollTargetDate}
                  />
                </section>

                {/* The rung between the heatmap and a single day: these days
                    were one journey, which neither of the other two can say. */}
                <TimelineTripsSection entries={filteredEntries} onSelectDate={chooseDate} />

                {visibleMemories.length > 0 ? (
                  <section className={styles.memories} aria-label="Memories">
                    <div className={styles.memoriesHeader}>
                      <Heading level={2} as="h2">
                        Memories
                      </Heading>
                      <Caption>Around this time</Caption>
                    </div>

                    <div className={styles.memoryClusters}>
                      {visibleMemories.map((cluster) => {
                        const albumLabel = getClusterAlbumLabel(
                          cluster.items.map((entry) => entry.album),
                        );
                        const previewItems = cluster.items.slice(0, MAX_TIMELINE_MEMORY_ITEMS);
                        const meta = [
                          albumLabel,
                          formatMemoryDateRange(cluster.startDate, cluster.endDate),
                        ].filter(Boolean);
                        const swatches = Array.from(
                          new Set(
                            previewItems
                              .map((entry) => entry.placeholderColor)
                              .filter((color) => color && color !== "transparent"),
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
                                !event.currentTarget.contains(event.relatedTarget as Node | null)
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
                                  chooseDate(cluster.startDate);
                                  setMemoryScrollTargetDate(cluster.startDate);
                                }}
                                aria-label={label}
                                id={clusterId}
                              >
                                <span className={styles.memoryClusterAge}>{ageLabel}</span>
                                <span className={styles.memoryClusterLabel}>{metaLabel}</span>
                                {swatches.length > 0 ? (
                                  <span className={styles.memoryClusterSwatches} aria-hidden="true">
                                    {swatches.map((color) => (
                                      <span
                                        data-colour-swatch
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
                                      chooseDate(entry.date);
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
                      <PillButton
                        className={styles.memoryLoadMoreButton}
                        onClick={() => {
                          setVisibleMemoryClusterCount((current) =>
                            Math.min(current + TIMELINE_MEMORY_LOAD_MORE_SIZE, memories.length),
                          );
                        }}
                      >
                        Load more memories
                      </PillButton>
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
      <Footer />
    </div>
  );
};

export default TimelineScreen;
