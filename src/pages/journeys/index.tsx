import { GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getAlbums } from "../../services/album";
import { measureBuild } from "../../services/buildTiming";
import { getJourneys, Journey } from "../../services/journeys";
import commonStyles from "../../styles/common.module.css";
import styles from "./journeys.module.css";

type PageProps = {
  journeys: Journey[];
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
                <Link href={journey.albumHref} className={styles.coverLink}>
                  <img
                    src={journey.cover.src}
                    alt={journey.title}
                    className={styles.coverImage}
                    width={journey.cover.width}
                    height={journey.cover.height}
                    style={{
                      backgroundColor: journey.cover.placeholderColor,
                    }}
                  />
                </Link>

                <div className={styles.meta}>
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

                <div className={styles.actions}>
                  <Link
                    href={journey.albumHref}
                    className={commonStyles.button}
                  >
                    Open album
                  </Link>
                  <Link href={journey.mapHref} className={commonStyles.button}>
                    Open map
                  </Link>
                  <Link
                    href={journey.timelineHref}
                    className={commonStyles.button}
                  >
                    Open timeline
                  </Link>
                </div>

                <section
                  className={styles.stops}
                  aria-label={`${journey.title} stops`}
                >
                  <strong>Stops</strong>
                  <ol className={styles.stopList}>
                    {journey.stops.slice(0, 4).map((stop) => (
                      <li key={stop.id} className={styles.stopItem}>
                        <span className={styles.stopIndex}>
                          {stop.sequenceIndex + 1}
                        </span>
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
        journeys,
      },
    };
  });
};

export default JourneysPage;
