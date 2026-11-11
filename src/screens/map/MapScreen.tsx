import { formatMediaCountOf } from "../../util/mediaCount";
import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { GlobalNav } from "../../components/GlobalNav";
import { MapStyleToggle } from "../../components/MapStyleToggle";
import type { MapWorldEntry, TimeRange } from "../../util/pageDataTypes";
import styles from "./MapScreen.module.css";
import commonStyles from "../../styles/common.module.css";
import { AppLink as Link, usePublicConfig, useUrlSearchParams } from "../../components/platform";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd, formatPageTitle } from "../../lib/seo";
import { getDefaultRouteMode, RouteMode } from "../../components/mapRoute";
import { TimeRangeSlider } from "../../components/TimeRangeSlider";
import {
  formatDisplayDate,
  formatRangeParam,
  parseRangeParam,
  snapRangeToSeconds,
} from "../../util/timeRange";
import { filterPhotosByQuery, isPhotoInTimeRange } from "../../components/mapWorldViewModel";
import { fetchMapSearchIndex } from "../../util/mapSearchIndex";
import { buttonStyles } from "../../components/ui";
import { unpackMapWorldEntry, type MapWorldEntryRow } from "../../util/pageDataRows";
import { useHydrated } from "../../components/useHydrated";

export type MapScreenProps = {
  photos?: MapWorldEntry[];
  photoRows?: MapWorldEntryRow[];
};

const DEBOUNCE_URL_MS = 300;
// Naming every pin only helps once a search has narrowed the map down. "japan"
// matches over 900 photos, and captioning those would bury the map under its own
// labels, so the previews only appear for a result set you could actually read.
const MAX_PREVIEWABLE_RESULTS = 12;

const MapScreen = (props: MapScreenProps) => {
  const { siteOrigin } = usePublicConfig();
  const photos = React.useMemo(
    () => props.photos ?? props.photoRows?.map(unpackMapWorldEntry) ?? [],
    [props.photoRows, props.photos],
  );
  const {
    ready: urlReady,
    getSearchParam,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const hydrated = useHydrated();
  const routeReady = hydrated && urlReady;
  // Statically generated pages do not know their query during server rendering.
  // Keep the first client render identical, then apply URL state once the
  // renderer says navigation is ready.
  const filterAlbum = routeReady ? getSearchParam("filter_album") : null;
  const hasCameraParams =
    routeReady &&
    (getSearchParam("lat") != null ||
      getSearchParam("lon") != null ||
      getSearchParam("zoom") != null);
  const hasRouteState =
    filterAlbum != null ||
    hasCameraParams ||
    (routeReady && (hasSearchParam("from") || hasSearchParam("to") || hasSearchParam("q")));

  // Album filtering (existing)
  const albumFilteredPhotos = React.useMemo(
    () => (filterAlbum ? photos.filter((p) => p.album === filterAlbum) : photos),
    [photos, filterAlbum],
  );

  // Time range state — live during drag, committed on pointer up
  const urlFromParam = routeReady ? getSearchParam("from") : null;
  const urlToParam = routeReady ? getSearchParam("to") : null;
  const urlFrom = parseRangeParam(urlFromParam);
  const urlTo = parseRangeParam(urlToParam, { endOfDay: true });
  const [timeRange, setTimeRange] = React.useState<TimeRange | null>(
    urlFrom !== null && urlTo !== null ? { fromMs: urlFrom, toMs: urlTo } : null,
  );
  const [showTimeRangeSlider, setShowTimeRangeSlider] = React.useState(
    urlFrom !== null && urlTo !== null,
  );
  const urlSyncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryUrlTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from URL on navigation (back/forward): a new range in the URL replaces
  // the one on screen, and its arrival opens the slider.
  //
  // Except when it is this screen's own write coming back. The URL is written
  // a beat after the range is chosen, and the reader may have moved a thumb
  // again by the time the router reports it; adopting it then would pull the
  // thumb back to where it was.
  const [urlRange, setUrlRange] = React.useState({ urlFrom, urlTo });
  const [writtenRange, setWrittenRange] = React.useState<{
    from: string | null;
    to: string | null;
  } | null>(null);
  if (urlRange.urlFrom !== urlFrom || urlRange.urlTo !== urlTo) {
    setUrlRange({ urlFrom, urlTo });
    const isOwnWrite =
      writtenRange !== null && writtenRange.from === urlFromParam && writtenRange.to === urlToParam;
    if (!isOwnWrite) {
      setWrittenRange(null);
      if (urlFrom !== null && urlTo !== null) {
        setTimeRange({ fromMs: urlFrom, toMs: urlTo });
        setShowTimeRangeSlider(true);
      } else {
        setTimeRange(null);
      }
    }
  }

  const handleTimeRangeDrag = React.useCallback((fromMs: number, toMs: number) => {
    setTimeRange({ fromMs, toMs });
  }, []);

  const handleTimeRangeCommit = React.useCallback(
    (rawFromMs: number | null, rawToMs: number | null) => {
      // Whole seconds are what the URL carries, and capture times have no
      // finer grain, so the committed range is exactly the one a reload or a
      // shared link restores — with the same photos in it.
      const snapped =
        rawFromMs !== null && rawToMs !== null ? snapRangeToSeconds(rawFromMs, rawToMs) : null;
      const range = snapped
        ? { fromMs: snapped.fromMs, toMs: Math.max(snapped.fromMs, snapped.toMs) }
        : null;
      setTimeRange(range);

      // Debounced URL update. Derive the base query from the live
      // window.location.search rather than router.query: MMap writes the
      // camera params (lat/lon/zoom) straight to history via replaceState,
      // which the Next router never sees, so router.query is stale and would
      // drop them on commit.
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
      urlSyncTimer.current = setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        // A bound on a day boundary keeps the short `YYYY-MM-DD` older links
        // use; one inside a day carries its time, or a one-day album could
        // never be narrowed — the URL would hand back the whole day.
        const from = range ? formatRangeParam(range.fromMs) : null;
        const to = range ? formatRangeParam(range.toMs, { endOfDay: true }) : null;
        if (from !== null && to !== null) {
          params.set("from", from);
          params.set("to", to);
        } else {
          params.delete("from");
          params.delete("to");
        }
        setWrittenRange({ from, to });
        replaceSearchParams(params);
      }, DEBOUNCE_URL_MS);
    },
    [replaceSearchParams],
  );

  // Clear any pending debounced URL write on unmount so it can't fire against
  // the next page's router after a fast navigation.
  React.useEffect(() => {
    return () => {
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
      if (queryUrlTimer.current) clearTimeout(queryUrlTimer.current);
    };
  }, []);

  // The compact metadata corpus is a separate static JSON resource. Loading
  // starts on first search interaction, so the initial map payload stays lean.
  const [directorEnabled, setDirectorEnabled] = React.useState(false);
  const [directorSequenceLength, setDirectorSequenceLength] = React.useState(0);
  const [mapSearchQuery, setMapSearchQuery] = React.useState("");
  // The search is part of the link (`q=`), beside the album, dates and camera.
  // A query arriving in the URL fills the field — unless it is this screen's
  // own write coming back, which by then may be a keystroke behind the field.
  const urlQuery = routeReady ? (getSearchParam("q") ?? "") : "";
  const [seenUrlQuery, setSeenUrlQuery] = React.useState("");
  const [writtenQuery, setWrittenQuery] = React.useState<string | null>(null);
  if (seenUrlQuery !== urlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== writtenQuery) {
      setWrittenQuery(null);
      setMapSearchQuery(urlQuery);
    }
  }
  // Once the reader has typed, the camera is theirs: neither a search nor
  // clearing one may move it.
  const [searchEdited, setSearchEdited] = React.useState(false);
  const handleSearchChange = (nextQuery: string) => {
    setMapSearchQuery(nextQuery);
    setSearchEdited(true);

    // Debounced, replace-style, and built from the live location for the same
    // reason as the date range: the camera params never reach the router.
    if (queryUrlTimer.current) clearTimeout(queryUrlTimer.current);
    queryUrlTimer.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const query = nextQuery.trim();
      if (query) {
        params.set("q", query);
      } else {
        params.delete("q");
      }
      setWrittenQuery(query);
      replaceSearchParams(params);
    }, DEBOUNCE_URL_MS);
  };
  // Bumped by the "Fit to results" control. Typing filters the markers in place
  // (auto-fit is off during a search); this lets the user reframe on demand.
  const [fitRequestId, setFitRequestId] = React.useState(0);
  const [mapSearchIndex, setMapSearchIndex] = React.useState<Map<string, string> | null>(null);
  const [mapSearchStatus, setMapSearchStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const mapSearchLoadRef = React.useRef<Promise<void> | null>(null);
  const loadMapSearchIndex = React.useCallback(() => {
    if (mapSearchIndex || mapSearchLoadRef.current) {
      return;
    }
    setMapSearchStatus("loading");
    const loading = fetchMapSearchIndex()
      .then((index) => {
        setMapSearchIndex(index);
        setMapSearchStatus("ready");
      })
      .catch((error) => {
        console.error("Failed to progressively load map search", error);
        setMapSearchStatus("error");
      })
      .finally(() => {
        mapSearchLoadRef.current = null;
      });
    mapSearchLoadRef.current = loading;
  }, [mapSearchIndex]);
  // Typed or arrived in a link, a query needs the index.
  const hasSearchQuery = Boolean(mapSearchQuery.trim());
  React.useEffect(() => {
    if (hasSearchQuery) {
      loadMapSearchIndex();
    }
  }, [hasSearchQuery, loadMapSearchIndex]);
  const deferredMapSearchQuery = React.useDeferredValue(mapSearchQuery);
  // The tour reads as "play these results": clearing the query back to the
  // full library removes the only control that can stop it, so stop it here
  // instead of leaving it to run over every photo unattended.
  const [tourQuery, setTourQuery] = React.useState(deferredMapSearchQuery);
  if (tourQuery !== deferredMapSearchQuery) {
    setTourQuery(deferredMapSearchQuery);
    if (!deferredMapSearchQuery.trim()) setDirectorEnabled(false);
  }
  const filteredPhotos = React.useMemo(
    () =>
      deferredMapSearchQuery.trim() && !mapSearchIndex
        ? albumFilteredPhotos
        : filterPhotosByQuery(
            albumFilteredPhotos,
            deferredMapSearchQuery,
            mapSearchIndex ?? undefined,
          ),
    [albumFilteredPhotos, deferredMapSearchQuery, mapSearchIndex],
  );
  const dateFilteredAlbumPhotos = React.useMemo(
    () =>
      timeRange
        ? albumFilteredPhotos.filter((photo) => isPhotoInTimeRange(photo, timeRange))
        : albumFilteredPhotos,
    [albumFilteredPhotos, timeRange],
  );
  const displayedPhotos = React.useMemo(
    () =>
      timeRange
        ? filteredPhotos.filter((photo) => isPhotoInTimeRange(photo, timeRange))
        : filteredPhotos,
    [filteredPhotos, timeRange],
  );
  // The count that sits beside the search field. Compact by design: it shares a
  // single nav row with the field, so it has to read at a glance and — more
  // importantly — never change width enough to move the field. The longer
  // sentence survives as a title for anyone who wants the detail.
  const trimmedQuery = deferredMapSearchQuery.trim();
  const searchCount =
    mapSearchStatus === "error"
      ? "Unavailable"
      : mapSearchStatus === "loading"
        ? "Loading…"
        : trimmedQuery && displayedPhotos.length === 0
          ? "No matches"
          : trimmedQuery
            ? `${displayedPhotos.length}/${dateFilteredAlbumPhotos.length}`
            : `${displayedPhotos.length} photos`;
  const searchCountTitle =
    mapSearchStatus === "error"
      ? "Search is unavailable"
      : trimmedQuery && displayedPhotos.length === 0
        ? timeRange && filteredPhotos.length > 0
          ? "No matching photos in these dates."
          : `No photos match “${trimmedQuery}”.`
        : trimmedQuery
          ? `${displayedPhotos.length} of ${dateFilteredAlbumPhotos.length} photos match`
          : `${formatMediaCountOf(displayedPhotos)} on the map`;
  const isPreviewableResultSet =
    Boolean(deferredMapSearchQuery.trim()) &&
    displayedPhotos.length > 0 &&
    displayedPhotos.length <= MAX_PREVIEWABLE_RESULTS;
  const routeEligiblePhotoCount = React.useMemo(
    () =>
      displayedPhotos.filter(
        (photo) => typeof photo.decLat === "number" && typeof photo.decLng === "number",
      ).length,
    [displayedPhotos],
  );
  const hasRoute = filterAlbum != null && routeEligiblePhotoCount >= 2;
  const routableAlbumCount = React.useMemo(() => {
    const byAlbum = new Map<string, number>();
    for (const photo of displayedPhotos) {
      if (typeof photo.decLat !== "number" || typeof photo.decLng !== "number") {
        continue;
      }

      byAlbum.set(photo.album, (byAlbum.get(photo.album) ?? 0) + 1);
    }

    return Array.from(byAlbum.values()).filter((count) => count >= 2).length;
  }, [displayedPhotos]);
  const defaultRouteMode = React.useMemo<RouteMode>(
    () => getDefaultRouteMode(displayedPhotos),
    [displayedPhotos],
  );
  const [showAllRoutes, setShowAllRoutes] = React.useState(false);
  if (showAllRoutes && routableAlbumCount === 0) {
    setShowAllRoutes(false);
  }

  // How much of the bottom edge the date panel actually occupies, measured
  // rather than assumed. `--range-slider-clearance` was a hardcoded 82px whose
  // own comment said "roughly", and both the distance scale and the recency
  // legend clear the panel by that number — so a panel that wrapped to two rows
  // on a narrow viewport would have been under-cleared by both at once. The
  // token stays as the value before the first measurement.
  const [panelHeight, setPanelHeight] = React.useState<number | null>(null);
  // A closed panel occupies nothing, and a reopened one is measured afresh.
  if (!showTimeRangeSlider && panelHeight !== null) {
    setPanelHeight(null);
  }
  React.useEffect(() => {
    if (!showTimeRangeSlider) {
      return;
    }

    const panel = document.getElementById("map-date-controls");
    if (!panel || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        // Clearance includes padding and border, not just the chart's content.
        setPanelHeight(entry.borderBoxSize?.[0]?.blockSize ?? panel.getBoundingClientRect().height);
      }
    });
    observer.observe(panel);
    // oxlint-disable-next-line react/set-state-in-effect -- a layout measurement can only be read from the DOM after commit
    setPanelHeight(panel.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [showTimeRangeSlider]);

  // A closed panel hides the thumbs but not their effect, so the control that
  // reopens it has to say a range is still narrowing the map.
  const hiddenRange = showTimeRangeSlider ? null : timeRange;
  const hiddenRangeFrom = hiddenRange ? formatDisplayDate(hiddenRange.fromMs) : null;
  const hiddenRangeTo = hiddenRange ? formatDisplayDate(hiddenRange.toMs) : null;
  const dateControlsToggle = (
    <button
      type="button"
      className={[
        buttonStyles.base,
        showTimeRangeSlider ? buttonStyles.active : "",
        hiddenRange ? styles.datesFiltered : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-expanded={showTimeRangeSlider}
      aria-controls="map-date-controls"
      {...(hiddenRange
        ? {
            "aria-description":
              hiddenRangeFrom === hiddenRangeTo
                ? `Filtered to ${hiddenRangeFrom}`
                : `Filtered to ${hiddenRangeFrom} – ${hiddenRangeTo}`,
          }
        : {})}
      onClick={() => {
        setShowTimeRangeSlider((current) => !current);
      }}
    >
      {showTimeRangeSlider ? "Hide date controls" : "Choose dates"}
    </button>
  );
  // Rendered twice, one copy shown at a time: beside the search field where
  // the row has room, and in the scrolling list on narrower screens, where
  // pinned they would crowd out the site's links or, on a phone, push the map
  // under another row of chrome.
  const mapControls = (
    <div className={styles.mapControls}>
      {!filterAlbum && routableAlbumCount > 0 ? (
        <button
          type="button"
          className={buttonStyles.base}
          aria-pressed={showAllRoutes}
          onClick={() => {
            setShowAllRoutes((current) => !current);
          }}
        >
          {showAllRoutes ? "Hide journeys" : `Show ${routableAlbumCount} journeys`}
        </button>
      ) : null}
      {dateControlsToggle}
    </div>
  );

  return (
    <div
      className={[styles.container, showTimeRangeSlider ? styles.containerWithSlider : ""]
        .filter(Boolean)
        .join(" ")}
      {...(panelHeight === null
        ? {}
        : {
            style: {
              "--range-slider-clearance": `${Math.round(panelHeight)}px`,
            } as React.CSSProperties,
          })}
    >
      <Seo
        title={formatPageTitle("Map")}
        description="Explore geotagged photos on a world map."
        pathname="/map"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd(
          {
            name: formatPageTitle("Map"),
            description: "Explore geotagged photos on a world map.",
            pathname: "/map",
          },
          siteOrigin,
        )}
      />
      <div className={styles.titleBar}>
        <GlobalNav
          currentPage="map"
          hasPadding={false}
          // Between the search field (the row's trailing control) and the site
          // theme: the two appearance choices sit together, as asked.
          themeAdjacentItem={<MapStyleToggle />}
          trailingItem={
            <div className={styles.trailing}>
              {/* Before the field, not after: "Show N journeys" counts the search
                  results, so its width changes as you type, and the group's right
                  edge is the fixed one — after the field it pushed the field
                  sideways on every keystroke. */}
              <div className={styles.mapControlsPinned}>{mapControls}</div>
              <div className={styles.mapSearch} role="search">
                <input
                  type="search"
                  className={styles.mapSearchInput}
                  value={mapSearchQuery}
                  onFocus={loadMapSearchIndex}
                  onChange={(event) => {
                    handleSearchChange(event.target.value);
                  }}
                  placeholder="Search photos…"
                  aria-label="Search photos on the map"
                  autoComplete="off"
                  spellCheck={false}
                  aria-busy={mapSearchStatus === "loading"}
                />
                {/* Beside the field, not below it, and a fixed width: the text
                    swings between "1444 photos", "935/1444" and "No matches",
                    and anything that let it size itself would shove the field
                    sideways on every keystroke. */}
                <span className={styles.mapSearchCount} title={searchCountTitle} role="status">
                  {searchCount}
                </span>
                {/* Hung below the count rather than laid out in the row, so a
                    Fit or Tour appearing cannot change the height of the nav
                    line the field sits on. */}
                <div className={styles.mapSearchActions}>
                  {mapSearchStatus === "error" ? (
                    <button
                      type="button"
                      className={styles.mapSearchAction}
                      onClick={loadMapSearchIndex}
                    >
                      Try again
                    </button>
                  ) : null}
                  {/* Reframe on demand: the search filters the markers in
                      place, so this is how the user asks the map to fly to the
                      matches. */}
                  {trimmedQuery && displayedPhotos.length > 0 ? (
                    <button
                      type="button"
                      className={styles.mapSearchAction}
                      aria-label="Fit the map to the results"
                      onClick={() => {
                        setFitRequestId((id) => id + 1);
                      }}
                    >
                      <span aria-hidden="true">⤢</span>
                      Fit
                    </button>
                  ) : null}
                  {/* The tour reads as "play these results", so it belongs
                      with the result count rather than floating over the map,
                      and only once there are results to tour. */}
                  {trimmedQuery && directorSequenceLength > 1 ? (
                    <button
                      type="button"
                      className={[
                        styles.mapSearchAction,
                        directorEnabled ? styles.mapSearchActionActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={directorEnabled}
                      onClick={() => {
                        setDirectorEnabled((current) => !current);
                      }}
                    >
                      <span aria-hidden="true">{directorEnabled ? "■" : "▶"}</span>
                      Tour
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          }
          extraItems={
            <>
              {filterAlbum ? (
                <li>
                  <div className={commonStyles.toast}>
                    Showing only photos from{" "}
                    <Link href={`/album/${filterAlbum}`}>
                      <i>{filterAlbum}</i>
                    </Link>
                  </div>
                </li>
              ) : null}
              {hasRoute ? (
                <li>
                  <div className={commonStyles.toast}>
                    Select a photo to trace its place in this {routeEligiblePhotoCount}-photo
                    journey.
                  </div>
                </li>
              ) : null}
              <li className={styles.mapControlsInList}>{mapControls}</li>
            </>
          }
        />
      </div>

      <MapWorldDeferred
        photos={filteredPhotos}
        // invariant: CSS module classes always resolve
        className={styles.map!}
        // Auto-fit only frames the initial view; a search filters in place
        // rather than flying the map to the matches, and clearing one leaves
        // the camera where the reader put it. The one search it does frame is
        // a query that arrived in a link with no camera of its own — and only
        // once the index can say what matched, so the map moves once.
        //
        // Gated on the route being readable, not merely on the camera params
        // being absent: until the renderer reports navigation ready they are
        // *always* absent, so a map that mounts in that window would frame every
        // photo and throw away the position a shared link asked for.
        fitToPhotos={
          routeReady && !hasCameraParams && !searchEdited && !(hasSearchQuery && !mapSearchIndex)
        }
        fitRequestId={fitRequestId}
        showRoute={!filterAlbum && showAllRoutes}
        routeMode={filterAlbum ? defaultRouteMode : "simplified"}
        routeDisplayMode={!filterAlbum && showAllRoutes ? "always" : "active-only"}
        timeRange={timeRange}
        previewMarkers={isPreviewableResultSet}
        directorEnabled={directorEnabled}
        onDirectorEnabledChange={setDirectorEnabled}
        onDirectorSequenceLengthChange={setDirectorSequenceLength}
      />

      {showTimeRangeSlider ? (
        <TimeRangeSlider
          id="map-date-controls"
          photos={albumFilteredPhotos}
          fromMs={timeRange?.fromMs ?? null}
          toMs={timeRange?.toMs ?? null}
          onDrag={handleTimeRangeDrag}
          onCommit={handleTimeRangeCommit}
        />
      ) : null}
    </div>
  );
};

export default MapScreen;
