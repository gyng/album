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
import { navigateTo } from "../../util/navigate";
import { handleSlideshowKeyboardShortcut } from "../../util/slideshowKeyboard";

type PageProps = {};
type SlideshowMode = "random" | "weighted" | "similar";

const avoidBoundaryRepeat = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  if (
    previousLastPath &&
    photos.length > 1 &&
    photos[0]?.path === previousLastPath
  ) {
    const swapIdx = photos.findIndex((photo) => photo.path !== previousLastPath);
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
      const timestamp = extractDateFromExifString(photo.exif)?.getTime() ?? null;
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

const SlideshowPage: NextPage<PageProps> = (props) => {
  return <Slideshow />;
};

// TODO: consider doing getStaticProps here to fetch all photos and pass them to the slideshow
// like in world map
const Slideshow: React.FC<{ disabled?: boolean }> = (props) => {
  const [database, progress] = useDatabase();
  const buildIdRef = React.useRef<string | null>(null);
  const initialPhotoPathRef = React.useRef<string | null>(null);
  const randomSimilarRequestedRef = React.useRef(false);
  const similarSeedPathRef = React.useRef<string | null>(null);
  const similarQueueRef = React.useRef<RandomPhotoRow[]>([]);
  const similarQueueIndexRef = React.useRef<number>(-1);
  const similarQueueLastPathRef = React.useRef<string | undefined>(undefined);

  // Check for a new build and reload when one is detected.
  useEffect(() => {
    buildIdRef.current =
      (window as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__
        ?.buildId ?? null;

    const checkForNewBuild = async () => {
      try {
        const response = await fetch("/_next/static/BUILD_ID", {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const latestBuildId = (await response.text()).trim();
        if (buildIdRef.current && latestBuildId !== buildIdRef.current) {
          window.location.reload();
        }
      } catch (error) {
        console.error(error);
      }
    };

    checkForNewBuild();
    const id = setInterval(checkForNewBuild, 300000);
    return () => clearInterval(id);
  }, []);

  // reload page every 1 day to force load of new code regardless as fallback
  useEffect(() => {
    const id = setInterval(() => {
      window.location.reload();
    }, 86400000);
    return () => clearInterval(id);
  }, []);

  const [currentPhotoPath, setCurrentPhotoPath] =
    React.useState<RandomPhotoRow | null>(null);
  const currentPhotoPathRef = React.useRef<RandomPhotoRow | null>(null);
  const randomPhotoPoolRef = React.useRef<RandomPhotoRow[]>([]);
  const randomQueueRef = React.useRef<RandomPhotoRow[]>([]);
  const randomQueueIndexRef = React.useRef<number>(-1);
  const randomQueueLastPathRef = React.useRef<string | undefined>(undefined);
  const navigationHistoryRef = React.useRef<RandomPhotoRow[]>([]);
  const historyIndexRef = React.useRef<number>(-1);
  const [slideshowError, setSlideshowError] = React.useState<string | null>(
    null,
  );
  const [historyPosition, setHistoryPosition] = React.useState({
    index: -1,
    total: 0,
  });

  const [timeDelay, setTimeDelay, removeTimeDelay] = useLocalStorage(
    "slideshow-timedelay",
    30000,
  );
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

  const [nextChangeAt, setNextChangeAt] = React.useState<Date>(new Date());
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [time, setTime] = React.useState<Date>(new Date());

  const [imageLoaded, setImageLoaded] = React.useState<boolean>(false);

  // Use this to force a clear
  const [nextCounter, setNextCounter] = React.useState<number>(0);

  const [filter, setFilter] = React.useState<string | undefined>(undefined);
  const recentPhotoPathsRef = React.useRef<string[]>([]);
  const [shuffleHistorySize, setShuffleHistorySize, removeShuffleHistorySize] =
    useLocalStorage("slideshow-shuffle-history-size", 100);
  const [slideshowMode, setSlideshowMode] = useLocalStorage(
    "slideshow-mode",
    "random" as SlideshowMode,
  );
  const [hasParsedInitialUrl, setHasParsedInitialUrl] = React.useState(false);
  const [isPaused, setIsPaused] = React.useState(false);
  const [embeddingsDatabase, embeddingsProgress] = useEmbeddingsDatabase(
    slideshowMode === "similar",
  );

  const updateSlideshowUrl = useCallback(
    (
      mode: SlideshowMode,
      opts?: { photoPath?: string | null; clearPhoto?: boolean },
    ) => {
    const url = new URL(window.location.toString());
    url.searchParams.set("mode", mode);

      const hasExplicitPhotoPath = Object.prototype.hasOwnProperty.call(
        opts ?? {},
        "photoPath",
      );
      const nextPhotoPath = hasExplicitPhotoPath
        ? opts?.photoPath ?? null
        : currentPhotoPathRef.current?.path ?? null;

      if (nextPhotoPath) {
        url.searchParams.set("photo", nextPhotoPath);
      } else if (opts?.clearPhoto) {
        url.searchParams.delete("photo");
      }

      if (mode === "similar") {
        if (nextPhotoPath) {
          url.searchParams.set("seed", nextPhotoPath);
        } else if (opts?.clearPhoto) {
          url.searchParams.delete("seed");
        }
      } else {
        url.searchParams.delete("seed");
      }

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

  /**
   * URL Search Parameters for Slideshow Configuration
   *
   * Boolean parameters (accept: 1, true, yes, on):
   *   - clock=1        Show clock display
   *   - details=1      Show photo details (location, date)
   *   - map=1          Show map with GPS coordinates
   *   - cover=1        Use cover mode (vs contain)
   *
   * Other parameters:
    *   - mode=random|weighted|similar Slideshow playback mode
    *   - photo=<photo-path>          Start on a specific photo and keep the URL synced to the current image
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
      setTimeDelay(delayParam * 1000);
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
  ]);

  const commitNextPhoto = useCallback(
    (candidatePhoto: RandomPhotoRow, opts?: { trackRecent?: boolean }) => {
      if (opts?.trackRecent) {
        recentPhotoPathsRef.current = [
          candidatePhoto.path,
          ...recentPhotoPathsRef.current,
        ].slice(0, shuffleHistorySize);
      }

      const nextHistory = [
        ...navigationHistoryRef.current.slice(0, historyIndexRef.current + 1),
        candidatePhoto,
      ];

      navigationHistoryRef.current = nextHistory;
      historyIndexRef.current = nextHistory.length - 1;
      setHistoryPosition({
        index: historyIndexRef.current,
        total: nextHistory.length,
      });

      currentPhotoPathRef.current = candidatePhoto;
      setCurrentPhotoPath(candidatePhoto);
      setSlideshowError(null);
      setNextChangeAt(new Date(Date.now() + timeDelay));
    },
    [shuffleHistorySize, timeDelay],
  );

  const showHistoryPhoto = useCallback(
    (index: number): RandomPhotoRow | null => {
      const candidatePhoto = navigationHistoryRef.current[index] ?? null;
      if (!candidatePhoto) {
        return null;
      }

      historyIndexRef.current = index;
      setHistoryPosition({
        index,
        total: navigationHistoryRef.current.length,
      });

      currentPhotoPathRef.current = candidatePhoto;
      setCurrentPhotoPath(candidatePhoto);
      setSlideshowError(null);
      setNextChangeAt(new Date(Date.now() + timeDelay));
      return candidatePhoto;
    },
    [timeDelay],
  );

  const refillRandomQueue = useCallback((): RandomPhotoRow[] => {
    const nextQueue =
      slideshowMode === "weighted"
        ? weightedShufflePhotos(
            randomPhotoPoolRef.current,
            randomQueueLastPathRef.current,
          )
        : shufflePhotos(
            randomPhotoPoolRef.current,
            randomQueueLastPathRef.current,
          );

    randomQueueRef.current = nextQueue;
    randomQueueIndexRef.current = -1;
    return nextQueue;
  }, [slideshowMode]);

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
      commitNextPhoto(nextPhoto, opts);
      return nextPhoto;
    },
    [commitNextPhoto, refillRandomQueue],
  );

  useEffect(() => {
    if (!hasParsedInitialUrl) {
      return;
    }

    updateSlideshowUrl(slideshowMode);
  }, [currentPhotoPath?.path, hasParsedInitialUrl, slideshowMode, updateSlideshowUrl]);

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
          updateSlideshowUrl(slideshowMode, { photoPath: null, clearPhoto: true });
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
            photos.find((photo) => photo.path === initialPhotoPathRef.current) ??
            null;

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
          updateSlideshowUrl(slideshowMode, { photoPath: null, clearPhoto: true });
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
    updateSlideshowUrl,
  ]);

  const advanceSimilarPhoto = useCallback(async (): Promise<RandomPhotoRow | null> => {
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
          const isRecent = recentPhotoPathsRef.current.includes(candidate.path);
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

    if (similarSeedPathRef.current !== activePhoto.path || nextIndex >= queue.length) {
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
    commitNextPhoto(nextPhoto, { trackRecent: true });
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

  const goRandom = useCallback(() => {
    if (!database) {
      return;
    }

    resetSimilarQueue();
    setSlideshowModeAndUrl("random");
    advanceRandomPhoto();
  }, [advanceRandomPhoto, database, resetSimilarQueue, setSlideshowModeAndUrl]);

  useEffect(() => {
    if (slideshowMode === "similar") {
      randomQueueRef.current = [];
      randomQueueIndexRef.current = -1;

      if (currentPhotoPathRef.current) {
        navigationHistoryRef.current = [currentPhotoPathRef.current];
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

  useEffect(() => {
    if (isPaused) return;
    goNext();
    const id = setInterval(goNext, timeDelay);
    return () => clearInterval(id);
  }, [database, timeDelay, nextCounter, goNext, isPaused]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleSlideshowKeyboardShortcut(e, {
        goNext: () => {
          setImageLoaded(false);
          setNextCounter((prev) => prev + 1);
        },
        goPrevious: () => {
          setImageLoaded(false);
          goPrevious();
        },
        togglePaused: () => {
          setIsPaused((prev) => !prev);
        },
        exit: () => {
          navigateTo("/");
        },
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goPrevious]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((nextChangeAt.getTime() - Date.now()) / 1000);
      setTime(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, [nextChangeAt]);

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
      src: currentPhotoPath
        ? `/data/albums/${albumName}/.resized_images/${photoName}@3200.avif`
        : "",
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

  const exifDate = currentPhotoPath.exif
    ? extractDateFromExifString(currentPhotoPath.exif)
    : null;
  const relativeDate = exifDate ? getRelativeTimeString(exifDate) : null;

  // Get coordinates from EXIF GPS data instead of geocoded location
  const coordinates = currentPhotoPath?.exif
    ? extractGPSFromExifString(currentPhotoPath.exif)
    : null;

  // Keep geocoded location for display purposes (country/region name)
  const geocodeCountry = currentPhotoPath?.geocode
    ? currentPhotoPath.geocode
        .split("\n")
        .slice(-3)
        .filter((x) => Number.isNaN(parseFloat(x)))
        .join(", ")
    : null;

  const detailsElement = (isMapHack: boolean) => (
    <>
      {isMapHack && showMap ? (
        <div className={styles.mapContainer}>
          {coordinates ? (
            <MMap
              coordinates={coordinates}
              attribution={false}
              details={false}
              style={{ width: "100%", height: "100%" }}
              mapStyle="toner-v2"
              projection="vertical-perspective"
              markerStyle={{ visibility: "hidden" }}
            />
          ) : (
            <div className={styles.mapContainer}>&nbsp;</div>
          )}
        </div>
      ) : null}

      {showDetails ? (
        <div
          className={[styles.details, isMapHack ? styles.hide : ""].join(" ")}
        >
          {geocodeCountry ? (
            <div className={styles.detailsRow}>{geocodeCountry}</div>
          ) : (
            <div className={styles.detailsRow}>&nbsp;</div>
          )}

          {relativeDate ? (
            <div className={styles.detailsRow}>
              {relativeDate} &middot;{" "}
              {exifDate?.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
              })}
            </div>
          ) : (
            <div className={styles.detailsRow}>&nbsp;</div>
          )}
        </div>
      ) : null}

      {showClock ? (
        <div className={[styles.clock, isMapHack ? styles.hide : ""].join(" ")}>
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
      ) : null}
    </>
  );

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

      <div className={styles.container} data-paused={String(isPaused)}>
        <div className={[styles.toolbar, commonStyles.topBar].join(" ")}>
          {/* <ThemeToggle /> */}

          <Link className={styles.brandLink} href="/">
            <span className={styles.brandLogo} aria-hidden="true">
              🖼️
            </span>
            <span className={styles.brandCopy}>
              <span className={styles.brandTitle}>Snapshots</span>
              <span className={styles.brandSubtitle}>Slideshow</span>
            </span>
          </Link>

          <div className={styles.playbackGroup} role="group" aria-label="Playback mode">
            <div className={styles.playbackHeader}>
              <span className={styles.playbackLogo} aria-hidden="true">
                ⟲
              </span>
              <span className={styles.playbackCopy}>
                <span className={styles.playbackTitle}>Playback</span>
                <span className={styles.playbackSubtitle}>{playbackSubtitle}</span>
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
                className={commonStyles.button}
                onClick={() => {
                  setImageLoaded(false);
                  goRandom();
                }}
              >
                🎲 Random
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
                  setImageLoaded(false);
                  setNextCounter((prev) => prev + 1);
                }}
              >
                Next
              </button>
            </div>
          </div>

          <div className={styles.controlGroup} role="group" aria-label="Display controls">
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ✦
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Display</span>
                <span className={styles.controlSubtitle}>Overlays and placement</span>
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

          <div className={styles.controlGroup} role="group" aria-label="View controls">
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ⛶
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>View</span>
                <span className={styles.controlSubtitle}>Frame and screen mode</span>
              </span>
            </div>

            <div className={styles.controlButtons}>
              <button
                className={[
                  showCover ? commonStyles.active : "",
                  commonStyles.button,
                ].join(" ")}
                aria-pressed={showCover}
                onClick={() => setShowCover(!showCover)}
              >
                {showCover ? "Cover" : "Contain"}
              </button>

              <button
                className={commonStyles.button}
                onClick={() => {
                  if (document.fullscreenElement) {
                    document.exitFullscreen();
                  } else {
                    document.documentElement.requestFullscreen();
                  }
                }}
              >
                ⇱ Fullscreen
              </button>
            </div>
          </div>

          <div className={styles.controlGroup} role="group" aria-label="Timing controls">
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                ⏱
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Timing</span>
                <span className={styles.controlSubtitle}>Slide cadence</span>
              </span>
            </div>

            <div className={styles.controlButtons}>
              {[10000, 60000, 900000, 3600000, 10800000, 43200000, 86400000].map(
                (delay) => {
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
                      onClick={() => setTimeDelay(delay)}
                    >
                      {delayMin >= 60
                        ? `${delayMin / 60}h`
                        : delayMin < 1
                          ? `${delaySec}s`
                          : `${delayMin}m`}
                    </button>
                  );
                },
              )}
            </div>

            <div className={styles.controlMeta}>
              <div className={commonStyles.toast}>🔁 {secondsLeft.toFixed(0)}s</div>
            </div>
          </div>

          <div className={styles.controlGroup} role="group" aria-label="Current photo context">
            <div className={styles.controlHeader}>
              <span className={styles.controlLogo} aria-hidden="true">
                📎
              </span>
              <span className={styles.controlCopy}>
                <span className={styles.controlTitle}>Context</span>
                <span className={styles.controlSubtitle}>Album and filter links</span>
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
                {playbackContextLabel} in{" "}
                <i>{albumName}</i>
              </Link>

              <Link
                href={`/album/${albumName}#${photoName}`}
                className={commonStyles.toast}
              >
                view photo in <i>{albumName}</i>
              </Link>
            </div>
          </div>
        </div>

        {/* Hack: render the elements twice so we can get a different context
        to get mix-blend-mode working on ONLY the map and not on the text.
        However we still want the positioning of the map to to be handled by the box model,
        so we render details twice (but hide with visibility: hidden). We need a different
        context because the drop shadows disappear when mix-blend-mode is applied.
        */}
        {showClock || showDetails || showMap ? (
          <>
            <div
              className={[
                styles.bottomBar,
                styles[
                  `align${detailsAlignment.charAt(0).toUpperCase() + detailsAlignment.slice(1)}`
                ],
              ].join(" ")}
              style={{ mixBlendMode: "screen" }}
            >
              {detailsElement(true)}
            </div>
            <div
              className={[
                styles.bottomBar,
                styles[
                  `align${detailsAlignment.charAt(0).toUpperCase() + detailsAlignment.slice(1)}`
                ],
              ].join(" ")}
            >
              {detailsElement(false)}
            </div>
          </>
        ) : null}

        <img
          className={[
            styles.image,
            !imageLoaded ? styles.notLoaded : "",
            showCover ? styles.cover : "",
          ].join(" ")}
          src={photoBlock.data.src}
          alt={getPhotoAltText(photoBlock, "Slideshow photo")}
          onLoad={() => {
            setImageLoaded(true);
          }}
          onError={() => {
            // Skip bad images to avoid showing broken image on displays
            setTimeout(() => {
              setNextCounter((prev) => prev + 1);
            }, 1000);
          }}
          onClick={() => {
            setImageLoaded(false);
            setNextCounter((prev) => prev + 1);
          }}
        />
      </div>
    </>
  );
};

export default SlideshowPage;
