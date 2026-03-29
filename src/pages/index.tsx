import type { GetStaticProps, NextPage } from "next";
import { Albums } from "../components/Albums";
import styles from "./Index.module.css";
import { getAlbums, getImageTimestampRange } from "../services/album";
import { Block, Content } from "../services/types";
import { measureBuild } from "../services/buildTiming";
// import DynamicSearchWithCoi from "../components/search/DynamicSearchWithCoi";
import Link from "next/link";
import { Seo } from "../components/Seo";
import {
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
} from "../lib/seo";
import { Nav } from "../components/Nav";
import commonStyles from "../styles/common.module.css";

type PageProps = {
  albums: Content[];
};

const Home: NextPage<PageProps> = (context) => {
  return (
    <div className={styles.container}>
      <Seo
        jsonLd={[
          buildWebSiteJsonLd(),
          buildCollectionPageJsonLd({
            name: "Snapshots",
            description: "Snapshots from a better era",
            pathname: "/",
          }),
        ]}
      />

      <main className={styles.main}>
        <Nav
          hasPadding={false}
          isHome
          extraItems={
            <>
              <li>
                <Link href="/search" className={commonStyles.button}>
                  Search & Explore
                </Link>
              </li>
              <li>
                <Link href="/timeline" className={commonStyles.button}>
                  Timeline
                </Link>
              </li>
              <li>
                <Link href="/map" className={commonStyles.button}>
                  Map
                </Link>
              </li>
              <li>
                <div className={commonStyles.splitButton}>
                  <Link href="/slideshow" className={commonStyles.splitButtonMain}>
                    Slideshow
                  </Link>
                  <Link
                    href="/slideshow?mode=similar&random=1"
                    className={commonStyles.splitButtonSub}
                    aria-label="Start similarity slideshow for a random image"
                    title="Start similarity slideshow for a random image"
                  >
                    🎲
                  </Link>
                </div>
              </li>
            </>
          }
        />
        <h1>Snapshots</h1>
        <Albums albums={context.albums} />
      </main>

      <footer className={styles.footer}>
        <a
          href="https://www.github.com/gyng/album"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        &nbsp;&middot;&nbsp;
        <a href="https://mastodon.yshi.org/@f" target="_blank" rel="noreferrer">
          Fediverse
        </a>
        &nbsp;&middot;&nbsp;
        <a
          href="https://bsky.app/profile/gyng.bsky.social"
          target="_blank"
          rel="noreferrer"
        >
          Bluesky
        </a>
      </footer>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async (context) => {
  return measureBuild("page./.getStaticProps", async () => {
    const albums = (await getAlbums())
      .sort((a, b) => {
        const bTime = getImageTimestampRange(b)[1] ?? 0;
        const aTime = getImageTimestampRange(a)[1] ?? 0;
        return bTime - aTime;
      })
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
      // Push test albums to the end
      .sort((a, b) => (a.name.startsWith("test") ? 1 : 0) - (b.name.startsWith("test") ? 1 : 0));

    return {
      props: {
        albums: albums.map((a) => ({
          ...a,
          // Reduce page data size by only providing a partial list
          blocks: [
            ...a.blocks.filter((b) => b.kind === "photo" && b.formatting?.cover),
            a.blocks.find((b) => b.kind === "photo"),
          ].filter(Boolean) as Block[],
          _build: { ...a._build, timeRange: getImageTimestampRange(a) }, // FIXME: Unoptimal
        })),
      },
    };
  });
};

export default Home;
