import { GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getAlbums } from "../../services/album";
import { measureBuild } from "../../services/buildTiming";
import { getJourneys, Journey } from "../../services/journeys";
import styles from "./journeys.module.css";

type PageProps = {
  journeys: Journey[];
};

const toSerializableJourneys = (journeys: Journey[]): Journey[] => {
  return JSON.parse(
    JSON.stringify(journeys, (_key, value) =>
      value === undefined ? null : value,
    ),
  ) as Journey[];
};

const JourneysPage: NextPage<PageProps> = ({ journeys }) => {
  return (
    <>
      <Seo
        title="Journeys | Snapshots"
        description="Browse trips and travel stops across the archive."
        pathname="/journeys"
        jsonLd={buildCollectionPageJsonLd({
          name: "Journeys | Snapshots",
          description: "Browse trips and travel stops across the archive.",
          pathname: "/journeys",
        })}
      />
      <div className={styles.page}>
        <Nav hasPadding={false} />

        <header className={styles.header}>
          <p className={styles.eyebrow}>Story Layer</p>
          <h1 className={styles.title}>Journeys</h1>
          <p className={styles.lede}>
            Trips become easier to browse when the archive is organized by
            stops, movement, and transitions rather than only by albums or raw
            photos.
          </p>
        </header>

        {journeys.length === 0 ? (
          <div className={styles.empty}>
            No journeys with routeable photos yet.
          </div>
        ) : (
          <div className={styles.grid}>
            {journeys.map((journey) => (
              <article key={journey.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <Link href={journey.albumHref} className={styles.coverLink}>
                    <img
                      src={journey.cover.src}
                      alt={journey.title}
                      className={styles.coverImage}
                      width={journey.cover.width ?? undefined}
                      height={journey.cover.height ?? undefined}
                      style={{
                        backgroundColor:
                          journey.cover.placeholderColor ?? undefined,
                      }}
                    />
                  </Link>

                  <div className={styles.cardIntro}>
                    <div className={styles.meta}>
                      {journey.albumCount > 1 ? (
                        <span>{journey.albumCount} albums</span>
                      ) : null}
                      <span>{journey.stopCount} stops</span>
                      <span>{journey.geotaggedPhotoCount} route photos</span>
                      {journey.durationDays ? (
                        <span>{journey.durationDays} days</span>
                      ) : null}
                    </div>

                    <div>
                      <h2>{journey.title}</h2>
                      <p className={styles.summary}>{journey.summary}</p>
                    </div>

                    {journey.tags.length > 0 ? (
                      <div className={styles.tags}>
                        {journey.tags.map((tag) => (
                          <span key={tag} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.actions}>
                  <Link href={journey.albumHref} className={styles.actionLink}>
                    {journey.albumCount > 1 ? "Primary album" : "Album"}
                  </Link>
                  <Link href={journey.mapHref} className={styles.actionLink}>
                    Map
                  </Link>
                  <Link href={journey.timelineHref} className={styles.actionLink}>
                    Timeline
                  </Link>
                </div>

                <section
                  className={styles.stops}
                  aria-label={`${journey.title} stops`}
                >
                  <strong>Stops</strong>
                  <ol className={styles.stopList}>
                    {journey.stops.slice(0, 3).map((stop) => (
                      <li key={stop.id} className={styles.stopItem}>
                        <span className={styles.stopIndex}>
                          {stop.sequenceIndex + 1}
                        </span>
                        <Link
                          href={stop.coverHref}
                          className={styles.stopPreviewLink}
                        >
                          <img
                            src={stop.cover.src}
                            alt={stop.title}
                            className={styles.stopPreview}
                            width={stop.cover.width ?? undefined}
                            height={stop.cover.height ?? undefined}
                            style={{
                              backgroundColor:
                                stop.cover.placeholderColor ?? undefined,
                            }}
                          />
                        </Link>
                        <div className={styles.stopText}>
                          <span className={styles.stopTitle}>{stop.title}</span>
                          <span className={styles.stopSummary}>
                            {stop.summary}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </article>
            ))}
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
