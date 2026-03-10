import { NextPage } from "next/types";
import React, { useEffect, useCallback } from "react";
import { useDatabase } from "../../components/database/useDatabase";
import { PhotoBlock } from "../../services/types";
import { fetchRandomPhoto, RandomPhotoRow } from "../../components/search/api";
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
   *   - align=left|center|right  Set details alignment
   *   - delay=<seconds>          Set slide duration in seconds (e.g., 60 = 60 seconds)
   *   - shuffle=<number>         Set shuffle history size (avoid repeating last N photos)
   *   - filter=<album-name>      Filter to specific album
   *
   * Examples:
   *   /?clock=1&details=1&map=1&delay=60              All features with 60-second slides
   *   /?clock=1&delay=30                              Just clock with 30-second intervals
   *   /?details=1&align=left                          Details aligned left (no clock)
   *   /?filter=japan&delay=45&shuffle=50              Japan album, 45-second slides, avoid last 50
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
    if (historyParam !== null && historyParam > 0) {
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
  ]);

  const goNext = useCallback(() => {
    if (!database) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 5;

    const tryFetch = () => {
      fetchRandomPhoto({ database, filter })
        .then((result) => {
          if (result.length === 0) {
            console.error("No photos available");
            return;
          }

          const candidatePhoto = result[0];

          // Check if photo is in recent history
          if (
            recentPhotoPathsRef.current.includes(candidatePhoto.path) &&
            attempts < maxAttempts
          ) {
            attempts++;
            // Retry after a small delay instead of hot-looping
            setTimeout(tryFetch, 50);
            return;
          }

          // Update recent photos history
          recentPhotoPathsRef.current = [
            candidatePhoto.path,
            ...recentPhotoPathsRef.current,
          ].slice(0, shuffleHistorySize);

          setCurrentPhotoPath(candidatePhoto);
          setNextChangeAt(new Date(Date.now() + timeDelay));
        })
        .catch(console.error);
    };

    tryFetch();
  }, [database, filter, timeDelay, shuffleHistorySize]);

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
        <ProgressBar progress={progress} />
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
            onClick={() => setShowClock(!showClock)}
          >
            🕰️
          </button>

          <button
            className={[
              showDetails ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            onClick={() => setShowDetails(!showDetails)}
          >
            Details
          </button>

          <button
            className={[
              showMap ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
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
            className={commonStyles.button}
            onClick={() => {
              setImageLoaded(false);
              setNextCounter(nextCounter + 1);
            }}
          >
            Next
          </button>

          <div
            style={{
              display: "flex",
              gap: "var(--m-xs)",
              alignItems: "center",
            }}
          >
            <span className={commonStyles.toast} style={{ margin: "0" }}>
              Shuffle history:
            </span>
            {[5, 10, 20, 50, 100].map((size) => {
              return (
                <button
                  key={size}
                  className={[
                    commonStyles.button,
                    size === shuffleHistorySize ? commonStyles.active : "",
                  ].join(" ")}
                  onClick={() => setShuffleHistorySize(size)}
                  title={`Skip photos seen in last ${size} shots`}
                >
                  {size}
                </button>
              );
            })}
          </div>

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
              setNextCounter(nextCounter + 1);
            }, 1000);
          }}
          onClick={() => {
            setImageLoaded(false);
            setNextCounter(nextCounter + 1);
          }}
        />
      </div>
    </>
  );
};

export default SlideshowPage;
