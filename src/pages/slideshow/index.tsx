import { NextPage } from "next/types";
import React, { useEffect, useCallback } from "react";
import { useDatabase } from "../../components/database/useDatabase";
import { PhotoBlock } from "../../services/types";
import {
  fetchSlideshowPhotos,
  fetchSimilarResults,
  RandomPhotoRow,
} from "../../components/search/api";
import { ProgressBar } from "../../components/ProgressBar";
import styles from "./slideshow.module.css";
import commonStyles from "../../styles/common.module.css";
import { ThemeToggle } from "../../components/ThemeToggle";
import Link from "next/link";
import Head from "next/head";
import { useLocalStorage } from "usehooks-ts";
import { getRelativeTimeString } from "../../util/time";
import {
  extractDateFromExifString,
  extractGPSFromExifString,
} from "../../util/extractExifFromDb";
import MMap from "../../components/Map";

type PageProps = {};
type SlideshowMode = "random" | "similar";

const shufflePhotos = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  const shuffled = [...photos];

  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const randomIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[randomIdx]] = [shuffled[randomIdx], shuffled[idx]];
  }

  if (
    previousLastPath &&
    shuffled.length > 1 &&
    shuffled[0]?.path === previousLastPath
  ) {
    const swapIdx = shuffled.findIndex((photo) => photo.path !== previousLastPath);
    if (swapIdx > 0) {
      [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
    }
  }

  return shuffled;
};

const SlideshowPage: NextPage<PageProps> = (props) => {
  return <Slideshow />;
};

// TODO: consider doing getStaticProps here to fetch all photos and pass them to the slideshow
// like in world map
const Slideshow: React.FC<{ disabled?: boolean }> = (props) => {
  const [database, progress] = useDatabase();
  const buildIdRef = React.useRef<string | null>(null);

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
  const [slideshowError, setSlideshowError] = React.useState<string | null>(
    null,
  );

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
   *   - mode=random|similar     Slideshow playback mode
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
  *   /?mode=similar&filter=japan&shuffle=50         Similar mode, avoid the last 50 photos
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
    const nextMode =
      modeParam === "random" || modeParam === "similar"
        ? modeParam
        : slideshowMode;
    if (modeParam === "random" || modeParam === "similar") {
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
  }, [
    setShowClock,
    setShowDetails,
    setShowMap,
    setShowCover,
    setDetailsAlignment,
    setTimeDelay,
    setShuffleHistorySize,
    setSlideshowMode,
    slideshowMode,
  ]);

  const commitNextPhoto = useCallback(
    (candidatePhoto: RandomPhotoRow, opts?: { trackRecent?: boolean }) => {
      if (opts?.trackRecent) {
        recentPhotoPathsRef.current = [
          candidatePhoto.path,
          ...recentPhotoPathsRef.current,
        ].slice(0, shuffleHistorySize);
      }

      currentPhotoPathRef.current = candidatePhoto;
      setCurrentPhotoPath(candidatePhoto);
      setSlideshowError(null);
      setNextChangeAt(new Date(Date.now() + timeDelay));
    },
    [shuffleHistorySize, timeDelay],
  );

  const refillRandomQueue = useCallback((): RandomPhotoRow[] => {
    const nextQueue = shufflePhotos(
      randomPhotoPoolRef.current,
      randomQueueLastPathRef.current,
    );

    randomQueueRef.current = nextQueue;
    randomQueueIndexRef.current = -1;
    return nextQueue;
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
    if (!database) {
      return;
    }

    let cancelled = false;

    fetchSlideshowPhotos({ database, filter })
      .then((photos) => {
        if (cancelled) {
          return;
        }

        randomPhotoPoolRef.current = photos;
        randomQueueRef.current = [];
        randomQueueIndexRef.current = -1;
        recentPhotoPathsRef.current = [];

        if (photos.length === 0) {
          setCurrentPhotoPath(null);
          currentPhotoPathRef.current = null;
          setSlideshowError("No photos available");
          return;
        }

        setSlideshowError(null);

        if (slideshowMode === "random" || currentPhotoPathRef.current === null) {
          advanceRandomPhoto({ trackRecent: slideshowMode === "similar" });
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setSlideshowError("No photos available");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [advanceRandomPhoto, database, filter, slideshowMode]);

  const goNext = useCallback(() => {
    if (!database) {
      return;
    }

    if (slideshowMode === "random") {
      advanceRandomPhoto();
      return;
    }

    const activePhoto = currentPhotoPathRef.current;

    if (slideshowMode === "similar" && activePhoto?.path) {
      fetchSimilarResults({
        database,
        path: activePhoto.path,
        page: 0,
        pageSize: Math.max(shuffleHistorySize, 100),
      })
        .then((result) => {
          const filteredResults = result.data.filter((candidate) => {
            const matchesAlbumFilter = filter
              ? candidate.path.startsWith(`../albums/${filter}/`)
              : true;
            const isRecent = recentPhotoPathsRef.current.includes(
              candidate.path,
            );
            return matchesAlbumFilter && !isRecent;
          });

          const nextSimilar = filteredResults[0];
          if (!nextSimilar) {
            advanceRandomPhoto({ trackRecent: true });
            return;
          }

          commitNextPhoto({
            path: nextSimilar.path,
            exif: nextSimilar.exif,
            geocode: nextSimilar.geocode,
          }, { trackRecent: true });
        })
        .catch((err) => {
          console.error(err);
          advanceRandomPhoto({ trackRecent: true });
        });
      return;
    }

    advanceRandomPhoto({ trackRecent: true });
  }, [
    advanceRandomPhoto,
    commitNextPhoto,
    database,
    filter,
    shuffleHistorySize,
    slideshowMode,
  ]);

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
    goNext();
    const id = setInterval(goNext, timeDelay);
    return () => clearInterval(id);
  }, [database, timeDelay, nextCounter, goNext]);

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
          <ProgressBar progress={progress} />
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
      exif: undefined,
      tags: undefined,
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
      <Head>
        <title>Slideshow</title>
      </Head>

      <div className={styles.container}>
        <div className={[styles.toolbar, commonStyles.topBar].join(" ")}>
          {/* <ThemeToggle /> */}

          <Link className={commonStyles.button} href="/">
            ← Home
          </Link>

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
            style={{ marginRight: "var(--m-m)" }}
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

          <button
            className={[
              slideshowMode === "random" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            aria-pressed={slideshowMode === "random"}
            onClick={() => {
              setSlideshowMode("random");
            }}
          >
            Random
          </button>

          <button
            className={[
              slideshowMode === "similar" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            aria-pressed={slideshowMode === "similar"}
            onClick={() => {
              setSlideshowMode("similar");
            }}
          >
            Similar
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

          <div
            className={commonStyles.toast}
            style={{ marginRight: "var(--m-m)" }}
          >
            🔁 {secondsLeft.toFixed(0)}s
          </div>

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
            {slideshowMode === "similar" ? "similar" : "random"} in{" "}
            <i>{albumName}</i>
          </Link>

          <Link
            href={`/album/${albumName}#${photoName}`}
            className={commonStyles.toast}
          >
            view photo in <i>{albumName}</i>
          </Link>
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
          alt={photoBlock.data.title || "Slideshow image"}
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
