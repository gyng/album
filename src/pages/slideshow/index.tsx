import { NextPage } from "next/types";
import React, { useEffect, useCallback } from "react";
import {
  useDatabase,
  useEmbeddingsDatabase,
} from "../../components/database/useDatabase";
import { PhotoBlock } from "../../services/types";
import {
  fetchSlideshowPhotos,
  fetchRandomPhoto,
  fetchSimilarResults,
  RandomPhotoRow,
} from "../../components/search/api";
import { ProgressBar } from "../../components/ProgressBar";
import styles from "./slideshow.module.css";
import commonStyles from "../../styles/common.module.css";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useLocalStorage } from "usehooks-ts";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getPhotoAltText } from "../../lib/alt";
import { navigateTo, reloadCurrentPage } from "../../util/navigate";
import { handleSlideshowKeyboardShortcut } from "../../util/slideshowKeyboard";
import {
  advanceQueued,
  avoidBoundaryRepeat,
  computePoolStats,
  createRandomQueueState,
  EMPTY_POOL_STATS,
  getSlideshowPhotoSrc,
  peekNextQueued,
  PoolStats,
  RandomQueueState,
  resetRandomQueue,
  shufflePhotos,
  weightedShufflePhotos,
} from "../../util/slideshowQueue";
import {
  decideRemixCompanionCount,
  pickRemixCompanions,
  RemixStrategy,
  rollRemixLayoutCount,
  rollRemixStrategy,
  timeAwareShufflePhotos,
} from "../../util/slideshowAmbient";
import { BUILD_VERSION } from "../../lib/buildVersion";
import { useWakeLock } from "../../components/useWakeLock";
import { useControlsAutoHide } from "../../components/useControlsAutoHide";
import { useSlideshowCadence } from "../../components/useSlideshowCadence";
import { useRemixGridReveal } from "../../components/useRemixGridReveal";
import {
  advanceHistory,
  canGoBack,
  currentEntry,
  hasForwardEntry,
  initialHistoryState,
  upcomingSeed,
} from "../../util/slideshowHistory";
import { SlideshowToolbar } from "../../components/slideshow/SlideshowToolbar";
import { SlideshowBottomBar } from "../../components/slideshow/SlideshowBottomBar";
import { decideBuildUpdate, decideDbUpdateAction } from "../../util/kioskRefresh";
import {
  decideRemixPlan,
  mapVectorRemixResult,
} from "../../util/slideshowRemix";
import {
  resolvePointerMove,
  resolvePointerUpAction,
} from "../../util/slideshowGesture";
import {
  applySlideshowUrlState,
  buildSlideshowPermalink,
  parseSlideshowSearchParams,
  SlideshowMode,
} from "../../util/slideshowUrl";

type PageProps = {};
// Stable empty companions array so the derived current-slide companions keep a
// constant identity across renders for a non-remix slide (memo/dep stability).
const EMPTY_COMPANIONS: RandomPhotoRow[] = [];
const VERSION_POLL_MS = 300000;
// Backstop hard-reload interval. Was 24h, which was killing the wake lock
// daily on iPad PWA installs (Safari requires a user gesture to re-acquire).
// 7 days is the "something is definitely broken if we got here" failsafe.
// The version-manifest poll handles real build updates without a reload.
const FALLBACK_RELOAD_MS = 7 * 86400000;
// How often to HEAD-check the search DB for changes. Cheap (a few hundred
// bytes per request), so 10 minutes is plenty responsive for a sideboard
// without being chatty.
const DB_POLL_MS = 600000;

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type VersionManifest = {
  buildVersion?: string;
  builtAt?: string;
  gitSha?: string | null;
};

// Touch and pen pointers behave the same for this page's gesture model:
// progress visuals, tap zones, click suppression. Mouse is handled separately.
const isTouchOrPen = (pointerType: string): boolean =>
  pointerType === "touch" || pointerType === "pen";

const SlideshowPage: NextPage<PageProps> = (props) => {
  return <Slideshow />;
};

// TODO: consider doing getStaticProps here to fetch all photos and pass them to the slideshow
// like in world map
const Slideshow: React.FC<{ disabled?: boolean }> = (props) => {
  const [database, progress] = useDatabase();
  const buildVersionRef = React.useRef<string>(BUILD_VERSION);
  // Tracks the search DB's Last-Modified / ETag so we can detect a
  // re-indexed DB without a full page reload. Initialised to null and seeded
  // by the first successful HEAD response so the *first* poll never triggers
  // a refresh (otherwise we'd reload on every cold start).
  const lastDbVersionRef = React.useRef<string | null>(null);
  // Mirror of the `filter` state used by the DB-update poll, which is
  // declared *above* the `filter` state — using a ref sidesteps the hoist
  // ordering without forcing a structural re-shuffle.
  const filterRef = React.useRef<string | undefined>(undefined);
  const initialPhotoPathRef = React.useRef<string | null>(null);
  const randomSimilarRequestedRef = React.useRef(false);
  const similarSeedPathRef = React.useRef<string | null>(null);
  const similarQueueRef = React.useRef<RandomPhotoRow[]>([]);
  const similarQueueIndexRef = React.useRef<number>(-1);
  const similarQueueLastPathRef = React.useRef<string | undefined>(undefined);

  // Check for a new build manifest we control and reload when one is detected.
  useEffect(() => {
    const checkForNewBuild = async () => {
      try {
        const response = await fetch("/version.json", {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const manifest = (await response.json()) as VersionManifest;
        if (decideBuildUpdate(manifest.buildVersion, buildVersionRef.current)) {
          reloadCurrentPage();
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewBuild();
      }
    };
    const handleOnline = () => {
      void checkForNewBuild();
    };

    checkForNewBuild();
    const id = setInterval(() => {
      if (navigator.onLine) {
        void checkForNewBuild();
      }
    }, VERSION_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Fallback hard reload for long-running kiosk sessions. Guarded by wake
  // lock state: if the screen is actively kept awake we DON'T reload,
  // because tearing down the document releases the wake lock and Safari
  // PWAs require a fresh user gesture to re-acquire — which means a dark
  // sideboard until someone touches the screen. The version-manifest poll
  // above handles real build updates; this interval is purely a "something
  // is broken if we got here" safety net.
  useEffect(() => {
    const id = setInterval(() => {
      if (wakeLockRef.current) {
        return;
      }
      reloadCurrentPage();
    }, FALLBACK_RELOAD_MS);
    return () => clearInterval(id);
    // wakeLockRef (from useWakeLock, declared below) is a stable ref read
    // lazily inside the interval — not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodically HEAD-poll the search DB to notice when it has been
  // re-indexed without a full page rebuild (e.g. the user updates the photo
  // pool between deploys). On change, refresh the photo pool in place if
  // the wake lock is held; otherwise reload while it's cheap to do so.
  useEffect(() => {
    if (!database) {
      return;
    }

    const checkForDbUpdates = async () => {
      try {
        const response = await fetch("/search.sqlite", {
          method: "HEAD",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const version =
          response.headers.get("etag") ??
          response.headers.get("last-modified");
        if (!version) {
          return;
        }

        const action = decideDbUpdateAction({
          observedVersion: version,
          lastVersion: lastDbVersionRef.current,
          wakeLockHeld: !!wakeLockRef.current,
        });

        if (action === "none") {
          return;
        }

        // Record the observed version for seed/refresh/reload alike. The
        // "seed" case (first observation) stops here so a fresh page load
        // doesn't mistake "never seen this header before" for an update.
        lastDbVersionRef.current = version;
        if (action === "seed") {
          return;
        }

        if (action === "refresh-in-place") {
          // Active kiosk session — refresh the photo pool in place so we
          // never tear down the document and lose the wake lock. The next
          // queue refill will pick up the new pool.
          const photos = await fetchSlideshowPhotos({
            database,
            filter: filterRef.current,
          });
          if (photos.length > 0) {
            randomPhotoPoolRef.current = photos;
            // In-place refresh of a near-identical pool during a live kiosk
            // session: reset the queue but PRESERVE lastPath so the next
            // refill still avoids repeating the currently-displayed photo
            // (a full pool swap — see the main fetch — uses a fresh state).
            resetRandomQueue(randomQueueStateRef.current);
            recentPhotoPathsRef.current = [];
            setPoolStats(computePoolStats(photos));
          }
          return;
        }

        // action === "reload": no wake lock held — a full reload is cheap and
        // gives us a clean re-init of sql.js-httpvfs cached pages too.
        reloadCurrentPage();
      } catch (error) {
        console.error("DB update check failed", error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForDbUpdates();
      }
    };

    void checkForDbUpdates();
    const id = setInterval(() => {
      if (navigator.onLine) {
        void checkForDbUpdates();
      }
    }, DB_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // filter is read via filterRef so it doesn't need to be a dep — that
    // also keeps this effect from re-running on every filter change.
    // wakeLockRef (from useWakeLock, declared below) is a stable ref read
    // lazily inside the poll, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database]);

  // Navigation history is the single source of truth for what's on screen.
  // The current slide is history[index]; currentPhotoPath and the remix
  // companions/strategy/score are DERIVED from it below, so there is no
  // parallel current-slide state to keep in sync (see util/slideshowHistory).
  const [historyState, dispatchHistory] = React.useReducer(
    advanceHistory,
    undefined,
    initialHistoryState,
  );
  // A mirror of historyState for synchronous reads inside callbacks/async
  // closures (kept current each render). Dispatches drive re-render; reads use
  // the ref so the imperative advance logic always sees the latest state.
  const historyStateRef = React.useRef(historyState);
  historyStateRef.current = historyState;

  const currentSlide = currentEntry(historyState);
  const currentPhotoPath = currentSlide?.seed ?? null;
  const remixCompanions = currentSlide?.companions ?? EMPTY_COMPANIONS;
  const remixStrategy = currentSlide?.strategy ?? null;
  const remixVectorScore = currentSlide?.vectorScore ?? null;
  const canGoPrevious = canGoBack(historyState);
  const historyPosition = {
    index: historyState.index,
    total: historyState.history.length,
  };

  const randomPhotoPoolRef = React.useRef<RandomPhotoRow[]>([]);
  // Single shared queue state for random/weighted modes. Both the forward
  // advance and the preload peek consult it, so the buffered photo always
  // matches the one the next advance shows (see util/slideshowQueue).
  const randomQueueStateRef = React.useRef<RandomQueueState>(
    createRandomQueueState(),
  );
  const [slideshowError, setSlideshowError] = React.useState<string | null>(
    null,
  );
  const [copiedPhotoLink, setCopiedPhotoLink] = React.useState(false);

  const [timeDelay, setTimeDelay] = useLocalStorage(
    "slideshow-timedelay",
    900000,
  );
  const timeDelayRef = React.useRef(timeDelay);
  const [showClock, setShowClock] = useLocalStorage(
    "slideshow-showclock",
    false,
  );
  const [showMap, setShowMap] = useLocalStorage(
    "slideshow-showmap",
    false,
  );
  const [showDetails, setShowDetails] = useLocalStorage(
    "slideshow-showdetails",
    false,
  );
  const [showCover, setShowCover] = useLocalStorage(
    "slideshow-showcover",
    false,
  );
  const [detailsAlignment, setDetailsAlignment] = useLocalStorage(
    "slideshow-details-alignment",
    "center" as "left" | "center" | "right",
  );
  const [timeAware, setTimeAware] = useLocalStorage(
    "slideshow-time-aware",
    false,
  );
  const [remixEnabled, setRemixEnabled] = useLocalStorage(
    "slideshow-remix",
    true,
  );
  const [poolStats, setPoolStats] =
    React.useState<PoolStats>(EMPTY_POOL_STATS);
  // When set, the next forward-advance ignores the dice roll and forces a
  // remix. Used by the dedicated "Remix now" action button so users can
  // trigger a remix on demand instead of waiting for the 3% dice.
  const forceRemixRef = React.useRef(false);
  // Kiosk-extreme timing cadences (3h, 12h, 24h) are kept available but hidden
  // by default behind a "More" disclosure. Persisted so power users don't have
  // to re-expand them every session.
  const [showLongTimings, setShowLongTimings] = useLocalStorage(
    "slideshow-show-long-timings",
    false,
  );
  // 5% per slide ≈ one remix every 20 photos. At a 15-minute cadence that's
  // a remix every ~5 hours — visible enough to register as a feature, rare
  // enough that it still feels like a surprise rather than a pattern.
  const REMIX_PROBABILITY = 0.05;


  const [imageLoaded, setImageLoaded] = React.useState<boolean>(false);
  const [previousPhotoSrc, setPreviousPhotoSrc] = React.useState<string | null>(
    null,
  );

  const [filter, setFilter] = React.useState<string | undefined>(undefined);
  // Mirror the filter state into the ref consumed by the DB-update poll
  // (declared earlier in the component than `filter` is).
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  const recentPhotoPathsRef = React.useRef<string[]>([]);
  const [shuffleHistorySize, setShuffleHistorySize] = useLocalStorage(
    "slideshow-shuffle-history-size",
    100,
  );
  const [slideshowMode, setSlideshowMode] = useLocalStorage(
    "slideshow-mode",
    "weighted" as SlideshowMode,
  );
  // When true, every new "next change at" snaps to the next aligned wall-clock
  // boundary (e.g. every :00/:15/:30/:45 for a 15-minute cadence), so the
  // slideshow stays in sync with the clock across days. Default on.
  const [alignCadence, setAlignCadence] = useLocalStorage(
    "slideshow-align-cadence",
    true,
  );
  const [hasParsedInitialUrl, setHasParsedInitialUrl] = React.useState(false);
  // Controls visibility lifecycle (coarse-pointer detection, rAF auto-hide
  // countdown, desktop show/hide + post-Hide suppression) lives in a hook;
  // destructured to the same local names the rest of this component uses.
  const {
    controlsVisible,
    setControlsVisible,
    controlsHideProgress,
    isCoarsePointer,
    setIsPointerOverToolbar,
    extendControlsHideDeadline,
    showControlsForDesktop,
    hideDesktopControls,
    dismissControls,
  } = useControlsAutoHide();
  const [isFullscreenSupported, setIsFullscreenSupported] =
    React.useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = React.useState(false);
  // Screen wake-lock lifecycle (acquire on load/resume, release on
  // unmount/disable) lives in a dedicated hook. Destructured to the same local
  // names the rest of this component already used, so consumers — the kiosk
  // DB-update poll, the fallback reload, the touch handlers and the toolbar
  // button — are unchanged.
  const {
    ref: wakeLockRef,
    isSupported: isWakeLockSupported,
    isActive: isWakeLockActive,
    acquire: tryAcquireWakeLock,
  } = useWakeLock(!!props.disabled);
  const [touchGestureHint, setTouchGestureHint] = React.useState<
    "next" | "previous" | "controls" | "reload" | "remix" | null
  >(null);
  const [touchPullProgress, setTouchPullProgress] = React.useState(0);
  const [touchSwipeProgress, setTouchSwipeProgress] = React.useState(0);
  const [touchPointerActive, setTouchPointerActive] = React.useState(false);
  const [touchArmed, setTouchArmed] = React.useState(false);
  // The chevron handle leads the pull; the toolbar/edge peek only enters in the last 35%
  // so the two indicators don't compete. Below 0.65 only the chevron is visible.
  const remapPeek = (progress: number) =>
    Math.max(0, (progress - 0.65) / 0.35);
  const touchToolbarShowPreviewProgress =
    !controlsVisible &&
    (touchGestureHint === "controls" || touchGestureHint === "reload")
      ? remapPeek(touchPullProgress)
      : 0;
  const touchToolbarHidePreviewProgress =
    controlsVisible && touchGestureHint === "remix"
      ? remapPeek(touchPullProgress)
      : 0;
  // Loaded for Similar mode and also whenever remixes are on, so vector
  // strategies (similar / juxtapose) can fire on the first roll. Loading
  // lazily after the first vector roll meant the first ~37% of remixes
  // silently fell through to the next-priority sync strategy (same-album),
  // which dominated the badge in practice.
  const [embeddingsDatabase, embeddingsProgress] = useEmbeddingsDatabase(
    slideshowMode === "similar" || remixEnabled,
  );
  const pointerGestureRef = React.useRef<{
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    controlsWereVisible: boolean;
    // Set on the first move event that crosses the relevant hint threshold;
    // held for the lifetime of the gesture so dragging back does not flip the action.
    committedHorizontalDirection?: "next" | "previous";
    committedVerticalDirection?: "down" | "up";
    // True once the gesture has crossed the commit threshold on its primary axis,
    // so we can fire the haptic exactly once per gesture.
    hapticFired?: boolean;
  } | null>(null);
  const suppressImageClickRef = React.useRef(false);
  const activePhotoSrcRef = React.useRef<string | null>(null);
  const [bufferedPhotoSrc, setBufferedPhotoSrc] = React.useState<string | null>(
    null,
  );

  const updateSlideshowUrl = useCallback(
    (mode: SlideshowMode, delayMs = timeDelayRef.current) => {
      window.history.replaceState(
        window.history.state,
        "",
        applySlideshowUrlState(window.location.toString(), { mode, delayMs }),
      );
    },
    [],
  );

  const setSlideshowModeAndUrl = useCallback(
    (mode: SlideshowMode) => {
      setSlideshowMode(mode);
      updateSlideshowUrl(mode);
    },
    [setSlideshowMode, updateSlideshowUrl],
  );

  const setTimeDelayAndUrl = useCallback(
    (delay: number) => {
      timeDelayRef.current = delay;
      setTimeDelay(delay);
      updateSlideshowUrl(slideshowMode, delay);
    },
    [setTimeDelay, slideshowMode, updateSlideshowUrl],
  );

  useEffect(() => {
    timeDelayRef.current = timeDelay;
  }, [timeDelay]);

  /**
   * URL Search Parameters for Slideshow Configuration
   *
   * Boolean parameters (accept: 1, true, yes, on):
   *   - clock=1        Show clock display
   *   - details=1      Show photo details (location, date)
   *   - map=1          Show map when EXIF GPS coordinates are available
   *   - cover=1        Use cover mode (vs contain)
   *
   * Other parameters:
   *   - mode=random|weighted|similar Slideshow playback mode
   *   - photo=<photo-path>          Start on a specific photo; the live URL drops this after load
   *   - seed=<photo-path>           Similar mode only: backward-compatible alias for the starting photo
   *   - align=left|center|right  Set details alignment
   *   - delay=<seconds>          Set slide duration in seconds (e.g., 60 = 60 seconds)
   *   - shuffle=<number>         Similar mode only: avoid repeating the last N photos
   *   - filter=<album-name>      Filter to specific album
   *
   * Examples:
   *   /?clock=1&details=1&map=1&delay=60              All features with 60-second slides
   *   /?clock=1&delay=30                              Just clock with 30-second intervals
   *   /?details=1&align=left                          Details aligned left (no clock)
   *   /?filter=japan&delay=45                         Japan album, 45-second slides in a shuffled pass
   *   /?mode=weighted&filter=japan                    Recent-biased weighted shuffle for one album
   *   /?mode=similar&filter=japan&shuffle=50          Similar mode, avoid the last 50 photos
   */
  // Parse URL search params to configure slideshow. The pure parser lives in
  // util/slideshowUrl; this effect just fans the parsed values out to the
  // React setters/refs (applying each only when present — null means absent).
  useEffect(() => {
    const parsed = parseSlideshowSearchParams(
      window.location.search,
      slideshowMode,
    );

    if (parsed.filter) {
      setFilter(parsed.filter);
    }

    initialPhotoPathRef.current = parsed.initialPhotoPath;
    randomSimilarRequestedRef.current = parsed.randomSimilar;
    if (parsed.mode) {
      setSlideshowMode(parsed.mode);
    }

    if (parsed.clock !== null) {
      setShowClock(parsed.clock);
    }
    if (parsed.details !== null) {
      setShowDetails(parsed.details);
    }
    if (parsed.map !== null) {
      setShowMap(parsed.map);
    }
    if (parsed.cover !== null) {
      setShowCover(parsed.cover);
    }
    if (parsed.timeAware !== null) {
      setTimeAware(parsed.timeAware);
    }
    if (parsed.remix !== null) {
      setRemixEnabled(parsed.remix);
    }
    if (parsed.alignCadence !== null) {
      setAlignCadence(parsed.alignCadence);
    }
    if (parsed.alignment) {
      setDetailsAlignment(parsed.alignment);
    }
    if (parsed.delayMs !== null) {
      timeDelayRef.current = parsed.delayMs;
      setTimeDelay(parsed.delayMs);
    }
    if (parsed.shuffleHistory !== null) {
      setShuffleHistorySize(parsed.shuffleHistory);
    }

    setHasParsedInitialUrl(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slideshowMode is only read as a fallback on mount
  }, [
    setShowClock,
    setShowDetails,
    setShowMap,
    setShowCover,
    setDetailsAlignment,
    setTimeDelay,
    setShuffleHistorySize,
    setSlideshowMode,
    setTimeAware,
    setRemixEnabled,
    setAlignCadence,
  ]);

  // The advance cadence (nextChangeAt timer, pause/resume, countdown + clock
  // tick, alignment) lives in a hook. The timer fires goNext, which is defined
  // below and changes identity — so the hook receives a STABLE wrapper over a
  // ref to the latest goNext (assigned right after goNext is created).
  const goNextRef = React.useRef<() => void>(() => {});
  const advanceFromCadence = useCallback(() => goNextRef.current(), []);
  const {
    secondsLeft,
    time,
    isPaused,
    togglePaused,
    scheduleNextChange,
    alignNextChangeToCadence,
  } = useSlideshowCadence({
    timeDelay,
    alignCadence,
    controlsVisible,
    showClock,
    hasCurrentPhoto: currentPhotoPath !== null,
    onAdvance: advanceFromCadence,
  });

  const commitNextPhoto = useCallback(
    (
      candidatePhoto: RandomPhotoRow,
      opts?: { trackRecent?: boolean; allowRemix?: boolean },
    ) => {
      if (opts?.trackRecent) {
        recentPhotoPathsRef.current = [
          candidatePhoto.path,
          ...recentPhotoPathsRef.current,
        ].slice(0, shuffleHistorySize);
      }

      // Remix decision: only on forward advance (allowRemix), never on history
      // navigation or initial seed. Compute companions+strategy BEFORE pushing
      // the history entry so Previous/Next can replay the full layout. The pure
      // decision lives in util/slideshowRemix; this shell owns the one-shot
      // forced flag, the async vector fetch and all setState/history patching.
      let companions: RandomPhotoRow[] = [];
      let strategy: RemixStrategy | null = null;

      // Consume the one-shot forced flag here (decideRemixPlan stays pure and
      // takes `forced` as a value) — same condition/timing as before: a
      // forward advance that will consider a remix.
      const forced = forceRemixRef.current;
      if (opts?.allowRemix && forced) {
        forceRemixRef.current = false;
      }

      const plan = decideRemixPlan({
        allowRemix: !!opts?.allowRemix,
        forced,
        remixEnabled,
        vectorReady: !!(database && embeddingsDatabase),
        probability: REMIX_PROBABILITY,
        rollLayoutCount: rollRemixLayoutCount,
        decideCount: decideRemixCompanionCount,
        rollStrategy: rollRemixStrategy,
      });

      if (plan.kind === "vector") {
        // Async vector path. The history entry starts with no companions and
        // the chosen strategy; the fetch resolves later and patches both the
        // live state and the recorded history entry.
        strategy = plan.strategy;
        const seedPath = candidatePhoto.path;
        const desiredCount = plan.count;
        const isAntiSimilar = plan.isAntiSimilar;

        void (async () => {
          // plan.kind === "vector" already implies both DBs are present
          // (decideRemixPlan only returns vector when vectorReady); this guard
          // also narrows the captured consts to non-null for TS.
          if (!database || !embeddingsDatabase) return;
          try {
            const result = await fetchSimilarResults({
              database,
              embeddingsDatabase,
              path: seedPath,
              similarityOrder: isAntiSimilar ? "least" : "most",
              page: 1,
              pageSize: desiredCount * 4,
            });
            // Stale guard: if the user has advanced past this slide while we
            // were fetching, drop the result on the floor.
            if (currentEntry(historyStateRef.current)?.seed.path !== seedPath)
              return;

            const mapped = mapVectorRemixResult({
              resultData: result.data,
              pool: randomPhotoPoolRef.current,
              desiredCount,
            });
            if (mapped.companions.length === 0) return;

            // Patch the matching history entry; the live current slide
            // re-derives from it, so Previous/Next replays the same companions
            // and score with no separate live state to keep in sync.
            dispatchHistory({
              type: "patchEntry",
              seedPath,
              companions: mapped.companions,
              vectorScore: mapped.topSimilarity,
            });
          } catch (err) {
            console.error("Vector remix fetch failed", err);
          }
        })();
      } else if (plan.kind === "sync") {
        // Sync path. If a vector strategy was rolled but embeddings aren't
        // ready, decideRemixPlan already routed here; pickRemixCompanions
        // walks to the best available sync strategy so the slide never stalls.
        const pick = pickRemixCompanions(
          candidatePhoto,
          randomPhotoPoolRef.current,
          plan.count,
          Math.random,
          plan.strategy,
        );
        if (pick.companions.length > 0) {
          companions = pick.companions;
          strategy = pick.strategy;
        }
      }

      // The reducer truncates forward history, appends the new slide, and
      // points the cursor at it. The current slide (seed + companions +
      // strategy + score) is derived from this entry — no parallel state.
      dispatchHistory({
        type: "commit",
        entry: { seed: candidatePhoto, companions, strategy },
      });
      setSlideshowError(null);
      scheduleNextChange();
    },
    [
      database,
      embeddingsDatabase,
      remixEnabled,
      scheduleNextChange,
      shuffleHistorySize,
    ],
  );

  const showHistoryPhoto = useCallback(
    (index: number): RandomPhotoRow | null => {
      const entry = historyStateRef.current.history[index] ?? null;
      if (!entry) {
        return null;
      }

      // Just move the cursor — the current slide (seed + the original remix
      // layout) re-derives from history[index], so Previous/Next replays
      // the side-by-side faithfully.
      dispatchHistory({ type: "goTo", index });
      setSlideshowError(null);
      scheduleNextChange();
      return entry.seed;
    },
    [scheduleNextChange],
  );

  // When remix is toggled off, collapse the current slide to a single photo.
  useEffect(() => {
    if (!remixEnabled) {
      dispatchHistory({ type: "clearCurrentRemix" });
    }
  }, [remixEnabled]);

  // When time-aware is toggled, force a queue refill on the next advance so
  // the new bias takes effect immediately rather than after the current
  // pre-shuffled queue drains. lastPath is preserved so the rebuilt queue
  // still avoids an immediate repeat.
  useEffect(() => {
    resetRandomQueue(randomQueueStateRef.current);
  }, [timeAware]);

  // Pure builder for the next random/weighted queue. No ref mutation — the
  // queue state machine (peekNextQueued / advanceQueued) owns storage, so the
  // preload peek and the forward advance share the same built queue.
  const buildRandomQueue = useCallback(
    (pool: RandomPhotoRow[], lastPath?: string): RandomPhotoRow[] => {
      if (timeAware) {
        // Time-aware bias overrides the per-mode bias: photos taken near the
        // current hour-of-day and month-of-year are weighted higher.
        return avoidBoundaryRepeat(timeAwareShufflePhotos(pool), lastPath);
      }
      if (slideshowMode === "weighted") {
        return weightedShufflePhotos(pool, lastPath);
      }
      return shufflePhotos(pool, lastPath);
    },
    [slideshowMode, timeAware],
  );

  const resetSimilarQueue = useCallback(() => {
    similarSeedPathRef.current = null;
    similarQueueRef.current = [];
    similarQueueIndexRef.current = -1;
  }, []);

  const advanceRandomPhoto = useCallback(
    (opts?: { trackRecent?: boolean }): RandomPhotoRow | null => {
      if (randomPhotoPoolRef.current.length === 0) {
        setSlideshowError("No photos available");
        return null;
      }

      const nextPhoto = advanceQueued(
        randomQueueStateRef.current,
        randomPhotoPoolRef.current,
        buildRandomQueue,
      );
      if (!nextPhoto) {
        setSlideshowError("No photos available");
        return null;
      }

      commitNextPhoto(nextPhoto, { ...opts, allowRemix: true });
      return nextPhoto;
    },
    [buildRandomQueue, commitNextPhoto],
  );

  useEffect(() => {
    if (!hasParsedInitialUrl) {
      return;
    }

    updateSlideshowUrl(slideshowMode);
  }, [
    currentPhotoPath?.path,
    hasParsedInitialUrl,
    slideshowMode,
    updateSlideshowUrl,
  ]);

  useEffect(() => {
    if (!database) {
      return;
    }

    let cancelled = false;

    fetchSlideshowPhotos({ database, filter })
      .then(async (photos) => {
        if (cancelled) {
          return;
        }

        // Whether a slide was on screen before this (re)load — used below to
        // decide whether to advance to a first photo (mirrors the original
        // currentPhotoPathRef !== null check, captured before the reset).
        const hadCurrentPhoto = currentEntry(historyStateRef.current) !== null;

        randomPhotoPoolRef.current = photos;
        randomQueueStateRef.current = createRandomQueueState();
        recentPhotoPathsRef.current = [];
        dispatchHistory({ type: "reset" });
        setPoolStats(computePoolStats(photos));
        resetSimilarQueue();

        if (photos.length === 0) {
          updateSlideshowUrl(slideshowMode);
          setSlideshowError("No photos available");
          return;
        }

        setSlideshowError(null);

        if (
          slideshowMode === "similar" &&
          randomSimilarRequestedRef.current &&
          !initialPhotoPathRef.current
        ) {
          const [randomPhoto] = await fetchRandomPhoto({
            database,
            filter,
          });

          if (cancelled) {
            return;
          }

          randomSimilarRequestedRef.current = false;
          initialPhotoPathRef.current = randomPhoto?.path ?? null;
        }

        if (initialPhotoPathRef.current) {
          const seededPhoto =
            photos.find(
              (photo) => photo.path === initialPhotoPathRef.current,
            ) ?? null;

          initialPhotoPathRef.current = null;

          if (seededPhoto) {
            commitNextPhoto(seededPhoto, {
              trackRecent: slideshowMode === "similar",
            });
            return;
          }
        }

        if (
          slideshowMode === "random" ||
          slideshowMode === "weighted" ||
          !hadCurrentPhoto
        ) {
          advanceRandomPhoto({ trackRecent: slideshowMode === "similar" });
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          updateSlideshowUrl(slideshowMode);
          setSlideshowError("No photos available");
        }
      });

    return () => {
      cancelled = true;
    };
    // This effect must fire ONLY when the photo pool can change: on the
    // database becoming ready and on a filter change. It is deliberately NOT
    // keyed on slideshowMode / timeDelay / the advance callbacks — the pool is
    // mode-independent, and re-running on a mode toggle reset history and (via
    // the derived current slide) blanked the photo. A mode change is handled by
    // the mode-switch effect below. The callbacks it invokes are current at
    // fire time because the effect only fires on mount/database/filter, where
    // they reflect the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, filter]);

  const advanceSimilarPhoto =
    useCallback(async (): Promise<RandomPhotoRow | null> => {
      if (!database) {
        return null;
      }

      // Embeddings not ready yet (still loading, or failed to load): keep the
      // slideshow moving with a random advance rather than freezing on a
      // no-op. The next advance retries the similar trail once they arrive.
      if (!embeddingsDatabase) {
        return advanceRandomPhoto({ trackRecent: true });
      }

      const activePhoto = currentEntry(historyStateRef.current)?.seed ?? null;
      if (!activePhoto?.path) {
        return advanceRandomPhoto({ trackRecent: true });
      }

      const refillSimilarQueue = async (seedPath: string) => {
        const result = await fetchSimilarResults({
          database,
          embeddingsDatabase,
          path: seedPath,
          page: 0,
          pageSize: Math.max(shuffleHistorySize, 100),
        });
        const filteredResults = result.data
          .filter((candidate) => {
            const matchesAlbumFilter = filter
              ? candidate.path.startsWith(`../albums/${filter}/`)
              : true;
            const isRecent = recentPhotoPathsRef.current.includes(
              candidate.path,
            );
            return matchesAlbumFilter && !isRecent;
          })
          .map((candidate) => ({
            path: candidate.path,
            exif: candidate.exif,
            geocode: candidate.geocode,
          }));

        const nextQueue = shufflePhotos(
          filteredResults,
          similarQueueLastPathRef.current,
        );

        similarSeedPathRef.current = seedPath;
        similarQueueRef.current = nextQueue;
        similarQueueIndexRef.current = -1;
        return nextQueue;
      };

      let queue = similarQueueRef.current;
      let nextIndex = similarQueueIndexRef.current + 1;

      if (
        similarSeedPathRef.current !== activePhoto.path ||
        nextIndex >= queue.length
      ) {
        queue = await refillSimilarQueue(activePhoto.path);
        nextIndex = 0;
      }

      const nextPhoto = queue[nextIndex] ?? null;
      if (!nextPhoto) {
        resetSimilarQueue();
        return advanceRandomPhoto({ trackRecent: true });
      }

      similarQueueIndexRef.current = nextIndex;
      similarQueueLastPathRef.current = nextPhoto.path;
      commitNextPhoto(nextPhoto, { trackRecent: true, allowRemix: true });
      return nextPhoto;
    }, [
      advanceRandomPhoto,
      commitNextPhoto,
      database,
      embeddingsDatabase,
      filter,
      resetSimilarQueue,
      shuffleHistorySize,
    ]);

  const goNext = useCallback(() => {
    if (!database) {
      return;
    }

    // A pending forced remix ("Remix now" / drag-up) must produce a brand-new
    // remixed slide. Skip replaying recorded forward history in that case and
    // fall through to a real advance, which truncates forward history and
    // honours the forceRemix flag. Without this, pressing "Remix now" while
    // back in history silently stepped forward with no remix and left the
    // flag armed to fire on a later, unexpected advance.
    if (
      !forceRemixRef.current &&
      hasForwardEntry(historyStateRef.current)
    ) {
      showHistoryPhoto(historyStateRef.current.index + 1);
      return;
    }

    if (slideshowMode === "random" || slideshowMode === "weighted") {
      advanceRandomPhoto();
      return;
    }

    const activePhoto = currentEntry(historyStateRef.current)?.seed ?? null;

    // Similar mode: advanceSimilarPhoto falls back to a random advance when the
    // embeddings DB isn't ready, so the show never freezes waiting on it.
    if (slideshowMode === "similar" && activePhoto?.path) {
      advanceSimilarPhoto().catch((err) => {
        console.error(err);
        advanceRandomPhoto({ trackRecent: true });
      });
      return;
    }

    advanceRandomPhoto({ trackRecent: true });
  }, [
    advanceRandomPhoto,
    advanceSimilarPhoto,
    database,
    showHistoryPhoto,
    slideshowMode,
  ]);

  const goPrevious = useCallback(() => {
    if (!canGoBack(historyStateRef.current)) {
      return;
    }

    showHistoryPhoto(historyStateRef.current.index - 1);
  }, [showHistoryPhoto]);

  const getUpcomingPhoto = useCallback((): RandomPhotoRow | null => {
    if (hasForwardEntry(historyStateRef.current)) {
      return upcomingSeed(historyStateRef.current);
    }

    if (slideshowMode === "random" || slideshowMode === "weighted") {
      // Peek through the SAME queue state the advance will consume — building
      // and storing the next queue here if we're at a boundary — so the
      // preloaded photo is exactly the one the next advance shows.
      return peekNextQueued(
        randomQueueStateRef.current,
        randomPhotoPoolRef.current,
        buildRandomQueue,
      );
    }

    if (
      slideshowMode === "similar" &&
      similarSeedPathRef.current ===
        currentEntry(historyStateRef.current)?.seed.path
    ) {
      const nextIndex = similarQueueIndexRef.current + 1;
      return similarQueueRef.current[nextIndex] ?? null;
    }

    return null;
  }, [buildRandomQueue, slideshowMode]);

  useEffect(() => {
    if (slideshowMode === "similar") {
      resetRandomQueue(randomQueueStateRef.current);

      // Switching into similar mode resets history to just the current seed —
      // discard any remix layout so the new mode starts from a clean single
      // photo.
      const seed = currentEntry(historyStateRef.current)?.seed;
      if (seed) {
        dispatchHistory({ type: "replaceSingle", seed });
      }
      return;
    }

    resetSimilarQueue();
    resetRandomQueue(randomQueueStateRef.current);
  }, [resetSimilarQueue, slideshowMode]);

  const playbackSubtitle =
    slideshowMode === "similar"
      ? "🧭 Similar trail"
      : slideshowMode === "weighted"
        ? "🕒 Recent-weighted shuffle"
        : "🔀 Shuffle pass";
  const playbackContextLabel =
    slideshowMode === "similar"
      ? "🧭 similar trail"
      : slideshowMode === "weighted"
        ? "🕒 weighted shuffle"
        : "🔀 shuffle pass";

  const cycleAlignment = () => {
    const next =
      detailsAlignment === "left"
        ? "center"
        : detailsAlignment === "center"
          ? "right"
          : "left";
    setDetailsAlignment(next);
  };

  // Keep the cadence timer's advance pointing at the latest goNext (the hook
  // calls it through advanceFromCadence -> goNextRef.current).
  goNextRef.current = goNext;

  const advanceToNextPhoto = useCallback(() => {
    setImageLoaded(false);
    goNext();
  }, [goNext]);

  useEffect(() => {
    const nextSrc = getSlideshowPhotoSrc(getUpcomingPhoto());

    setBufferedPhotoSrc(nextSrc);
  }, [currentPhotoPath?.path, getUpcomingPhoto, historyPosition.index, historyPosition.total]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleSlideshowKeyboardShortcut(e, {
        goNext: advanceToNextPhoto,
        goPrevious: () => {
          setImageLoaded(false);
          goPrevious();
        },
        togglePaused,
        exit: () => {
          navigateTo("/");
        },
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advanceToNextPhoto, goPrevious, togglePaused]);

  useEffect(() => {
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenRoot = document.documentElement as FullscreenElement;
     
    setIsFullscreenSupported(
      typeof fullscreenRoot.requestFullscreen === "function" ||
        typeof fullscreenRoot.webkitRequestFullscreen === "function",
    );

    const syncFullscreenState = () => {
      setIsFullscreenActive(
        Boolean(
          document.fullscreenElement ??
          fullscreenDocument.webkitFullscreenElement,
        ),
      );
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener(
        "webkitfullscreenchange",
        syncFullscreenState,
      );
    };
  }, []);

  const handleFullscreenToggle = useCallback(async () => {
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenRoot = document.documentElement as FullscreenElement;

    try {
      if (
        document.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement
      ) {
        if (typeof document.exitFullscreen === "function") {
          await document.exitFullscreen();
          return;
        }
        if (typeof fullscreenDocument.webkitExitFullscreen === "function") {
          await fullscreenDocument.webkitExitFullscreen();
          return;
        }
      }

      if (typeof fullscreenRoot.requestFullscreen === "function") {
        await fullscreenRoot.requestFullscreen();
        return;
      }

      if (typeof fullscreenRoot.webkitRequestFullscreen === "function") {
        await fullscreenRoot.webkitRequestFullscreen();
        return;
      }

      setSlideshowError(
        "Fullscreen is not available on this browser. Use the browser's own full-screen controls on iPad.",
      );
    } catch (error) {
      console.error(error);
      setSlideshowError(
        "Couldn't enter fullscreen on this device. Safari on iPad can be limited here.",
      );
    }
  }, []);

  // Any touch interaction anywhere in the slideshow is a fresh user gesture —
  // use it to (re)acquire the screen wake lock, which Safari PWAs require to
  // happen inside a gesture handler. Capture-phase so taps on buttons or
  // overlays that stop propagation still trigger it.
  const handleAnyTouchStartCapture = useCallback(() => {
    if (props.disabled || wakeLockRef.current) {
      return;
    }
    tryAcquireWakeLock().catch(console.error);
  }, [props.disabled, tryAcquireWakeLock, wakeLockRef]);

  const handleImagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);

      // Use the gesture to silently acquire a wake lock if not already held.
      // This is the most reliable path in Safari PWAs which block gesturer-free acquisition.
      if (!wakeLockRef.current && !props.disabled) {
        tryAcquireWakeLock().catch(console.error);
      }

      pointerGestureRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        controlsWereVisible: controlsVisible,
      };
      // Defensive reset: under normal flow the prior gesture's synthetic click
      // consumes (and self-clears) the suppress flag, but if that click never
      // reached this element (e.g. focus shift, navigation, browser quirk) the
      // flag could linger and eat the next legitimate click. Clear it on every
      // new gesture so a fresh tap always lands.
      suppressImageClickRef.current = false;
      setTouchGestureHint(null);
      setTouchPullProgress(0);
      setTouchSwipeProgress(0);
      setTouchArmed(false);
      if (isTouchOrPen(event.pointerType)) {
        setTouchPointerActive(true);
      }
    },
    [controlsVisible, props.disabled, tryAcquireWakeLock, wakeLockRef],
  );

  const clearImagePointerGesture = useCallback(
    (event?: React.PointerEvent<HTMLElement>) => {
      if (event) {
        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch (error) {
          console.debug("Ignoring stale slideshow pointer capture", error);
        }
      }

      pointerGestureRef.current = null;
      // On pointercancel the gesture ends without a follow-up click, so any
      // suppress flag from a prior pointerup-set commit branch must be cleared
      // — otherwise the next legitimate click could be swallowed. On pointerup
      // this resets to false too, but the up handler immediately re-sets it
      // for touch/pen so suppression still works there.
      suppressImageClickRef.current = false;
      setTouchGestureHint(null);
      setTouchPullProgress(0);
      setTouchSwipeProgress(0);
      setTouchPointerActive(false);
      setTouchArmed(false);
    },
    [],
  );

  const handleImagePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = pointerGestureRef.current;
      if (
        !gesture ||
        gesture.pointerId !== event.pointerId ||
        !isTouchOrPen(gesture.pointerType)
      ) {
        return;
      }

      const result = resolvePointerMove({
        deltaX: event.clientX - gesture.startX,
        deltaY: event.clientY - gesture.startY,
        committedHorizontal: gesture.committedHorizontalDirection,
        committedVertical: gesture.committedVerticalDirection,
        controlsWereVisible: gesture.controlsWereVisible,
      });

      // The other axis is already committed — leave visuals untouched.
      if (result.kind === "ignore") {
        return;
      }

      // Persist any newly-committed axis direction for the rest of the gesture.
      if (result.committedHorizontal) {
        gesture.committedHorizontalDirection = result.committedHorizontal;
      }
      if (result.committedVertical) {
        gesture.committedVerticalDirection = result.committedVertical;
      }

      setTouchGestureHint(result.hint);
      setTouchPullProgress(result.pullProgress);
      setTouchSwipeProgress(result.swipeProgress);

      if (result.armed) {
        setTouchArmed(true);
        // Fire the commit haptic exactly once per gesture.
        if (!gesture.hapticFired) {
          gesture.hapticFired = true;
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate(8);
          }
        }
      } else {
        setTouchArmed(false);
      }
    },
    [],
  );

  const handleImagePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = pointerGestureRef.current;
      clearImagePointerGesture(event);

      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      const currentTarget = event.currentTarget;
      const { action, suppressClick } = resolvePointerUpAction({
        deltaX: event.clientX - gesture.startX,
        deltaY: event.clientY - gesture.startY,
        isTouchLike: isTouchOrPen(gesture.pointerType),
        committedHorizontal: gesture.committedHorizontalDirection,
        committedVertical: gesture.committedVerticalDirection,
        controlsWereVisible: gesture.controlsWereVisible,
        tap: {
          clientX: event.clientX,
          // Deferred: only the sub-12px tap path reads layout, so a swipe or
          // pull no longer forces a reflow on release.
          getBounds: () => {
            const b = currentTarget.getBoundingClientRect();
            return { left: b.left, width: b.width };
          },
          canGoPrevious,
        },
      });

      // The browser synthesises a click after a touch pointerup; the resolver
      // tells us when to swallow it so a jitter or cancelled gesture can't
      // fall through to the image's onClick and silently advance.
      if (suppressClick) {
        suppressImageClickRef.current = true;
      }

      switch (action) {
        case "next":
          advanceToNextPhoto();
          break;
        case "previous":
          goPrevious();
          break;
        case "show-controls":
          setControlsVisible(true);
          break;
        case "hide-controls":
          dismissControls();
          break;
        case "remix":
          // Drag-up forces the next advance to be a remix (mirrors the
          // "Remix now" button); advanceToNextPhoto honours forceRemix.
          forceRemixRef.current = true;
          advanceToNextPhoto();
          break;
        case "none":
          break;
      }
    },
    [
      advanceToNextPhoto,
      canGoPrevious,
      clearImagePointerGesture,
      dismissControls,
      goPrevious,
      setControlsVisible,
    ],
  );

  const getCurrentPhotoLink = useCallback((): string | null => {
    const photoPath = currentEntry(historyStateRef.current)?.seed.path;
    if (!photoPath) {
      return null;
    }

    return buildSlideshowPermalink({
      origin: window.location.origin,
      mode: slideshowMode,
      photoPath,
      ...(filter ? { filter } : {}),
    });
  }, [filter, slideshowMode]);

  const copyCurrentPhotoLink = useCallback(async () => {
    const photoLink = getCurrentPhotoLink();
    if (!photoLink) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(photoLink);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = photoLink;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.inset = "0 auto auto -9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopiedPhotoLink(true);
      window.setTimeout(() => setCopiedPhotoLink(false), 1800);
    } catch (err) {
      console.error("Failed to copy slideshow photo link", err);
      setSlideshowError("Could not copy photo link");
    }
  }, [getCurrentPhotoLink]);

  // Hand off the current photo to the iOS / Android system share sheet. Falls
  // back to clipboard copy when Web Share isn't available (desktop Safari,
  // most desktop browsers other than Chrome on macOS).
  const shareCurrentPhoto = useCallback(async () => {
    const photoLink = getCurrentPhotoLink();
    if (!photoLink) return;
    const sharePath = currentEntry(historyStateRef.current)?.seed.path;
    const albumName = sharePath?.split("/")?.[2] ?? "";
    const photoName = sharePath?.split("/")?.[3] ?? "";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: photoName || "Photo",
          text: albumName ? `From ${albumName}` : undefined,
          url: photoLink,
        });
        return;
      } catch (err) {
        // User cancelled, or the platform rejected the share — fall through
        // to clipboard so something still happens.
        console.debug("Web Share cancelled or unavailable", err);
      }
    }
    await copyCurrentPhotoLink();
  }, [copyCurrentPhotoLink, getCurrentPhotoLink]);

  // Long-press the Context icon to dump info about the currently-displayed
  // image — URL, decoded dimensions, byte size. Mostly a debug affordance
  // for verifying the resized-image variant being served on real devices
  // (e.g. confirming whether the iPad PWA is loading @3200 vs @1600).
  const inspectCurrentImage = useCallback(async () => {
    const img = document.querySelector(
      'img[alt]:not([aria-hidden="true"])',
    ) as HTMLImageElement | null;
    if (!img) return;
    const src = img.currentSrc || img.src;
    const decoded = `${img.naturalWidth}×${img.naturalHeight}`;
    const displayed = `${Math.round(img.getBoundingClientRect().width)}×${Math.round(img.getBoundingClientRect().height)}`;
    let sizeKb: string | null = null;
    try {
      const head = await fetch(src, { method: "HEAD", cache: "no-store" });
      const bytes = head.headers.get("content-length");
      if (bytes) {
        sizeKb = `${(parseInt(bytes, 10) / 1024).toFixed(0)} KB`;
      }
    } catch {
      // ignore — HEAD might fail on some hosts; still show what we have.
    }
    const dpr = window.devicePixelRatio;
    const lines = [
      src,
      `decoded ${decoded}`,
      `displayed ${displayed} @ ${dpr.toFixed(2)}× DPR`,
      sizeKb ? `bytes ${sizeKb}` : null,
    ].filter(Boolean);
    alert(lines.join("\n"));
  }, []);

  const activePhotoSrc = getSlideshowPhotoSrc(currentPhotoPath);
  // Tracks whether the *previously displayed* slide was a remix. Read by the
  // crossfade effect below so it can skip the fade when leaving a remix —
  // otherwise the previousPhotoSrc is the lone seed src and renders full-bleed
  // behind the new grid while its cells load, which reads as a misleading
  // single-image flash between the two remixes.
  const previousSlideWasRemixRef = React.useRef(false);

  useEffect(() => {
    if (!activePhotoSrc) {
      activePhotoSrcRef.current = null;

      setPreviousPhotoSrc(null);
      previousSlideWasRemixRef.current = false;
      return;
    }

    const previousPhotoSrc = activePhotoSrcRef.current;

    if (previousPhotoSrc && previousPhotoSrc !== activePhotoSrc) {
      // Leaving any remix layout: the cached previous src is just the seed,
      // which would show full-bleed behind the new content while it loads
      // and read as a stray extra slide. Skip the fade in that case — the
      // new image / grid handles its own reveal once ready.
      setPreviousPhotoSrc(
        previousSlideWasRemixRef.current ? null : previousPhotoSrc,
      );
      setImageLoaded(false);
    }

    activePhotoSrcRef.current = activePhotoSrc;
    previousSlideWasRemixRef.current = remixCompanions.length > 0;
  }, [activePhotoSrc, remixCompanions]);

  // Track which cells in the current remix have finished loading so the grid
  // reveals all at once (see util hook). Memoise the companion paths so the
  // hook's safety-net effect stays stable across renders within a layout.
  const remixCompanionPaths = React.useMemo(
    () => remixCompanions.map((c) => c.path),
    [remixCompanions],
  );
  const { markRemixCellLoaded, isRemixGridReady } = useRemixGridReveal({
    seedPath: currentPhotoPath?.path,
    companionPaths: remixCompanionPaths,
  });

  // Clear the fade-out backdrop only once the *whole* new grid is ready, so
  // the user never sees a window where the previous slide is gone and the
  // new grid hasn't yet revealed. The 260ms delay matches the grid's own
  // opacity transition, so the backdrop persists through the fade-in.
  useEffect(() => {
    if (!isRemixGridReady || remixCompanions.length === 0) return;
    const t = window.setTimeout(() => setPreviousPhotoSrc(null), 260);
    return () => window.clearTimeout(t);
  }, [isRemixGridReady, remixCompanions.length]);

  if (currentPhotoPath === null) {
    return (
      <div className={styles.progressBarContainer}>
        <div style={{ display: "none" }}>
          <ThemeToggle />
        </div>
        {slideshowError ? (
          <div className={commonStyles.toast}>{slideshowError}</div>
        ) : (
          <ProgressBar
            progress={
              slideshowMode === "similar" && !embeddingsDatabase
                ? embeddingsProgress
                : progress
            }
          />
        )}
      </div>
    );
  }

  const albumName = currentPhotoPath?.path?.split?.("/")?.[2] ?? "";
  const photoName = currentPhotoPath?.path?.split?.("/")?.[3] ?? "";
  const photoBlock: PhotoBlock = {
    kind: "photo",
    id: "",
    data: {
      src: activePhotoSrc ?? "",
      title: undefined,
      kicker: undefined,
      description: undefined,
    },
    _build: {
      height: 0,
      width: 0,
      exif: {},
      tags: {},
      srcset: [],
    },
  };

  const photoAltText = getPhotoAltText(photoBlock, "Slideshow photo");

  // Seed photo plus any remix companions, in render order. Consumed by
  // both the bottom-bar overlay and the image layer below.
  const slidePhotos = [currentPhotoPath, ...remixCompanions];

  return (
    <>
      <Seo
        title="Slideshow | Snapshots"
        description="Play a fullscreen slideshow from the photo archive."
        pathname="/slideshow"
        noindex
        jsonLd={buildCollectionPageJsonLd({
          name: "Slideshow | Snapshots",
          description: "Play a fullscreen slideshow from the photo archive.",
          pathname: "/slideshow",
        })}
      />

      <div
        className={styles.container}
        data-controls-visible={String(controlsVisible)}
        data-fullscreen-active={String(isFullscreenActive)}
        data-paused={String(isPaused)}
        data-touch-active={String(touchPointerActive)}
        data-touch-armed={String(touchArmed)}
        onPointerDownCapture={extendControlsHideDeadline}
        onPointerMoveCapture={extendControlsHideDeadline}
        onTouchStartCapture={handleAnyTouchStartCapture}
        style={
          {
            "--touch-toolbar-show-preview-progress": String(
              touchToolbarShowPreviewProgress,
            ),
            "--touch-toolbar-hide-preview-progress": String(
              touchToolbarHidePreviewProgress,
            ),
          } as React.CSSProperties
        }
      >
        {isFullscreenActive ? (
          <button
            className={styles.fullscreenExitButton}
            type="button"
            aria-label="Exit fullscreen"
            title="Exit fullscreen"
            onClick={() => {
              handleFullscreenToggle().catch(console.error);
            }}
          >
            Exit full
          </button>
        ) : null}

        {!isCoarsePointer ? (
          <>
            <div
              className={styles.toolbarTrigger}
              aria-hidden="true"
              onMouseEnter={showControlsForDesktop}
              onMouseMove={showControlsForDesktop}
            />
            {!controlsVisible ? (
              <div className={styles.toolbarHint} aria-hidden="true">
                Move cursor to top edge for controls
              </div>
            ) : null}
          </>
        ) : null}
        {isCoarsePointer ? (
          <div
            className={styles.touchAffordances}
            data-touch-hint={touchGestureHint ?? "idle"}
            data-controls-visible={String(controlsVisible)}
            data-touch-active={String(touchPointerActive)}
            data-touch-armed={String(touchArmed)}
            aria-hidden="true"
            style={
              {
                "--touch-pull-progress": String(touchPullProgress),
                "--touch-swipe-progress": String(touchSwipeProgress),
              } as React.CSSProperties
            }
          >
            {/* Top affordance removed — the toolbar slides down over the
                same area when the user pulls, so the hint is redundant. */}
            <div className={styles.touchBottomAffordance}>
              <span className={styles.touchPullChevron}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className={styles.touchAffordanceLabel}>
                {controlsVisible ? "Close settings" : "◫ Remix now"}
              </span>
            </div>
            <div className={styles.touchSideAffordanceLeft}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className={styles.touchSideAffordanceRight}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ) : null}
        {isCoarsePointer &&
        isWakeLockSupported &&
        !isWakeLockActive &&
        !controlsVisible &&
        !touchPointerActive ? (
          <div className={styles.wakeLockNudge} aria-hidden="true">
            Tap anywhere to keep the screen awake
          </div>
        ) : null}

        <SlideshowToolbar
          onFocusCapture={showControlsForDesktop}
          onPointerOverToolbar={setIsPointerOverToolbar}
          poolStats={poolStats}
          {...(filter ? { filter } : {})}
          albumName={albumName}
          photoName={photoName}
          playbackSubtitle={playbackSubtitle}
          playbackContextLabel={playbackContextLabel}
          slideshowMode={slideshowMode}
          onSelectMode={setSlideshowModeAndUrl}
          timeAware={timeAware}
          onToggleTimeAware={() => setTimeAware(!timeAware)}
          remixEnabled={remixEnabled}
          onToggleRemix={() => setRemixEnabled(!remixEnabled)}
          onRemixNow={() => {
            forceRemixRef.current = true;
            advanceToNextPhoto();
          }}
          isPaused={isPaused}
          onTogglePaused={togglePaused}
          canGoPrevious={canGoPrevious}
          onPrevious={() => {
            setImageLoaded(false);
            goPrevious();
          }}
          onNext={advanceToNextPhoto}
          onHide={hideDesktopControls}
          controlsHideProgress={controlsHideProgress}
          showClock={showClock}
          onToggleClock={() => setShowClock(!showClock)}
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails)}
          showMap={showMap}
          onToggleMap={() => setShowMap(!showMap)}
          detailsAlignment={detailsAlignment}
          onCycleAlignment={cycleAlignment}
          showCover={showCover}
          onToggleCover={() => setShowCover(!showCover)}
          isFullscreenActive={isFullscreenActive}
          isFullscreenSupported={isFullscreenSupported}
          onToggleFullscreen={() => {
            handleFullscreenToggle().catch(console.error);
          }}
          isWakeLockActive={isWakeLockActive}
          isWakeLockSupported={isWakeLockSupported}
          onTryWakeLock={() => {
            tryAcquireWakeLock().catch(console.error);
          }}
          timeDelay={timeDelay}
          onSelectDelay={setTimeDelayAndUrl}
          showLongTimings={showLongTimings}
          onToggleLongTimings={() => setShowLongTimings(!showLongTimings)}
          secondsLeft={secondsLeft}
          alignCadence={alignCadence}
          onToggleAlign={() => {
            const next = !alignCadence;
            setAlignCadence(next);
            if (next) {
              alignNextChangeToCadence();
            }
          }}
          onInspectImage={() => {
            void inspectCurrentImage();
          }}
          onCopyLink={() => {
            void copyCurrentPhotoLink();
          }}
          copiedPhotoLink={copiedPhotoLink}
          onShare={() => {
            void shareCurrentPhoto();
          }}
        />

        {/* Hack: render the elements twice so we can get a different context
        to get mix-blend-mode working on ONLY the map and not on the text.
        However we still want the positioning of the map to to be handled by the box model,
        so we render details twice (but hide with visibility: hidden). We need a different
        context because the drop shadows disappear when mix-blend-mode is applied.
        */}
        {/*
          New layout: one fixed bottom-anchored flex stack.
          • Per-photo descriptions row on top (1 cell for single, N for remix).
          • Slide-level chrome (map + clock + remix badge) below.
          The chrome is rendered once regardless of cell count, so the clock
          and map don't shift position when going from single to remix.
          The chrome render is doubled for the mix-blend-mode hack that
          preserves drop-shadows on the text below.
        */}
        {/* One fixed-position grid that owns the descriptions + chrome.
            data-count drives the grid-template-areas so the description
            cells split into 1, 2, or 3 columns and the chrome row below
            spans the full width. Single source of truth means the clock
            never moves between single/remix and there's no parallel
            "centered" description block taking layout space. */}
        {/* Dual-rendered stack. Both copies share the same fixed position
            and identical layout (every grid-area present) so they overlay
            pixel-for-pixel. Layer 1 has `mix-blend-mode: screen` on the
            stack itself — this blend reaches the photo because the stack
            is a direct child of the slideshow container. Layer 1 shows
            only the map; other cells have visibility: hidden but still
            occupy layout so positioning stays in lockstep with Layer 2.
            Layer 2 has no blending; map cell is visibility:hidden, the
            text cells are visible. Net result: map blends with the photo,
            text/clock render with their full text-shadow intact. */}
        <SlideshowBottomBar
          slidePhotos={slidePhotos}
          showDetails={showDetails}
          showMap={showMap}
          showClock={showClock}
          timeAware={timeAware}
          detailsAlignment={detailsAlignment}
          remixStrategy={remixStrategy}
          remixVectorScore={remixVectorScore}
          time={time}
        />

        {previousPhotoSrc ? (
          <img
            className={[
              styles.image,
              styles.previousImage,
              imageLoaded ? styles.previousImageHidden : "",
              showCover ? styles.cover : "",
            ].join(" ")}
            src={previousPhotoSrc}
            alt=""
            aria-hidden="true"
          />
        ) : null}

        {remixCompanions.length > 0 ? (
          <div
            className={[
              styles.remixGrid,
              isRemixGridReady ? "" : styles.remixGridNotReady,
            ]
              .filter(Boolean)
              .join(" ")}
            data-count={remixCompanions.length + 1}
            style={{ touchAction: "none" }}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerCancel={clearImagePointerGesture}
            onPointerUp={handleImagePointerUp}
            onClick={() => {
              if (suppressImageClickRef.current) {
                suppressImageClickRef.current = false;
                return;
              }
              advanceToNextPhoto();
            }}
          >
            {slidePhotos.map((photo, idx) => {
              const isSeed = idx === 0;
              const src = isSeed
                ? photoBlock.data.src
                : getSlideshowPhotoSrc(photo);
              if (!src) return null;

              return (
                <div key={photo.path} className={styles.remixCell}>
                  <img
                    className={[
                      styles.remixImage,
                      isSeed && !imageLoaded ? styles.notLoaded : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    src={src}
                    alt={isSeed ? photoAltText : ""}
                    aria-hidden={isSeed ? undefined : true}
                    onLoad={() => {
                      markRemixCellLoaded(photo.path);
                      if (isSeed) {
                        setImageLoaded(true);
                      }
                    }}
                    onError={() => {
                      // Always mark the cell "loaded" on error so a single
                      // broken companion can't pin the grid at opacity 0.
                      // For the seed, keep the auto-advance on broken images
                      // so kiosk displays don't get stuck on a 404.
                      markRemixCellLoaded(photo.path);
                      if (isSeed) {
                        setTimeout(() => {
                          advanceToNextPhoto();
                        }, 1000);
                      }
                    }}
                  />
                  {/* per-cell description is now rendered as a bottomBar
                      column further down — same component as the single-
                      image case, just one per cell. */}
                </div>
              );
            })}
          </div>
        ) : (
          <img
            className={[
              styles.image,
              !imageLoaded ? styles.notLoaded : "",
              showCover ? styles.cover : "",
            ].join(" ")}
            src={photoBlock.data.src}
            alt={photoAltText}
            style={{ touchAction: "none" }}
            onLoad={() => {
              setImageLoaded(true);
              window.setTimeout(() => {
                setPreviousPhotoSrc(null);
              }, 260);
            }}
            onError={() => {
              // Skip bad images to avoid showing broken image on displays
              setTimeout(() => {
                advanceToNextPhoto();
              }, 1000);
            }}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerCancel={clearImagePointerGesture}
            onPointerUp={handleImagePointerUp}
            onClick={() => {
              if (suppressImageClickRef.current) {
                suppressImageClickRef.current = false;
                return;
              }
              advanceToNextPhoto();
            }}
          />
        )}

        {bufferedPhotoSrc && bufferedPhotoSrc !== photoBlock.data.src ? (
          <img
            className={styles.preloadBuffer}
            src={bufferedPhotoSrc}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        ) : null}
      </div>
    </>
  );
};

export default SlideshowPage;
