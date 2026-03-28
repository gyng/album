import { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { CalendarHeatmap } from "../../components/CalendarHeatmap";
import { Nav } from "../../components/Nav";
import { TimelineDayGrid } from "../../components/TimelineDayGrid";
import { TimelineEntry } from "../../components/timelineTypes";
import { getAlbums } from "../../services/album";
import { Block, PhotoBlock } from "../../services/types";
import { measureBuild } from "../../services/buildTiming";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import commonStyles from "../../styles/common.module.css";
import styles from "./timeline.module.css";

type PageProps = {
  entries: TimelineEntry[];
};

const isTimelinePhoto = (block: Block): block is PhotoBlock => {
  return (
    block.kind === "photo" &&
    Boolean((block as PhotoBlock)._build?.exif?.DateTimeOriginal)
  );
};

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const TimelinePage: NextPage<PageProps> = ({ entries }) => {
  const router = useRouter();
  const filterAlbum =
    typeof router.query.filter_album === "string"
      ? router.query.filter_album
      : null;

  const filteredEntries = React.useMemo(() => {
    return filterAlbum
      ? entries.filter((entry) => entry.album === filterAlbum)
      : entries;
  }, [entries, filterAlbum]);

  const availableDates = React.useMemo(() => {
    return Array.from(new Set(filteredEntries.map((entry) => entry.date))).sort(
      (left, right) => right.localeCompare(left),
    );
  }, [filteredEntries]);

  // Default to latest date (first in sorted list), but allow URL param
  const initialDateFromUrl = typeof router.query.date === "string" ? router.query.date : null;
  const [selectedDate, setSelectedDate] = React.useState<string | null>(
    initialDateFromUrl && availableDates.includes(initialDateFromUrl)
      ? initialDateFromUrl
      : availableDates[0] ?? null
  );
  const [todayDate, setTodayDate] = React.useState<string | null>(null);

  const selectableDates = React.useMemo(() => {
    return todayDate
      ? availableDates.filter((date) => date <= todayDate)
      : availableDates;
  }, [availableDates, todayDate]);

  React.useEffect(() => {
    setTodayDate(getLocalDateKey());
  }, []);

  // If availableDates changes and selectedDate is null, default to latest
  React.useEffect(() => {
    if (!selectedDate && availableDates.length > 0) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  // On mount or when router.query.date changes, update selectedDate if needed
  React.useEffect(() => {
    const urlDate = typeof router.query.date === "string" ? router.query.date : null;
    if (urlDate && availableDates.includes(urlDate) && urlDate !== selectedDate) {
      setSelectedDate(urlDate);
    }
  }, [router.query.date, availableDates]);

  // When selectedDate changes, update the URL param (shallow push)
  React.useEffect(() => {
    if (!selectedDate) return;
    const url = { pathname: router.pathname, query: { ...router.query, date: selectedDate } };
    if (router.query.date !== selectedDate) {
      router.replace(url, undefined, { shallow: true });
    }
  }, [selectedDate]);

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
    setSelectedDate(selectableDates[randomIndex] ?? null);
  }, [selectableDates]);

  const handleSelectOlderDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Older = higher index (dates sorted newest first)
    if (idx >= 0 && idx < selectableDates.length - 1) {
      setSelectedDate(selectableDates[idx + 1]);
    }
  }, [selectableDates, selectedDate]);

  const handleSelectNewerDate = React.useCallback(() => {
    if (!selectedDate) return;
    const idx = selectableDates.indexOf(selectedDate);
    // Newer = lower index (dates sorted newest first)
    if (idx > 0) {
      setSelectedDate(selectableDates[idx - 1]);
    }
  }, [selectableDates, selectedDate]);

  const selectedEntries = React.useMemo(() => {
    return selectedDate
      ? filteredEntries.filter((entry) => entry.date === selectedDate)
      : [];
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
      <Head>
        <title>Timeline</title>
        <link rel="icon" href="/favicon.svg" />
        <meta name="theme-color" content="#2c2c2c" />
      </Head>

      <main className={styles.main}>
        <Nav hasPadding={false} />

        <header className={styles.header}>
          <h1 className={styles.title}>Timeline</h1>
          {filterAlbum ? (
            <div className={commonStyles.toast}>
              only showing photos from{" "}
              <Link href={`/album/${filterAlbum}`}>
                <i>{filterAlbum}</i>
              </Link>
            </div>
          ) : null}
        </header>

        <div className={styles.browseActionsBar}>
          <Link href="/search" className={styles.exploreLink}>
            🔍 Explore photos
          </Link>
          <Link href="/map" className={styles.exploreLink}>
            🗺️ Explore the map
          </Link>
        </div>

        {filteredEntries.length === 0 ? (
          <div className={styles.emptyState}>
            No dated photos are available for this view yet.
          </div>
        ) : (
          <div className={styles.layout}>
            <section className={styles.heatmapPanel} aria-label="Timeline heatmap panel">
              <CalendarHeatmap
                entries={filteredEntries}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                todayDate={todayDate ?? undefined}
              />
            </section>
            <div className={styles.dayPanel}>
              <TimelineDayGrid
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
        )}
      </main>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./timeline.getStaticProps", async () => {
    const albums = await getAlbums();

    const entries = albums
      .flatMap((album) => {
        return album.blocks.filter(isTimelinePhoto).flatMap((photo) => {
          const dateTimeOriginal = photo._build?.exif?.DateTimeOriginal;
          const src = photo._build?.srcset?.[0];

          if (!dateTimeOriginal || !src) {
            return [] as TimelineEntry[];
          }

          const parsedDate = new Date(dateTimeOriginal);
          if (Number.isNaN(parsedDate.getTime())) {
            return [] as TimelineEntry[];
          }

          const filename = photo.data.src.split("/").at(-1) ?? photo.id;
          const primaryColor = photo._build?.tags?.colors?.[0];
          const geocode = photo._build?.tags?.geocode ?? null;
          const {
            GPSLongitude,
            GPSLatitude,
            GPSLongitudeRef,
            GPSLatitudeRef,
          } = photo._build?.exif ?? {};
          const { decLng, decLat } =
            GPSLongitude && GPSLatitude && GPSLongitudeRef && GPSLatitudeRef
              ? getDegLatLngFromExif({
                  GPSLongitude,
                  GPSLatitude,
                  GPSLongitudeRef,
                  GPSLatitudeRef,
                })
              : { decLng: null, decLat: null };

          return [
            {
              album: album._build.slug,
              date: parsedDate.toISOString().slice(0, 10),
              dateTimeOriginal: parsedDate.toISOString(),
              decLat,
              decLng,
              geocode,
              src,
              href: `/album/${album._build.slug}#${filename}`,
              path: photo.data.src,
              placeholderColor: primaryColor
                ? `rgba(${primaryColor[0]}, ${primaryColor[1]}, ${primaryColor[2]}, 1)`
                : "transparent",
              placeholderWidth: photo._build?.width,
              placeholderHeight: photo._build?.height,
            },
          ];
        });
      })
      .sort((left, right) => {
        if (left.date !== right.date) {
          return right.date.localeCompare(left.date);
        }

        if (left.dateTimeOriginal !== right.dateTimeOriginal) {
          return right.dateTimeOriginal.localeCompare(left.dateTimeOriginal);
        }

        return left.href.localeCompare(right.href);
      });

    return { props: { entries } };
  });
};

export default TimelinePage;
