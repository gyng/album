import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { GlobalNav } from "../../components/GlobalNav";
import type { MapWorldEntry, TimeRange } from "../../util/pageDataTypes";
import styles from "./MapScreen.module.css";
import commonStyles from "../../styles/common.module.css";
import { AppLink as Link, usePublicConfig, useUrlSearchParams } from "../../components/platform";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getDefaultRouteMode, RouteMode } from "../../components/mapRoute";
import { TimeRangeSlider } from "../../components/TimeRangeSlider";
import { parseRangeParam, formatRangeDate } from "../../util/timeRange";
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
    (routeReady && (hasSearchParam("from") || hasSearchParam("to")));

  // Album filtering (existing)
  const albumFilteredPhotos = React.useMemo(
    () => (filterAlbum ? photos.filter((p) => p.album === filterAlbum) : photos),
    [photos, filterAlbum],
  );

  // Time range state — live during drag, committed on pointer up
  const urlFrom = parseRangeParam(routeReady ? getSearchParam("from") : null);
  const urlTo = parseRangeParam(routeReady ? getSearchParam("to") : null, {
    endOfDay: true,
  });
  const [timeRange, setTimeRange] = React.useState<TimeRange | null>(
    urlFrom !== null && urlTo !== null ? { fromMs: urlFrom, toMs: urlTo } : null,
  );
  const [showTimeRangeSlider, setShowTimeRangeSlider] = React.useState(
    urlFrom !== null && urlTo !== null,
  );
  const urlSyncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from URL on navigation (back/forward)
  React.useEffect(() => {
    if (urlFrom !== null && urlTo !== null) {
      setTimeRange({ fromMs: urlFrom, toMs: urlTo });
      setShowTimeRangeSlider(true);
    } else {
      setTimeRange(null);
    }
  }, [urlFrom, urlTo]);

  const handleTimeRangeDrag = React.useCallback((fromMs: number, toMs: number) => {
    setTimeRange({ fromMs, toMs });
  }, []);

  const handleTimeRangeCommit = React.useCallback(
    (fromMs: number | null, toMs: number | null) => {
      if (fromMs !== null && toMs !== null) {
        setTimeRange({ fromMs, toMs });
      } else {
        setTimeRange(null);
      }

      // Debounced URL update. Derive the base query from the live
      // window.location.search rather than router.query: MMap writes the
      // camera params (lat/lon/zoom) straight to history via replaceState,
      // which the Next router never sees, so router.query is stale and would
      // drop them on commit.
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
      urlSyncTimer.current = setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        if (fromMs !== null && toMs !== null) {
          params.set("from", formatRangeDate(fromMs));
          params.set("to", formatRangeDate(toMs));
        } else {
          params.delete("from");
          params.delete("to");
        }
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
    };
  }, []);

  // The compact metadata corpus is a separate static JSON resource. Loading
  // starts on first search interaction, so the initial map payload stays lean.
  const [directorEnabled, setDirectorEnabled] = React.useState(false);
  const [directorSequenceLength, setDirectorSequenceLength] = React.useState(0);
  const [mapSearchQuery, setMapSearchQuery] = React.useState("");
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
  const deferredMapSearchQuery = React.useDeferredValue(mapSearchQuery);
  // The tour reads as "play these results": clearing the query back to the
  // full library removes the only control that can stop it, so stop it here
  // instead of leaving it to run over every photo unattended.
  React.useEffect(() => {
    if (!deferredMapSearchQuery.trim()) {
      setDirectorEnabled(false);
    }
  }, [deferredMapSearchQuery]);
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
  React.useEffect(() => {
    if (routableAlbumCount === 0) {
      setShowAllRoutes(false);
    }
  }, [routableAlbumCount]);

  return (
    <div
      className={[styles.container, showTimeRangeSlider ? styles.containerWithSlider : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Seo
        title="Map | Snapshots"
        description="Explore geotagged photos on a world map."
        pathname="/map"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd(
          {
            name: "Map | Snapshots",
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
              {!filterAlbum && routableAlbumCount > 0 ? (
                <li>
                  <div className={styles.mapControls}>
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

                    <button
                      type="button"
                      className={[buttonStyles.base, showTimeRangeSlider ? buttonStyles.active : ""]
                        .filter(Boolean)
                        .join(" ")}
                      aria-expanded={showTimeRangeSlider}
                      aria-controls="map-date-controls"
                      onClick={() => {
                        setShowTimeRangeSlider((current) => !current);
                      }}
                    >
                      {showTimeRangeSlider ? "Hide date controls" : "Choose dates"}
                    </button>
                  </div>
                </li>
              ) : null}
              {filterAlbum || routableAlbumCount === 0 ? (
                <li>
                  <button
                    type="button"
                    className={[buttonStyles.base, showTimeRangeSlider ? buttonStyles.active : ""]
                      .filter(Boolean)
                      .join(" ")}
                    aria-expanded={showTimeRangeSlider}
                    aria-controls="map-date-controls"
                    onClick={() => {
                      setShowTimeRangeSlider((current) => !current);
                    }}
                  >
                    {showTimeRangeSlider ? "Hide date controls" : "Choose dates"}
                  </button>
                </li>
              ) : null}
            </>
          }
        />
        <div className={styles.mapSearch} role="search">
          <input
            type="search"
            value={mapSearchQuery}
            onFocus={loadMapSearchIndex}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setMapSearchQuery(nextQuery);
              if (nextQuery.trim()) {
                loadMapSearchIndex();
              }
            }}
            placeholder="Search photos…"
            aria-label="Search photos on the map"
            autoComplete="off"
            spellCheck={false}
            aria-busy={mapSearchStatus === "loading"}
          />
          {/* A persistent status row below the input. Keeping it in its own row
              (rather than wrapping inline off the input) is what stops the count,
              the "N of M" text and the tour trigger reflowing the whole box —
              which grew from 273 to 362px wide and jumped 2→3 rows on every
              keystroke, teleporting the count from bottom-left to top-right. */}
          <div className={styles.mapSearchStatus}>
            {mapSearchStatus === "error" ? (
              <>
                <span role="status">Search unavailable</span>
                <button
                  type="button"
                  className={styles.mapSearchRetry}
                  onClick={loadMapSearchIndex}
                >
                  Try again
                </button>
              </>
            ) : (
              <span aria-live="polite">
                {mapSearchStatus === "loading"
                  ? "Loading search…"
                  : deferredMapSearchQuery.trim() && displayedPhotos.length === 0
                    ? timeRange && filteredPhotos.length > 0
                      ? "No matching photos in these dates."
                      : `No photos match “${deferredMapSearchQuery.trim()}”.`
                    : deferredMapSearchQuery.trim()
                      ? `${displayedPhotos.length} of ${dateFilteredAlbumPhotos.length} photos`
                      : `${displayedPhotos.length} photos`}
              </span>
            )}
            {/* Reframe on demand: the search filters the markers in place, so
                this is how the user asks the map to fly to the matches. */}
            {deferredMapSearchQuery.trim() && displayedPhotos.length > 0 ? (
              <button
                type="button"
                className={styles.mapSearchFit}
                aria-label="Fit the map to the results"
                onClick={() => {
                  setFitRequestId((id) => id + 1);
                }}
              >
                <span aria-hidden="true">⤢</span>
                Fit
              </button>
            ) : null}
            {/* The tour reads as "play these results", so it belongs with the
                result count rather than floating over the map, and only once
                there are results to tour. */}
            {deferredMapSearchQuery.trim() && directorSequenceLength > 1 ? (
              <button
                type="button"
                className={styles.mapSearchTour}
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

      <MapWorldDeferred
        photos={filteredPhotos}
        // invariant: CSS module classes always resolve
        className={styles.map!}
        // Auto-fit only frames the initial view; a search filters in place
        // rather than flying the map to the matches.
        //
        // Gated on the route being readable, not merely on the camera params
        // being absent: until the renderer reports navigation ready they are
        // *always* absent, so a map that mounts in that window would frame every
        // photo and throw away the position a shared link asked for.
        fitToPhotos={routeReady && !hasCameraParams && !deferredMapSearchQuery.trim()}
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
