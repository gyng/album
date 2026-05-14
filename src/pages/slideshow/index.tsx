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
import Link from "next/link";
import { useLocalStorage } from "usehooks-ts";
import { getRelativeTimeString } from "../../util/time";
import {
  extractDateFromExifString,
  extractGPSFromExifString,
} from "../../util/extractExifFromDb";
import MMap from "../../components/Map";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getPhotoAltText } from "../../lib/alt";
import { navigateTo, reloadCurrentPage } from "../../util/navigate";
import { handleSlideshowKeyboardShortcut } from "../../util/slideshowKeyboard";
import {
  getNextSlideshowOverlayPreset,
  getSlideshowTouchTapAction,
} from "../../util/slideshowTouch";
import { getNextAlignedSlideshowChange } from "../../util/slideshowTiming";
import {
  decideRemixCompanionCount,
  getTimeAffinityScore,
  pickRemixCompanions,
  RemixStrategy,
  timeAwareShufflePhotos,
} from "../../util/slideshowAmbient";
import { BUILD_VERSION } from "../../lib/buildVersion";

type PageProps = {};
type SlideshowMode = "random" | "weighted" | "similar";
const CONTROLS_AUTO_HIDE_MS = 3000;
const TOUCH_CONTROLS_AUTO_HIDE_MS = 30000;
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
const TOUCH_SWIPE_THRESHOLD_PX = 48;
const TOUCH_SWIPE_HINT_THRESHOLD_PX = TOUCH_SWIPE_THRESHOLD_PX / 2; // start showing hint at half the commit distance
const TOUCH_PULL_THRESHOLD_PX = 72;
const TOUCH_PULL_HINT_THRESHOLD_PX = TOUCH_PULL_THRESHOLD_PX / 3; // start showing pull hint at 1/3 of the commit distance

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WakeLockSentinel = EventTarget & {
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
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

const avoidBoundaryRepeat = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  if (
    previousLastPath &&
    photos.length > 1 &&
    photos[0]?.path === previousLastPath
  ) {
    const swapIdx = photos.findIndex(
      (photo) => photo.path !== previousLastPath,
    );
    if (swapIdx > 0) {
      [photos[0], photos[swapIdx]] = [photos[swapIdx], photos[0]];
    }
  }

  return photos;
};

const shufflePhotos = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  const shuffled = [...photos];

  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const randomIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[randomIdx]] = [shuffled[randomIdx], shuffled[idx]];
  }

  return avoidBoundaryRepeat(shuffled, previousLastPath);
};

const weightedShufflePhotos = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  const timestamps = photos
    .map((photo) => extractDateFromExifString(photo.exif)?.getTime() ?? null)
    .filter((timestamp): timestamp is number => timestamp !== null);

  if (timestamps.length === 0) {
    return shufflePhotos(photos, previousLastPath);
  }

  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const timestampRange = Math.max(1, maxTimestamp - minTimestamp);

  const weighted = photos
    .map((photo) => {
      const timestamp =
        extractDateFromExifString(photo.exif)?.getTime() ?? null;
      const normalized =
        timestamp === null ? 0.15 : (timestamp - minTimestamp) / timestampRange;
      const weight = 1 + normalized * 5;
      const randomValue = Math.max(Math.random(), Number.EPSILON);
      return {
        photo,
        key: -Math.log(randomValue) / weight,
      };
    })
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.photo);

  return avoidBoundaryRepeat(weighted, previousLastPath);
};

const getSlideshowPhotoSrc = (photo: RandomPhotoRow | null): string | null => {
  if (!photo?.path) {
    return null;
  }

  const albumName = photo.path.split("/")?.[2] ?? "";
  const photoName = photo.path.split("/")?.[3] ?? "";
  if (!albumName || !photoName) {
    return null;
  }

  return `/data/albums/${albumName}/.resized_images/${photoName}@3200.avif`;
};

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
        const latestBuildVersion = manifest.buildVersion?.trim();
        if (
          latestBuildVersion &&
          latestBuildVersion !== buildVersionRef.current
        ) {
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

        // Seed on the first observation so a fresh page load doesn't
        // immediately mistake "I've never seen this header before" for an update.
        if (lastDbVersionRef.current === null) {
          lastDbVersionRef.current = version;
          return;
        }

        if (version === lastDbVersionRef.current) {
          return;
        }

        // The DB on disk has changed.
        lastDbVersionRef.current = version;

        if (wakeLockRef.current) {
          // Active kiosk session — refresh the photo pool in place so we
          // never tear down the document and lose the wake lock. The next
          // queue refill will pick up the new pool.
          const photos = await fetchSlideshowPhotos({
            database,
            filter: filterRef.current,
          });
          if (photos.length > 0) {
            randomPhotoPoolRef.current = photos;
            randomQueueRef.current = [];
            randomQueueIndexRef.current = -1;
            recentPhotoPathsRef.current = [];
          }
        } else {
          // Wake lock isn't held — reload is cheap and gives us a fully
          // clean re-init of sql.js-httpvfs cached pages too.
          reloadCurrentPage();
        }
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
  }, [database]);

  const [currentPhotoPath, setCurrentPhotoPath] =
    React.useState<RandomPhotoRow | null>(null);
  const currentPhotoPathRef = React.useRef<RandomPhotoRow | null>(null);
  const randomPhotoPoolRef = React.useRef<RandomPhotoRow[]>([]);
  const randomQueueRef = React.useRef<RandomPhotoRow[]>([]);
  const randomQueueIndexRef = React.useRef<number>(-1);
  const randomQueueLastPathRef = React.useRef<string | undefined>(undefined);
  // Each navigation history entry captures the seed photo *plus* any remix
  // companions and the strategy that produced them, so pressing Previous /
  // Next replays the full side-by-side layout instead of collapsing the
  // remix back to a single photo.
  type NavigationEntry = {
    seed: RandomPhotoRow;
    companions: RandomPhotoRow[];
    strategy: RemixStrategy | null;
  };
  const navigationHistoryRef = React.useRef<NavigationEntry[]>([]);
  const historyIndexRef = React.useRef<number>(-1);
  const [slideshowError, setSlideshowError] = React.useState<string | null>(
    null,
  );
  const [copiedPhotoLink, setCopiedPhotoLink] = React.useState(false);
  const [historyPosition, setHistoryPosition] = React.useState({
    index: -1,
    total: 0,
  });

  const [timeDelay, setTimeDelay, removeTimeDelay] = useLocalStorage(
    "slideshow-timedelay",
    900000,
  );
  const timeDelayRef = React.useRef(timeDelay);
  const [showClock, setShowClock, removeShowClock] = useLocalStorage(
    "slideshow-showclock",
    false,
  );
  const [showMap, setShowMap, removeShowMap] = useLocalStorage(
    "slideshow-showmap",
    false,
  );
  const [showDetails, setShowDetails, removeShowDetails] = useLocalStorage(
    "slideshow-showdetails",
    false,
  );
  const [showCover, setShowCover, removeShowCover] = useLocalStorage(
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
  const [remixCompanions, setRemixCompanions] = React.useState<
    RandomPhotoRow[]
  >([]);
  const [remixStrategy, setRemixStrategy] =
    React.useState<RemixStrategy | null>(null);
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

  const [nextChangeAt, setNextChangeAt] = React.useState<Date>(new Date());
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [time, setTime] = React.useState<Date>(new Date());

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
  const [shuffleHistorySize, setShuffleHistorySize, removeShuffleHistorySize] =
    useLocalStorage("slideshow-shuffle-history-size", 100);
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
  const [isPaused, setIsPaused] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [controlsHideProgress, setControlsHideProgress] = React.useState(1);
  const [isCoarsePointer, setIsCoarsePointer] = React.useState(false);
  const [isPointerOverToolbar, setIsPointerOverToolbar] = React.useState(false);
  const [isFullscreenSupported, setIsFullscreenSupported] =
    React.useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = React.useState(false);
  const [isWakeLockSupported, setIsWakeLockSupported] = React.useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = React.useState(false);
  const [touchGestureHint, setTouchGestureHint] = React.useState<
    "next" | "previous" | "controls" | "reload" | "overlays" | null
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
    controlsVisible && touchGestureHint === "overlays"
      ? remapPeek(touchPullProgress)
      : 0;
  // Loaded for Similar mode and *also* once the user expresses interest in
  // vector-based remix strategies (set lazily by the remix code path the
  // first time it rolls a vector strategy, so cold start doesn't pay for
  // the embeddings DB unless someone uses them).
  const [enableRemixEmbeddings, setEnableRemixEmbeddings] = React.useState(
    false,
  );
  const [embeddingsDatabase, embeddingsProgress] = useEmbeddingsDatabase(
    slideshowMode === "similar" || enableRemixEmbeddings,
  );
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);
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
  const controlsHideDeadlineRef = React.useRef<number | null>(null);
  const pausedRemainingMsRef = React.useRef<number | null>(null);
  const activePhotoSrcRef = React.useRef<string | null>(null);
  const [bufferedPhotoSrc, setBufferedPhotoSrc] = React.useState<string | null>(
    null,
  );

  // Bump the auto-hide deadline forward on each container-level pointer
  // event so touch interactions keep the toolbar awake (desktop gets this
  // via the mouse-over-toolbar branch in the auto-hide effect).
  const extendControlsHideDeadline = useCallback(() => {
    if (!isCoarsePointer || !controlsVisible) {
      return;
    }
    controlsHideDeadlineRef.current = Date.now() + TOUCH_CONTROLS_AUTO_HIDE_MS;
    setControlsHideProgress(1);
  }, [controlsVisible, isCoarsePointer]);

  const updateSlideshowUrl = useCallback(
    (mode: SlideshowMode, delayMs = timeDelayRef.current) => {
      const url = new URL(window.location.toString());
      url.searchParams.set("mode", mode);
      url.searchParams.set("delay", String(delayMs / 1000));
      url.searchParams.delete("photo");
      url.searchParams.delete("seed");

      window.history.replaceState(window.history.state, "", url.toString());
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
  // Parse URL search params to configure slideshow
  useEffect(() => {
    const url = new URL(window.location.toString());

    // Helper to parse boolean-like values from URL params
    const parseBool = (value: string | null): boolean | null => {
      if (value === null) return null;
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    };

    // Helper to parse numeric values
    const parseNum = (value: string | null): number | null => {
      if (value === null) return null;
      const num = parseInt(value, 10);
      return isNaN(num) ? null : num;
    };

    // Parse filter (already supported)
    const searchFilter = url.searchParams.get("filter");
    if (searchFilter) {
       
      setFilter(searchFilter);
    }

    const modeParam = url.searchParams.get("mode");
    initialPhotoPathRef.current =
      url.searchParams.get("photo") ?? url.searchParams.get("seed");
    const nextMode =
      modeParam === "random" ||
      modeParam === "weighted" ||
      modeParam === "similar"
        ? modeParam
        : slideshowMode;
    randomSimilarRequestedRef.current =
      nextMode === "similar" &&
      ["1", "true", "yes", "on"].includes(
        (url.searchParams.get("random") ?? "").toLowerCase(),
      );
    if (
      modeParam === "random" ||
      modeParam === "weighted" ||
      modeParam === "similar"
    ) {
      setSlideshowMode(modeParam);
    }

    // Parse clock setting
    const clockParam = parseBool(url.searchParams.get("clock"));
    if (clockParam !== null) {
      setShowClock(clockParam);
    }

    // Parse details setting
    const detailsParam = parseBool(url.searchParams.get("details"));
    if (detailsParam !== null) {
      setShowDetails(detailsParam);
    }

    // Parse map setting
    const mapParam = parseBool(url.searchParams.get("map"));
    if (mapParam !== null) {
      setShowMap(mapParam);
    }

    // Parse cover setting (cover or contain mode)
    const coverParam = parseBool(url.searchParams.get("cover"));
    if (coverParam !== null) {
      setShowCover(coverParam);
    }

    // Time-of-day & season-aware bias toggle.
    const timeParam = parseBool(url.searchParams.get("time"));
    if (timeParam !== null) {
      setTimeAware(timeParam);
    }

    // Occasional 2-/3-up "remix" slides.
    const remixParam = parseBool(url.searchParams.get("remix"));
    if (remixParam !== null) {
      setRemixEnabled(remixParam);
    }

    // Snap each advance to wall-clock boundaries (default on). Tests and
    // anyone wanting a strict "now + delay" cadence can pass align_cadence=0.
    const alignCadenceParam = parseBool(url.searchParams.get("align_cadence"));
    if (alignCadenceParam !== null) {
      setAlignCadence(alignCadenceParam);
    }

    // Parse details alignment setting
    const alignmentParam = url.searchParams.get("align");
    if (
      alignmentParam &&
      ["left", "center", "right"].includes(alignmentParam)
    ) {
      setDetailsAlignment(alignmentParam as "left" | "center" | "right");
    }

    // Parse time delay in seconds and convert to milliseconds
    const delayParam = parseNum(url.searchParams.get("delay"));
    if (delayParam !== null && delayParam > 0) {
      const delayMs = delayParam * 1000;
      timeDelayRef.current = delayMs;
      setTimeDelay(delayMs);
    }

    // Parse shuffle history size
    const historyParam = parseNum(url.searchParams.get("shuffle"));
    if (nextMode === "similar" && historyParam !== null && historyParam > 0) {
      setShuffleHistorySize(historyParam);
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

  // Single source of truth for "when does the next slide change?". Honours
  // the alignCadence toggle so every advance, history nav and pause/resume
  // either snaps to the next wall-clock boundary (e.g. :00 / :15 / :30 / :45
  // for a 15-minute cadence) or just adds the delay raw.
  const computeNextChangeAt = useCallback(
    (now: Date = new Date()): Date => {
      if (alignCadence) {
        return getNextAlignedSlideshowChange({ now, delayMs: timeDelay });
      }
      return new Date(now.getTime() + timeDelay);
    },
    [alignCadence, timeDelay],
  );

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
      // the history entry so Previous/Next can replay the full layout.
      let companions: RandomPhotoRow[] = [];
      let strategy: RemixStrategy | null = null;
      if (opts?.allowRemix && (forceRemixRef.current || remixEnabled)) {
        const wasForced = forceRemixRef.current;
        let count: 0 | 1 | 2 = 0;
        if (wasForced) {
          // User pressed "Remix now"; bypass the dice and pick a layout.
          forceRemixRef.current = false;
          count = Math.random() < 0.7 ? 1 : 2;
        } else {
          count = decideRemixCompanionCount(REMIX_PROBABILITY);
        }
        if (count > 0) {
          // 40% of *ambient* remixes try a vector strategy (SigLIP similar /
          // anti-similar) when the embeddings DB is loaded. User-forced
          // remixes always take the sync path so the layout appears
          // immediately — otherwise a "Remix now" press would briefly show
          // the seed alone while the async vector fetch is in flight.
          const wantsVector = !wasForced && Math.random() < 0.4;
          const vectorReady = !!(database && embeddingsDatabase);

          if (wantsVector && !vectorReady && !enableRemixEmbeddings) {
            // Trigger DB load so future vector rolls can succeed.
            setEnableRemixEmbeddings(true);
          }

          if (wantsVector && vectorReady) {
            // Async vector path. The history entry starts with no companions
            // and the chosen strategy; the fetch resolves later and patches
            // both the live state and the recorded history entry.
            const useAntiSimilar = Math.random() < 0.45;
            const vectorStrategy: RemixStrategy = useAntiSimilar
              ? "juxtapose"
              : "similar";
            strategy = vectorStrategy;
            const seedPath = candidatePhoto.path;
            const desiredCount = count;

            void (async () => {
              try {
                const result = await fetchSimilarResults({
                  database,
                  embeddingsDatabase,
                  path: seedPath,
                  similarityOrder: useAntiSimilar ? "least" : "most",
                  page: 1,
                  pageSize: desiredCount * 4,
                });
                // Stale guard: if the user has advanced past this slide while
                // we were fetching, drop the result on the floor.
                if (currentPhotoPathRef.current?.path !== seedPath) return;

                const pool = randomPhotoPoolRef.current;
                const fetched: RandomPhotoRow[] = [];
                for (const item of result.data) {
                  if (fetched.length >= desiredCount) break;
                  const match = pool.find((p) => p.path === item.path);
                  if (match) fetched.push(match);
                }
                if (fetched.length === 0) return;

                setRemixCompanions(fetched);
                // Patch the recorded history entry so Previous/Next replays
                // with the same companions after the async resolve.
                const entry = navigationHistoryRef.current.find(
                  (e) => e.seed.path === seedPath,
                );
                if (entry) {
                  entry.companions = fetched;
                }
              } catch (err) {
                console.error("Vector remix fetch failed", err);
              }
            })();
          } else {
            const pick = pickRemixCompanions(
              candidatePhoto,
              randomPhotoPoolRef.current,
              count,
            );
            if (pick.companions.length > 0) {
              companions = pick.companions;
              strategy = pick.strategy;
            }
          }
        }
      }

      const nextHistory = [
        ...navigationHistoryRef.current.slice(0, historyIndexRef.current + 1),
        { seed: candidatePhoto, companions, strategy },
      ];

      navigationHistoryRef.current = nextHistory;
      historyIndexRef.current = nextHistory.length - 1;
      setHistoryPosition({
        index: historyIndexRef.current,
        total: nextHistory.length,
      });

      currentPhotoPathRef.current = candidatePhoto;
      setCurrentPhotoPath(candidatePhoto);
      setRemixCompanions(companions);
      setRemixStrategy(strategy);
      setSlideshowError(null);
      setNextChangeAt(computeNextChangeAt());
    },
    [
      computeNextChangeAt,
      database,
      embeddingsDatabase,
      enableRemixEmbeddings,
      remixEnabled,
      shuffleHistorySize,
    ],
  );

  const showHistoryPhoto = useCallback(
    (index: number): RandomPhotoRow | null => {
      const entry = navigationHistoryRef.current[index] ?? null;
      if (!entry) {
        return null;
      }

      historyIndexRef.current = index;
      setHistoryPosition({
        index,
        total: navigationHistoryRef.current.length,
      });

      currentPhotoPathRef.current = entry.seed;
      setCurrentPhotoPath(entry.seed);
      // Restore the original remix layout (if any) — companions and strategy
      // are persisted in the history entry, so Previous/Next replays the
      // side-by-side faithfully.
      setRemixCompanions(entry.companions);
      setRemixStrategy(entry.strategy);
      setSlideshowError(null);
      setNextChangeAt(computeNextChangeAt());
      return entry.seed;
    },
    [computeNextChangeAt],
  );

  // When remix is toggled off, drop any active companion layout immediately
  // so the current slide collapses to a single photo. Otherwise the layout
  // would persist until the next advance, which is jarring.
  useEffect(() => {
    if (!remixEnabled) {
      setRemixCompanions([]);
      setRemixStrategy(null);
    }
  }, [remixEnabled]);

  // When time-aware is toggled, force a queue refill on the next advance so
  // the new bias takes effect immediately rather than after the current
  // pre-shuffled queue drains.
  useEffect(() => {
    randomQueueRef.current = [];
    randomQueueIndexRef.current = -1;
  }, [timeAware]);

  const refillRandomQueue = useCallback((): RandomPhotoRow[] => {
    let nextQueue: RandomPhotoRow[];
    if (timeAware) {
      // Time-aware bias overrides the per-mode bias: photos taken near the
      // current hour-of-day and month-of-year are weighted higher.
      nextQueue = timeAwareShufflePhotos(randomPhotoPoolRef.current);
      // avoidBoundaryRepeat: prevent immediate repeat at queue boundaries
      const lastPath = randomQueueLastPathRef.current;
      if (lastPath && nextQueue.length > 1 && nextQueue[0]?.path === lastPath) {
        const swapIdx = nextQueue.findIndex((p) => p.path !== lastPath);
        if (swapIdx > 0) {
          [nextQueue[0], nextQueue[swapIdx]] = [
            nextQueue[swapIdx],
            nextQueue[0],
          ];
        }
      }
    } else if (slideshowMode === "weighted") {
      nextQueue = weightedShufflePhotos(
        randomPhotoPoolRef.current,
        randomQueueLastPathRef.current,
      );
    } else {
      nextQueue = shufflePhotos(
        randomPhotoPoolRef.current,
        randomQueueLastPathRef.current,
      );
    }

    randomQueueRef.current = nextQueue;
    randomQueueIndexRef.current = -1;
    return nextQueue;
  }, [slideshowMode, timeAware]);

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

      if (randomQueueRef.current.length === 0) {
        refillRandomQueue();
      }

      let nextIndex = randomQueueIndexRef.current + 1;
      if (nextIndex >= randomQueueRef.current.length) {
        refillRandomQueue();
        nextIndex = 0;
      }

      const nextPhoto = randomQueueRef.current[nextIndex] ?? null;
      if (!nextPhoto) {
        setSlideshowError("No photos available");
        return null;
      }

      randomQueueIndexRef.current = nextIndex;
      randomQueueLastPathRef.current = nextPhoto.path;
      commitNextPhoto(nextPhoto, { ...opts, allowRemix: true });
      return nextPhoto;
    },
    [commitNextPhoto, refillRandomQueue],
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

        randomPhotoPoolRef.current = photos;
        randomQueueRef.current = [];
        randomQueueIndexRef.current = -1;
        recentPhotoPathsRef.current = [];
        navigationHistoryRef.current = [];
        historyIndexRef.current = -1;
        setHistoryPosition({ index: -1, total: 0 });
        resetSimilarQueue();

        if (photos.length === 0) {
          setCurrentPhotoPath(null);
          currentPhotoPathRef.current = null;
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
          currentPhotoPathRef.current === null
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
  }, [
    advanceRandomPhoto,
    commitNextPhoto,
    database,
    filter,
    resetSimilarQueue,
    slideshowMode,
    timeDelay,
    updateSlideshowUrl,
  ]);

  const advanceSimilarPhoto =
    useCallback(async (): Promise<RandomPhotoRow | null> => {
      if (!database || !embeddingsDatabase) {
        return null;
      }

      const activePhoto = currentPhotoPathRef.current;
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
    if (!database || (slideshowMode === "similar" && !embeddingsDatabase)) {
      return;
    }

    if (historyIndexRef.current < navigationHistoryRef.current.length - 1) {
      showHistoryPhoto(historyIndexRef.current + 1);
      return;
    }

    if (slideshowMode === "random" || slideshowMode === "weighted") {
      advanceRandomPhoto();
      return;
    }

    const activePhoto = currentPhotoPathRef.current;

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
    embeddingsDatabase,
    showHistoryPhoto,
    slideshowMode,
  ]);

  const goPrevious = useCallback(() => {
    if (historyIndexRef.current <= 0) {
      return;
    }

    showHistoryPhoto(historyIndexRef.current - 1);
  }, [showHistoryPhoto]);

  const getUpcomingPhoto = useCallback((): RandomPhotoRow | null => {
    if (historyIndexRef.current < navigationHistoryRef.current.length - 1) {
      return (
        navigationHistoryRef.current[historyIndexRef.current + 1]?.seed ?? null
      );
    }

    if (slideshowMode === "random" || slideshowMode === "weighted") {
      let queue = randomQueueRef.current;
      let nextIndex = randomQueueIndexRef.current + 1;

      if (queue.length === 0 || nextIndex >= queue.length) {
        if (randomPhotoPoolRef.current.length === 0) {
          return null;
        }

        queue =
          slideshowMode === "weighted"
            ? weightedShufflePhotos(
                randomPhotoPoolRef.current,
                randomQueueLastPathRef.current,
              )
            : shufflePhotos(
                randomPhotoPoolRef.current,
                randomQueueLastPathRef.current,
              );
        nextIndex = 0;
      }

      return queue[nextIndex] ?? null;
    }

    if (
      slideshowMode === "similar" &&
      similarSeedPathRef.current === currentPhotoPathRef.current?.path
    ) {
      const nextIndex = similarQueueIndexRef.current + 1;
      return similarQueueRef.current[nextIndex] ?? null;
    }

    return null;
  }, [slideshowMode]);

  useEffect(() => {
    if (slideshowMode === "similar") {
      randomQueueRef.current = [];
      randomQueueIndexRef.current = -1;

      if (currentPhotoPathRef.current) {
        // Switching into similar mode resets history to just the current seed
        // — discard any remix layout that was active so the new mode starts
        // from a clean single photo.
        navigationHistoryRef.current = [
          {
            seed: currentPhotoPathRef.current,
            companions: [],
            strategy: null,
          },
        ];
        historyIndexRef.current = 0;
        setHistoryPosition({ index: 0, total: 1 });
      }
      return;
    }

    resetSimilarQueue();
    randomQueueRef.current = [];
    randomQueueIndexRef.current = -1;
  }, [resetSimilarQueue, slideshowMode]);

  const canGoPrevious = historyPosition.index > 0;
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

  const togglePaused = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const alignNextChangeToCadence = useCallback(() => {
    const alignedNextChange = getNextAlignedSlideshowChange({
      now: new Date(),
      delayMs: timeDelay,
    });
    const remainingMs = Math.max(0, alignedNextChange.getTime() - Date.now());

    setNextChangeAt(alignedNextChange);
    setSecondsLeft(remainingMs / 1000);

    if (isPaused) {
      pausedRemainingMsRef.current = remainingMs;
    }
  }, [isPaused, timeDelay]);

  const advanceToNextPhoto = useCallback(() => {
    setImageLoaded(false);
    goNext();
  }, [goNext]);

  // Auto-align to cadence boundary on first photo load
  const hasAutoAlignedRef = React.useRef(false);
  useEffect(() => {
    if (!currentPhotoPath || hasAutoAlignedRef.current) {
      return;
    }
    hasAutoAlignedRef.current = true;
    alignNextChangeToCadence();
  }, [alignNextChangeToCadence, currentPhotoPath]);

  useEffect(() => {
    const nextSrc = getSlideshowPhotoSrc(getUpcomingPhoto());
     
    setBufferedPhotoSrc(nextSrc);
  }, [currentPhotoPath?.path, getUpcomingPhoto, historyPosition.index, historyPosition.total]);

  useEffect(() => {
    if (isPaused || !currentPhotoPathRef.current) {
      return;
    }

    const delayUntilNext = Math.max(0, nextChangeAt.getTime() - Date.now());
    const id = window.setTimeout(() => {
      goNext();
    }, delayUntilNext);

    return () => window.clearTimeout(id);
  }, [goNext, isPaused, nextChangeAt]);

  useEffect(() => {
    if (isPaused) {
      const remaining = Math.max(0, nextChangeAt.getTime() - Date.now());
      pausedRemainingMsRef.current = remaining;
       
      setSecondsLeft(remaining / 1000);
      return;
    }

    if (pausedRemainingMsRef.current !== null) {
      const remaining = pausedRemainingMsRef.current;
      pausedRemainingMsRef.current = null;
      setNextChangeAt(new Date(Date.now() + remaining));
      setSecondsLeft(remaining / 1000);
    }
  }, [isPaused, nextChangeAt]);

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
    const id = setInterval(() => {
      const pausedRemaining = pausedRemainingMsRef.current;
      setSecondsLeft(
        pausedRemaining !== null
          ? pausedRemaining / 1000
          : (nextChangeAt.getTime() - Date.now()) / 1000,
      );
      setTime(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, [nextChangeAt]);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia(
      "(hover: none), (pointer: coarse)",
    );
    const syncCoarsePointer = () => {
      setIsCoarsePointer(coarsePointerQuery.matches);
    };

    syncCoarsePointer();
    coarsePointerQuery.addEventListener("change", syncCoarsePointer);
    return () => {
      coarsePointerQuery.removeEventListener("change", syncCoarsePointer);
    };
  }, []);

  useEffect(() => {
    if (!controlsVisible) {
      controlsHideDeadlineRef.current = null;
      setControlsHideProgress(0);
      return;
    }

    if (isPointerOverToolbar) {
      controlsHideDeadlineRef.current = null;
      setControlsHideProgress(1);
      return;
    }

    // Touch/coarse-pointer gets a much longer dwell since the user can't
    // mouse-out to dismiss. The ring still renders to make the impending
    // auto-hide discoverable.
    const autoHideMs = isCoarsePointer
      ? TOUCH_CONTROLS_AUTO_HIDE_MS
      : CONTROLS_AUTO_HIDE_MS;
    const deadline = Date.now() + autoHideMs;
    controlsHideDeadlineRef.current = deadline;
    setControlsHideProgress(1);

    let frameId = 0;

    const tick = () => {
      const currentDeadline = controlsHideDeadlineRef.current;
      if (!currentDeadline) {
        setControlsHideProgress(0);
        return;
      }

      const remaining = Math.max(0, currentDeadline - Date.now());
      const progress = remaining / autoHideMs;
      setControlsHideProgress(progress);

      if (remaining <= 0) {
        controlsHideDeadlineRef.current = null;
        setControlsVisible(false);
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [controlsVisible, isCoarsePointer, isPointerOverToolbar]);

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

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
     
    setIsWakeLockSupported(typeof wakeLock?.request === "function");
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setIsWakeLockActive(false);

    if (!sentinel) {
      return;
    }

    try {
      await sentinel.release();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const tryAcquireWakeLock = useCallback(async () => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (
      props.disabled ||
      document.visibilityState !== "visible" ||
      typeof wakeLock?.request !== "function"
    ) {
      await releaseWakeLock();
      return;
    }

    if (wakeLockRef.current) {
      setIsWakeLockActive(true);
      return;
    }

    try {
      const sentinel = await wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setIsWakeLockActive(true);
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
        setIsWakeLockActive(false);
      });
    } catch (error) {
      console.error(error);
      wakeLockRef.current = null;
      setIsWakeLockActive(false);
    }
  }, [props.disabled, releaseWakeLock]);

  useEffect(() => {
    if (!props.disabled) {
      return;
    }

     
    releaseWakeLock().catch(console.error);
  }, [props.disabled, releaseWakeLock]);

  useEffect(() => {
    if (props.disabled) {
      return;
    }

    // Try once on load so kiosk/photo-frame sessions wake-lock automatically
    // where browsers permit non-gesture acquisition.
     
    tryAcquireWakeLock().catch(console.error);
  }, [props.disabled, tryAcquireWakeLock]);

  useEffect(() => {
    const syncWakeLockState = () => {
      if (document.visibilityState !== "visible") {
        setIsWakeLockActive(false);
        return;
      }

      if (!props.disabled) {
        tryAcquireWakeLock().catch(console.error);
      }
    };

    // pageshow fires in Safari PWAs when the page is restored from the back/forward cache
    // or resumed from background — more reliable than visibilitychange alone in that context.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) {
        return;
      }
      syncWakeLockState();
    };

    document.addEventListener("visibilitychange", syncWakeLockState);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", syncWakeLockState);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [props.disabled, tryAcquireWakeLock]);

  useEffect(() => {
    return () => {
      releaseWakeLock().catch(console.error);
    };
  }, [releaseWakeLock]);

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

  const cycleTouchOverlays = useCallback(() => {
    const nextPreset = getNextSlideshowOverlayPreset({
      showDetails,
      showMap,
      showClock,
    });

    setShowDetails(nextPreset.showDetails);
    setShowMap(nextPreset.showMap);
    setShowClock(nextPreset.showClock);
  }, [
    setShowClock,
    setShowDetails,
    setShowMap,
    showClock,
    showDetails,
    showMap,
  ]);

  const nextOverlayPreset = getNextSlideshowOverlayPreset({
    showDetails,
    showMap,
    showClock,
  });

  const nextOverlayLabel = nextOverlayPreset.showDetails
    ? nextOverlayPreset.showMap
      ? nextOverlayPreset.showClock
        ? "Show everything"
        : "Show details + map"
      : "Show details"
    : "Hide overlays";

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
    [controlsVisible, props.disabled, tryAcquireWakeLock],
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

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const horizontalDistance = Math.abs(deltaX);
      const verticalDistance = Math.abs(deltaY);

      // Map raw distance to a 0..1 progress that *starts* at the hint threshold,
      // so the indicator fades in from 0 rather than popping in mid-bright.
      const progressFromDistance = (
        distance: number,
        hintPx: number,
        commitPx: number,
      ): number =>
        Math.max(
          0,
          Math.min(1, (distance - hintPx) / (commitPx - hintPx)),
        );

      const armIfThreshold = (committed: boolean) => {
        if (!committed) {
          setTouchArmed(false);
          return;
        }
        setTouchArmed(true);
        if (!gesture.hapticFired) {
          gesture.hapticFired = true;
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate(8);
          }
        }
      };

      const isVertical =
        verticalDistance >= TOUCH_PULL_HINT_THRESHOLD_PX &&
        verticalDistance > horizontalDistance;
      const isHorizontal =
        horizontalDistance >= TOUCH_SWIPE_HINT_THRESHOLD_PX &&
        horizontalDistance > verticalDistance;

      // When the user reverses past the committed direction the gesture is
      // effectively cancelled — visuals must drop back to idle, otherwise the
      // chevron stays armed at progress=1.0 even though pointer-up will bail.
      const resetVisual = () => {
        setTouchGestureHint(null);
        setTouchPullProgress(0);
        setTouchSwipeProgress(0);
        armIfThreshold(false);
      };

      if (isVertical) {
        // Once horizontal is committed, ignore vertical drift; symmetric below.
        if (gesture.committedHorizontalDirection) {
          return;
        }

        const direction: "down" | "up" = deltaY > 0 ? "down" : "up";

        // Downward pull from a controls-visible state has no action — bail early.
        if (direction === "down" && gesture.controlsWereVisible) {
          resetVisual();
          return;
        }

        if (!gesture.committedVerticalDirection) {
          gesture.committedVerticalDirection = direction;
        } else if (gesture.committedVerticalDirection !== direction) {
          // Reversed past start — drop back to idle so the visual matches what
          // pointer-up will actually do (nothing).
          resetVisual();
          return;
        }

        setTouchSwipeProgress(0);
        setTouchGestureHint(direction === "down" ? "controls" : "overlays");
        const progress = progressFromDistance(
          verticalDistance,
          TOUCH_PULL_HINT_THRESHOLD_PX,
          TOUCH_PULL_THRESHOLD_PX,
        );
        setTouchPullProgress(progress);
        armIfThreshold(progress >= 1);
        return;
      }

      if (isHorizontal) {
        if (gesture.committedVerticalDirection) {
          return;
        }
        const direction: "next" | "previous" = deltaX < 0 ? "next" : "previous";
        if (!gesture.committedHorizontalDirection) {
          gesture.committedHorizontalDirection = direction;
        } else if (gesture.committedHorizontalDirection !== direction) {
          // Reversed past start — drop back to idle.
          resetVisual();
          return;
        }
        setTouchGestureHint(gesture.committedHorizontalDirection);
        setTouchPullProgress(0);
        const progress = progressFromDistance(
          horizontalDistance,
          TOUCH_SWIPE_HINT_THRESHOLD_PX,
          TOUCH_SWIPE_THRESHOLD_PX,
        );
        setTouchSwipeProgress(progress);
        armIfThreshold(progress >= 1);
        return;
      }

      resetVisual();
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

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const horizontalDistance = Math.abs(deltaX);
      const verticalDistance = Math.abs(deltaY);

      // Honour the axis the visual already committed to. The move handler shows
      // the user a directional hint as soon as the hint threshold is crossed;
      // letting drift on the other axis flip the action at release would mean
      // the visual lied to them.
      const isTouchLike = isTouchOrPen(gesture.pointerType);
      const horizontalCommitted = !!gesture.committedHorizontalDirection;
      const verticalCommitted = !!gesture.committedVerticalDirection;
      // Horizontal commits stay un-gated for pointer type: a mouse drag past
      // the threshold should still navigate (advance / previous) for power
      // users who prefer drag-as-prev over the toolbar buttons. The lack of
      // mid-drag visual feedback for mouse is acceptable — the action only
      // fires at release.
      const treatAsHorizontal = horizontalCommitted
        ? horizontalDistance >= TOUCH_SWIPE_THRESHOLD_PX
        : !verticalCommitted &&
          horizontalDistance >= TOUCH_SWIPE_THRESHOLD_PX &&
          horizontalDistance > verticalDistance;
      // Vertical commits (toggle controls, cycle overlays) are touch-first UX
      // and have no progress visual for mouse — gating on touch/pen avoids a
      // mouse drag-up silently hiding the toolbar.
      const treatAsVertical =
        isTouchLike &&
        (verticalCommitted
          ? verticalDistance >= TOUCH_SWIPE_THRESHOLD_PX
          : !horizontalCommitted &&
            verticalDistance >= TOUCH_SWIPE_THRESHOLD_PX &&
            verticalDistance > horizontalDistance);

      if (treatAsHorizontal) {
        const committed = gesture.committedHorizontalDirection;
        const finalDirection = deltaX < 0 ? "next" : "previous";
        const effectiveDirection = committed ?? finalDirection;

        // If the user dragged back past the start in the opposite direction,
        // treat it as a cancelled gesture — do not trigger the opposite action.
        if (committed && finalDirection !== committed) {
          return;
        }

        suppressImageClickRef.current = true;

        if (effectiveDirection === "next") {
          advanceToNextPhoto();
          return;
        }

        goPrevious();
        return;
      }

      if (treatAsVertical) {
        const committed = gesture.committedVerticalDirection;
        const finalDirection: "down" | "up" = deltaY > 0 ? "down" : "up";
        // Drag-back cancel: if the user reversed direction past the start,
        // do not trigger the opposite action.
        if (committed && finalDirection !== committed) {
          return;
        }

        const effectiveDirection = committed ?? finalDirection;

        if (effectiveDirection === "down") {
          if (!gesture.controlsWereVisible) {
            suppressImageClickRef.current = true;
            setControlsVisible(true);
          }
          return;
        }

        suppressImageClickRef.current = true;
        if (gesture.controlsWereVisible) {
          controlsHideDeadlineRef.current = null;
          setControlsVisible(false);
          return;
        }
        cycleTouchOverlays();
        return;
      }

      if (isTouchLike) {
        // The browser synthesises a click after every touch pointerup. Without
        // this suppression a mid-distance jitter (12-48px) or a reversed-cancel
        // gesture would fall through every action branch above and then
        // silently advance the photo via the image's onClick — making the
        // cancellation visual a lie. Set the suppress ref unconditionally for
        // touch/pen so the synthetic click swallows itself. The commit branches
        // already set it; setting it again is idempotent.
        suppressImageClickRef.current = true;

        if (horizontalDistance < 12 && verticalDistance < 12) {
          const imageBounds = event.currentTarget.getBoundingClientRect();
          const tapAction = getSlideshowTouchTapAction({
            clientX: event.clientX,
            bounds: imageBounds,
            canGoPrevious,
          });

          if (tapAction === "previous") {
            goPrevious();
            return;
          }

          advanceToNextPhoto();
        }
      }
    },
    [
      advanceToNextPhoto,
      canGoPrevious,
      clearImagePointerGesture,
      cycleTouchOverlays,
      goPrevious,
    ],
  );

  // After the user explicitly presses Hide, their cursor is almost always
  // still over the top-edge trigger zone — without this cooldown the next
  // mouseenter/mousemove on that zone immediately re-opens the toolbar.
  // The suppression lasts long enough for the user to move the cursor down
  // off the trigger area.
  const suppressDesktopShowUntilRef = React.useRef(0);

  const showControlsForDesktop = useCallback(() => {
    if (isCoarsePointer) {
      return;
    }
    if (Date.now() < suppressDesktopShowUntilRef.current) {
      return;
    }
    setControlsVisible(true);
  }, [isCoarsePointer]);

  const hideDesktopControls = useCallback(() => {
    controlsHideDeadlineRef.current = null;
    suppressDesktopShowUntilRef.current = Date.now() + 700;
    setControlsVisible(false);
  }, []);

  const getCurrentPhotoLink = useCallback((): string | null => {
    const photoPath = currentPhotoPathRef.current?.path;
    if (!photoPath) {
      return null;
    }

    const url = new URL("/slideshow", window.location.origin);
    url.searchParams.set("mode", slideshowMode);
    if (filter) {
      url.searchParams.set("filter", filter);
    }
    url.searchParams.set("photo", photoPath);
    return url.toString();
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

  const activePhotoSrc = getSlideshowPhotoSrc(currentPhotoPath);

  useEffect(() => {
    if (!activePhotoSrc) {
      activePhotoSrcRef.current = null;
       
      setPreviousPhotoSrc(null);
      return;
    }

    const previousPhotoSrc = activePhotoSrcRef.current;

    if (previousPhotoSrc && previousPhotoSrc !== activePhotoSrc) {
      setPreviousPhotoSrc(previousPhotoSrc);
      setImageLoaded(false);
    }

    activePhotoSrcRef.current = activePhotoSrc;
  }, [activePhotoSrc]);

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

  const extractGeocodeLabel = (geocode: string): string | null =>
    geocode
      ? geocode
          .split("\n")
          .slice(-3)
          .filter((x) => Number.isNaN(parseFloat(x)))
          .join(", ") || null
      : null;

  // Per-photo metadata for the whole slide (seed + any remix companions).
  // Each photo gets its own description block rendered in the slide-bottom
  // row, so the same component scales from 1 to N cells without aggregation.
  const slidePhotos = [currentPhotoPath, ...remixCompanions];
  const slidePhotoMeta = slidePhotos.map((photo) => ({
    path: photo.path,
    date: extractDateFromExifString(photo.exif),
    geocode: extractGeocodeLabel(photo.geocode),
    coords: extractGPSFromExifString(photo.exif),
  }));

  // Per-photo description: just the geocode + date + (optionally) the
  // time-affinity row. No chrome (map / clock / strategy badge) — those
  // are slide-level and rendered once below.
  const renderPhotoDescription = (
    meta: (typeof slidePhotoMeta)[number],
  ) => {
    const photoDate = meta.date;
    const photoGeocode = meta.geocode;
    const photoRelative = photoDate ? getRelativeTimeString(photoDate) : null;

    return (
      <div
        className={[
          styles.details,
          styles.displaySetting,
          showDetails ? styles.displaySettingActive : "",
        ].join(" ")}
      >
        {photoGeocode ? (
          <div className={styles.detailsRow}>{photoGeocode}</div>
        ) : (
          <div className={styles.detailsRow}>&nbsp;</div>
        )}

        {photoDate ? (
          <div className={styles.detailsRow}>
            {photoRelative ? `${photoRelative} · ` : ""}
            {photoDate.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })}
          </div>
        ) : (
          <div className={styles.detailsRow}>&nbsp;</div>
        )}

        {timeAware && photoDate ? (
          <div
            className={[styles.detailsRow, styles.detailsAffinity].join(" ")}
          >
            🌅 {Math.round(getTimeAffinityScore(photoDate) * 100)}% match
          </div>
        ) : null}
      </div>
    );
  };

  // Map zone (placed above descriptions in the grid). The actual MMap
  // (which is a heavy WebGL context) is only mounted when `mountMap` is
  // true — the text layer of the dual-render passes false so it just
  // gets the empty wrapper for layout parity. That cuts the per-slide
  // WebGL context lifecycles in half on a long-running sideboard session.
  const renderSlideMap = (mountMap: boolean) => {
    const allCoords = slidePhotoMeta
      .map((m) => m.coords)
      .filter((c): c is [number, number] => !!c);
    if (allCoords.length === 0) return null;
    return (
      <div
        className={[
          styles.mapContainer,
          styles.displaySetting,
          showMap ? styles.displaySettingActive : "",
        ].join(" ")}
        style={{ mixBlendMode: "screen" }}
      >
        {mountMap ? (
          <MMap
            coordinates={allCoords.length === 1 ? allCoords[0] : allCoords}
            attribution={false}
            details={false}
            style={{ width: "100%", height: "100%" }}
            mapStyle="toner-v2"
            projection="vertical-perspective"
            markerStyle={{ visibility: "hidden" }}
          />
        ) : null}
      </div>
    );
  };

  // Clock zone (placed below descriptions). Optionally includes the
  // remix strategy badge above the time/date.
  const renderSlideClock = () => {
    const remixStrategyLabel: Record<RemixStrategy, string> = {
      "same-album": "from this album",
      "same-year": "from the same year",
      "same-decade": "from the same decade",
      "same-region": "from the same place",
      "same-time-of-day": "shot around the same hour",
      anniversary: "from this week, other years",
      proximity: "shot nearby",
      "golden-hour": "shot at golden hour",
      juxtapose: "deliberately juxtaposed",
      similar: "visually similar",
      random: "picked at random",
    };
    const isRemix = remixCompanions.length > 0;
    return (
      <>
        {isRemix && remixStrategy ? (
          <div
            className={[styles.detailsRow, styles.detailsAffinity].join(" ")}
          >
            ◫ Remix · {slidePhotos.length} photos{" "}
            {remixStrategyLabel[remixStrategy]}
          </div>
        ) : null}

        <div
          className={[
            styles.clock,
            styles.displaySetting,
            showClock ? styles.displaySettingActive : "",
          ].join(" ")}
        >
          <div className={styles.time}>
            {time.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "numeric",
              hour12: false,
            })}
          </div>
          <div className={styles.date}>
            {time.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </>
    );
  };

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
            <div className={styles.touchTopAffordance}>
              <span className={styles.touchPullHandle} />
              <span className={styles.touchPullChevron}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
            <div className={styles.touchBottomAffordance}>
              <span className={styles.touchAffordanceLabel}>
                {controlsVisible ? "Close settings" : nextOverlayLabel}
              </span>
              <span className={styles.touchPullChevron}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className={styles.touchPullHandle} />
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

        <div
          className={styles.toolbar}
          onFocusCapture={showControlsForDesktop}
          onBlur={() => {
            setIsPointerOverToolbar(false);
          }}
          onMouseEnter={() => {
            setIsPointerOverToolbar(true);
          }}
          onMouseLeave={() => {
            setIsPointerOverToolbar(false);
          }}
        >
          {/* <ThemeToggle /> */}

          {/* On a coarse-pointer / kiosk install this link is an easy escape
              hatch out of the slideshow; hiding it removes that footgun while
              keeping it for desktop where it acts as an obvious nav element. */}
          {!isCoarsePointer ? (
            <Link className={styles.brandLink} href="/">
              <span className={styles.brandLogo} aria-hidden="true">
                🖼️
              </span>
              <span className={styles.brandCopy}>
                <span className={styles.brandTitle}>Snapshots</span>
                <span className={styles.brandSubtitle}>Slideshow</span>
              </span>
            </Link>
          ) : null}

          <div
            className={styles.playbackGroup}
            role="group"
            aria-label="Playback mode"
          >
            <div className={styles.playbackHeader}>
              <span className={styles.playbackLogo} aria-hidden="true">
                ⟲
              </span>
              <span className={styles.playbackCopy}>
                <span className={styles.playbackTitle}>Playback</span>
                <span className={styles.playbackSubtitle}>
                  {playbackSubtitle}
                </span>
              </span>
            </div>

            <div className={styles.playbackButtons}>
              <button
                className={[
                  slideshowMode === "random" ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={slideshowMode === "random"}
                onClick={() => {
                  setSlideshowModeAndUrl("random");
                }}
              >
                🔀 Shuffle
              </button>

              <button
                className={[
                  slideshowMode === "weighted" ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={slideshowMode === "weighted"}
                onClick={() => {
                  setSlideshowModeAndUrl("weighted");
                }}
              >
                🕒 Recent
              </button>

              <button
                className={[
                  slideshowMode === "similar" ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={slideshowMode === "similar"}
                onClick={() => {
                  setSlideshowModeAndUrl("similar");
                }}
              >
                🧭 Similar
              </button>

              <span className={styles.playbackDivider} aria-hidden="true" />

              <button
                className={[
                  timeAware ? commonStyles.active : "",
                  styles.playbackModifier,
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={timeAware}
                title="Bias the shuffle toward photos taken near the current hour and month"
                onClick={() => setTimeAware(!timeAware)}
              >
                🌅 Time-of-day
              </button>

              <button
                className={[
                  remixEnabled ? commonStyles.active : "",
                  styles.playbackModifier,
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={remixEnabled}
                title="Occasionally show two or three photos side by side at random"
                onClick={() => setRemixEnabled(!remixEnabled)}
              >
                ◫ Remix
              </button>

              <span className={styles.playbackDivider} aria-hidden="true" />

              <button
                className={commonStyles.button}
                title="Force the next advance to be a remix slide (ignores the 3% dice)"
                onClick={() => {
                  forceRemixRef.current = true;
                  advanceToNextPhoto();
                }}
              >
                ◫ Remix now
              </button>

              <button
                className={[
                  isPaused ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={isPaused}
                onClick={togglePaused}
              >
                {isPaused ? "▶ Resume" : "⏸ Pause"}
              </button>

              <button
                className={commonStyles.button}
                disabled={!canGoPrevious}
                aria-disabled={!canGoPrevious}
                onClick={() => {
                  setImageLoaded(false);
                  goPrevious();
                }}
              >
                Previous
              </button>

              <button
                className={commonStyles.button}
                onClick={() => {
                  advanceToNextPhoto();
                }}
              >
                Next
              </button>

              <span className={styles.playbackHideGroup}>
                <button
                  className={commonStyles.button}
                  onClick={hideDesktopControls}
                >
                  Hide
                </button>

                <div
                  className={styles.hideProgress}
                  aria-hidden="true"
                  style={
                    {
                      "--hide-progress": String(
                        Math.max(0, Math.min(1, controlsHideProgress)),
                      ),
                    } as React.CSSProperties
                  }
                >
                  <div className={styles.hideProgressRing} />
                </div>
              </span>
            </div>
          </div>

          <div
            className={styles.controlGroup}
            role="group"
            aria-label="Display controls"
          >
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ✦
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Display</span>
              </span>
            </div>

            <div className={styles.controlButtons}>
              <button
                className={[
                  showClock ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={showClock}
                onClick={() => setShowClock(!showClock)}
              >
                🕰️
              </button>

              <button
                className={[
                  showDetails ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                Details
              </button>

              <button
                className={[
                  showMap ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={showMap}
                onClick={() => setShowMap(!showMap)}
              >
                Map
              </button>

              <button
                className={[
                  detailsAlignment !== "center" ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                onClick={cycleAlignment}
              >
                📍{" "}
                {detailsAlignment.charAt(0).toUpperCase() +
                  detailsAlignment.slice(1)}
              </button>
            </div>
          </div>

          <div
            className={styles.controlGroup}
            role="group"
            aria-label="View controls"
          >
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ⛶
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>View</span>
              </span>
            </div>

            <div className={styles.controlButtons}>
              <button
                className={[
                  showCover ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={showCover}
                title={
                  showCover
                    ? "Photos fill the screen (cropping). Tap to switch to fit."
                    : "Photos fit the screen (letterboxed). Tap to switch to fill."
                }
                onClick={() => setShowCover(!showCover)}
              >
                ⛶ Fill screen
              </button>

              {!isFullscreenActive ? (
                <button
                  className={commonStyles.button}
                  disabled={!isFullscreenSupported}
                  aria-disabled={!isFullscreenSupported}
                  onClick={() => {
                    handleFullscreenToggle().catch(console.error);
                  }}
                >
                  ⇱ Fullscreen
                </button>
              ) : null}

              <button
                className={[
                  isWakeLockActive ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                disabled={!isWakeLockSupported}
                aria-disabled={!isWakeLockSupported}
                aria-pressed={isWakeLockActive}
                title={
                  isWakeLockSupported
                    ? "Try to acquire a wake lock for this slideshow session"
                    : "Screen wake lock is not available in this browser"
                }
                onClick={() => {
                  tryAcquireWakeLock().catch(console.error);
                }}
              >
                {isWakeLockActive ? "Wake lock active" : "Try awake lock"}
              </button>
            </div>
          </div>

          <div
            className={styles.controlGroup}
            role="group"
            aria-label="Timing controls"
          >
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ⏱
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Timing</span>
              </span>
            </div>

            <div className={styles.controlButtons}>
              {(() => {
                const shortTimings = [10000, 30000, 60000, 900000, 3600000];
                const longTimings = [10800000, 43200000, 86400000];
                // Kiosk-extreme cadences (3h+, 12h, 24h) are kept available but
                // hidden by default behind a "More" disclosure. They're auto-
                // revealed when the active delay is one of them so the user
                // can always see what's selected.
                const activeIsLong = longTimings.includes(timeDelay);
                const visible = showLongTimings || activeIsLong
                  ? [...shortTimings, ...longTimings]
                  : shortTimings;

                const buttons = visible.map((delay) => {
                  const delayMin = delay / 1000 / 60;
                  const delaySec = delay / 1000;
                  return (
                    <button
                      key={delay}
                      className={[
                        commonStyles.button,
                        delay === timeDelay ? commonStyles.active : "",
                      ].join(" ")}
                      aria-pressed={delay === timeDelay}
                      onClick={() => setTimeDelayAndUrl(delay)}
                    >
                      {delayMin >= 60
                        ? `${delayMin / 60}h`
                        : delayMin < 1
                          ? `${delaySec}s`
                          : `${delayMin}m`}
                    </button>
                  );
                });

                return (
                  <>
                    {buttons}
                    {!activeIsLong ? (
                      <button
                        className={[
                          commonStyles.button,
                          showLongTimings ? commonStyles.active : "",
                        ].join(" ")}
                        aria-pressed={showLongTimings}
                        aria-label={
                          showLongTimings
                            ? "Hide longer cadences"
                            : "Show longer cadences (3h, 12h, 24h)"
                        }
                        title={
                          showLongTimings
                            ? "Hide longer cadences"
                            : "Show longer cadences (3h, 12h, 24h)"
                        }
                        onClick={() => setShowLongTimings(!showLongTimings)}
                      >
                        {showLongTimings ? "Less" : "More…"}
                      </button>
                    ) : null}
                  </>
                );
              })()}
            </div>

            <div className={styles.controlMeta}>
              <div className={commonStyles.toast}>
                🔁 {secondsLeft >= 3600
                  ? `${Math.floor(secondsLeft / 3600)}h ${Math.floor((secondsLeft % 3600) / 60)}m`
                  : secondsLeft >= 60
                    ? `${Math.floor(secondsLeft / 60)}m ${Math.floor(secondsLeft % 60)}s`
                    : `${Math.floor(secondsLeft)}s`}
              </div>
              <button
                className={[
                  alignCadence ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                type="button"
                aria-pressed={alignCadence}
                title="When on, advances snap to wall-clock boundaries (e.g. :00 / :15 / :30 / :45 for a 15-minute cadence) instead of drifting from the moment you opened the app"
                onClick={() => {
                  const next = !alignCadence;
                  setAlignCadence(next);
                  if (next) {
                    alignNextChangeToCadence();
                  }
                }}
              >
                {alignCadence ? "Aligned" : "Align"}
              </button>
            </div>
          </div>

          <div
            className={styles.controlGroup}
            role="group"
            aria-label="Current photo context"
          >
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                📎
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Context</span>
              </span>
            </div>

            <div className={styles.controlMeta}>
              {filter ? (
                <div className={commonStyles.toast}>
                  only showing photos from{" "}
                  <Link href={`/album/${filter}`}>
                    <i>{filter}</i>
                  </Link>
                </div>
              ) : null}

              <Link
                href={`/album/${albumName}#${photoName}`}
                className={commonStyles.toast}
              >
                {playbackContextLabel} in <i>{albumName}</i>
              </Link>

              <button
                className={commonStyles.button}
                type="button"
                onClick={() => {
                  void copyCurrentPhotoLink();
                }}
              >
                {copiedPhotoLink ? "copied photo link" : "copy photo link"}
              </button>
            </div>
          </div>
        </div>

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
        {[true, false].map((isMapLayer) => (
          <div
            key={isMapLayer ? "map" : "text"}
            className={styles.bottomBarStack}
            data-count={slidePhotos.length}
            data-align={detailsAlignment}
            style={isMapLayer ? { mixBlendMode: "screen" } : undefined}
          >
            <div
              className={styles.slideMap}
              style={{
                gridArea: "map",
                visibility: isMapLayer ? "visible" : "hidden",
              }}
            >
              {renderSlideMap(isMapLayer)}
            </div>
            {slidePhotos.map((photo, idx) => (
              <div
                key={`${photo.path}-${idx}`}
                className={styles.descriptionCell}
                style={{
                  gridArea: `desc${idx}`,
                  visibility: isMapLayer ? "hidden" : "visible",
                }}
              >
                {renderPhotoDescription(slidePhotoMeta[idx])}
              </div>
            ))}
            <div
              className={styles.slideClock}
              style={{
                gridArea: "clock",
                visibility: isMapLayer ? "hidden" : "visible",
              }}
            >
              {renderSlideClock()}
            </div>
          </div>
        ))}

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
            className={styles.remixGrid}
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
            {slidePhotoMeta.map((_meta, idx) => {
              const photo = slidePhotos[idx];
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
                    onLoad={
                      isSeed
                        ? () => {
                            setImageLoaded(true);
                            window.setTimeout(() => {
                              setPreviousPhotoSrc(null);
                            }, 260);
                          }
                        : undefined
                    }
                    onError={
                      isSeed
                        ? () => {
                            setTimeout(() => {
                              advanceToNextPhoto();
                            }, 1000);
                          }
                        : undefined
                    }
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
