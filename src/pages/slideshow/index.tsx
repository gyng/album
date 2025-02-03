import { NextPage } from "next/types";
import React, { useEffect } from "react";
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
import { extractDateFromExifString } from "../../util/extractExifFromDb";
import MMap from "../../components/Map";

type PageProps = {};

const SlideshowPage: NextPage<PageProps> = (props) => {
  return <Slideshow />;
};

// TODO: consider doing getStaticProps here to fetch all photos and pass them to the slideshow
// like in world map
const Slideshow: React.FC<{ disabled?: boolean }> = (props) => {
  const [database, progress] = useDatabase();

  // reload page every 1 day to force load of new code
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
    30000
  );
  const [showClock, setShowClock, removeShowClock] = useLocalStorage(
    "slideshow-showclock",
    false
  );
  const [showMap, setShowMap, removeShowMap] = useLocalStorage(
    "slideshow-showmap",
    false
  );
  const [showDetails, setShowDetails, removeShowDetails] = useLocalStorage(
    "slideshow-showdetails",
    false
  );

  const [nextChangeAt, setNextChangeAt] = React.useState<Date>(new Date());
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [time, setTime] = React.useState<Date>(new Date());

  const [imageLoaded, setImageLoaded] = React.useState<boolean>(false);

  // Use this to force a clear
  const [nextCounter, setNextCounter] = React.useState<number>(0);

  const [filter, setFilter] = React.useState<string | undefined>(undefined);
  useEffect(() => {
    const url = new URL(window.location.toString());
    const searchFilter = url.searchParams.get("filter");
    if (searchFilter) {
      setFilter(searchFilter);
    }
  }, []);

  const goNext = () => {
    if (!database) {
      return;
    }
    fetchRandomPhoto({ database, filter })
      .then((p) => {
        setCurrentPhotoPath(p[0]);
        setNextChangeAt(new Date(Date.now() + timeDelay));
      })
      .catch(console.error);
  };

  useEffect(() => {
    goNext();
    const id = setInterval(goNext, timeDelay);
    return () => clearInterval(id);
  }, [database, timeDelay, nextCounter]);

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

  const geocodeCountry = currentPhotoPath?.geocode
    ? currentPhotoPath.geocode
        .split("\n")
        .slice(-3)
        .filter((x) => Number.isNaN(parseFloat(x)))
        .join(", ")
    : null;
  const coordinates = currentPhotoPath?.geocode
    ? ([
        parseFloat(currentPhotoPath?.geocode.split("\n").at(2) ?? ""),
        parseFloat(currentPhotoPath?.geocode.split("\n").at(3) ?? ""),
      ] as [number, number])
    : null;

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
            }
          )}

          <div className={commonStyles.toast}>🔁 {secondsLeft.toFixed(0)}s</div>

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

        {showClock || showDetails || showMap ? (
          <div className={styles.bottomBar}>
            {showClock ? (
              <div className={styles.clock}>
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

            {showMap ? (
              <div className={styles.mapContainer}>
                {coordinates ? (
                  <MMap
                    coordinates={coordinates}
                    attribution={false}
                    details={false}
                    style={{ width: "100%", height: "100%" }}
                    mapStyle="toner"
                    projection="vertical-perspective"
                  />
                ) : (
                  <div className={styles.mapContainer}>&nbsp;</div>
                )}
              </div>
            ) : null}

            {showDetails ? (
              <div className={styles.details}>
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

                {geocodeCountry ? (
                  <div className={styles.detailsRow}>{geocodeCountry}</div>
                ) : (
                  <div className={styles.detailsRow}>&nbsp;</div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <img
          className={`${styles.image} ${!imageLoaded ? styles.notLoaded : ""}`}
          src={photoBlock.data.src}
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
