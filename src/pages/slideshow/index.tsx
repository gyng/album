import { NextPage } from "next/types";
import React, { useEffect } from "react";
import { useDatabase } from "../../components/database/useDatabase";
import { PhotoBlock } from "../../services/types";
import { fetchRandomPhoto } from "../../components/search/api";
import { ProgressBar } from "../../components/ProgressBar";
import styles from "./slideshow.module.css";
import { ThemeToggle } from "../../components/ThemeToggle";
import Link from "next/link";
import Head from "next/head";

type PageProps = {};

const SlideshowPage: NextPage<PageProps> = (props) => {
  return <Slideshow />;
};

const Slideshow: React.FC<{ disabled?: boolean }> = (props) => {
  const [database, progress] = useDatabase();

  const [currentPhotoPath, setCurrentPhotoPath] = React.useState<string | null>(
    null
  );
  const [timeDelay, setTimeDelay] = React.useState<number>(30000);
  const [nextChangeAt, setNextChangeAt] = React.useState<Date>(new Date());
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [showClock, setShowClock] = React.useState<boolean>(false);
  const [time, setTime] = React.useState<Date>(new Date());

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
        setCurrentPhotoPath(p[0].path);
        setNextChangeAt(new Date(Date.now() + timeDelay));
      })
      .catch(console.error);
  };

  useEffect(() => {
    goNext();
    const id = setInterval(goNext, timeDelay);
    return () => clearInterval(id);
  }, [database, timeDelay]);

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

  const albumName = currentPhotoPath?.[0]?.split?.("/")?.[2] ?? "";
  const photoName = currentPhotoPath?.[0]?.split?.("/")?.[3] ?? "";
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

  return (
    <div className={styles.container}>
      <Head>
        <title>Slideshow</title>
      </Head>

      <div className={styles.toolbar}>
        <ThemeToggle />

        <button
          className={styles.nextPhoto}
          onClick={() => setShowClock(!showClock)}
        >
          🕰️ Clock
        </button>

        <button
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
          className={styles.nextPhoto}
          onClick={() => {
            goNext();
          }}
        >
          Next
        </button>

        {[5000, 10000, 30000, 60000, 300000, 600000, 3600000, 86400000].map(
          (delay) => {
            const delayMin = delay / 1000 / 60;
            const delaySec = delay / 1000;

            return (
              <button
                key={delay}
                className={`${styles.timeDelayButton} ${delay === timeDelay ? styles.active : ""}`}
                onClick={() => setTimeDelay(delay)}
              >
                {delayMin < 1 ? `${delaySec} sec` : `${delayMin} min`}
              </button>
            );
          }
        )}

        <div className={styles.countdown}>🔁 {secondsLeft.toFixed(0)}s</div>

        {filter ? (
          <div className={styles.filterLabel}>
            🔽 only showing photos from{" "}
            <Link href={`/album/${filter}`}>
              <i>{filter}</i>
            </Link>
          </div>
        ) : null}
      </div>

      {showClock && (
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
      )}

      <Link href={`/album/${albumName}`} className={styles.link}>
        <img className={styles.image} src={photoBlock.data.src} />
      </Link>
    </div>
  );
};

export default SlideshowPage;
