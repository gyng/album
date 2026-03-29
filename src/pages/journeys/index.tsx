import { GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getAlbums } from "../../services/album";
import { measureBuild } from "../../services/buildTiming";
import { getJourneys, Journey, JourneyStop } from "../../services/journeys";
import styles from "./journeys.module.css";

type PageProps = {
  journeys: Journey[];
};

type FeedItem =
  | {
      id: string;
      kind: "journey";
      date: string | null;
      journey: Journey;
    }
  | {
      id: string;
      kind: "stop";
      date: string | null;
      journey: Journey;
      stop: JourneyStop;
    };

const toSerializableJourneys = (journeys: Journey[]): Journey[] => {
  return JSON.parse(
    JSON.stringify(journeys, (_key, value) =>
      value === undefined ? null : value,
    ),
  ) as Journey[];
};

const formatFeedDate = (date: string | null): string => {
  if (!date) {
    return "Undated";
  }

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const buildFeedItems = (journeys: Journey[]): FeedItem[] => {
  return journeys
    .flatMap((journey) => [
      {
        id: `journey:${journey.id}`,
        kind: "journey" as const,
        date: journey.startDate,
        journey,
      },
      ...journey.stops.map((stop) => ({
        id: `stop:${stop.id}`,
        kind: "stop" as const,
        date: stop.startDate,
        journey,
        stop,
      })),
    ])
    .sort((left, right) => {
      const leftDate = left.date ? new Date(left.date).valueOf() : 0;
      const rightDate = right.date ? new Date(right.date).valueOf() : 0;
      return rightDate - leftDate;
    });
};

const JourneysPage: NextPage<PageProps> = ({ journeys }) => {
  const feedItems = buildFeedItems(journeys);

  return (
    <>
      <Seo
        title="Journeys | Snapshots"
        description="A feed of trips, stops, and movement across the archive."
        pathname="/journeys"
        jsonLd={buildCollectionPageJsonLd({
          name: "Journeys | Snapshots",
          description: "A feed of trips, stops, and movement across the archive.",
          pathname: "/journeys",
        })}
      />
      <div className={styles.page}>
        <Nav hasPadding={false} />

        <header className={styles.header}>
          <p className={styles.eyebrow}>Story Layer</p>
          <h1 className={styles.title}>Journey Feed</h1>
          <p className={styles.lede}>
            A stream of departures, arrivals, and stops across the archive,
            ordered more like a travel feed than a folder index.
          </p>
        </header>

        {feedItems.length === 0 ? (
          <div className={styles.empty}>
            No journeys with routeable photos yet.
          </div>
        ) : (
          <div className={styles.feed}>
            {feedItems.map((item) =>
              item.kind === "journey" ? (
                <article key={item.id} className={styles.feedCard}>
                  <div className={styles.feedImageColumn}>
                    <Link
                      href={item.journey.albumHref}
                      className={styles.coverLink}
                    >
                      <img
                        src={item.journey.cover.src}
                        alt={item.journey.title}
                        className={styles.feedImage}
                        width={item.journey.cover.width ?? undefined}
                        height={item.journey.cover.height ?? undefined}
                        style={{
                          backgroundColor:
                            item.journey.cover.placeholderColor ?? undefined,
                        }}
                      />
                    </Link>
                  </div>

                  <div className={styles.feedBody}>
                    <div className={styles.feedHeaderRow}>
                      <span className={styles.kicker}>Trip</span>
                      <span className={styles.timestamp}>
                        {formatFeedDate(item.journey.startDate)}
                      </span>
                    </div>

                    <h2 className={styles.feedTitle}>{item.journey.title}</h2>
                    <p className={styles.feedSummary}>{item.journey.summary}</p>

                    <div className={styles.meta}>
                      {item.journey.albumCount > 1 ? (
                        <span>{item.journey.albumCount} albums</span>
                      ) : null}
                      <span>{item.journey.stopCount} stops</span>
                      <span>{item.journey.geotaggedPhotoCount} route photos</span>
                    </div>

                    <div className={styles.actions}>
                      <Link
                        href={item.journey.mapHref}
                        className={styles.actionLink}
                      >
                        Open map
                      </Link>
                      <Link
                        href={item.journey.timelineHref}
                        className={styles.actionLink}
                      >
                        Open timeline
                      </Link>
                      <Link
                        href={item.journey.albumHref}
                        className={styles.actionLink}
                      >
                        {item.journey.albumCount > 1
                          ? "Primary album"
                          : "Open album"}
                      </Link>
                    </div>
                  </div>
                </article>
              ) : (
                <article key={item.id} className={styles.feedCard}>
                  <div className={styles.feedImageColumn}>
                    <Link
                      href={item.stop.coverHref}
                      className={styles.stopPreviewLink}
                    >
                      <img
                        src={item.stop.cover.src}
                        alt={item.stop.title}
                        className={styles.feedImage}
                        width={item.stop.cover.width ?? undefined}
                        height={item.stop.cover.height ?? undefined}
                        style={{
                          backgroundColor:
                            item.stop.cover.placeholderColor ?? undefined,
                        }}
                      />
                    </Link>
                  </div>

                  <div className={styles.feedBody}>
                    <div className={styles.feedHeaderRow}>
                      <span className={styles.kicker}>Stop</span>
                      <span className={styles.timestamp}>
                        {formatFeedDate(item.stop.startDate)}
                      </span>
                    </div>

                    <h2 className={styles.feedTitle}>{item.stop.title}</h2>
                    <p className={styles.feedSummary}>{item.stop.summary}</p>

                    <div className={styles.meta}>
                      <span>{item.journey.title}</span>
                      <span>{item.stop.photoCount} photos</span>
                      <span>Stop {item.stop.sequenceIndex + 1}</span>
                    </div>

                    <div className={styles.actions}>
                      <Link
                        href={item.stop.coverHref}
                        className={styles.actionLink}
                      >
                        Open photo
                      </Link>
                      <Link
                        href={item.journey.mapHref}
                        className={styles.actionLink}
                      >
                        Trace route
                      </Link>
                    </div>
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./journeys.getStaticProps", async () => {
    const albums = await getAlbums();
    const journeys = await getJourneys(albums);

    return {
      props: {
        journeys: toSerializableJourneys(journeys),
      },
    };
  });
};

export default JourneysPage;
