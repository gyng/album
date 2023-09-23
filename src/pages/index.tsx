import type { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import { Albums } from "../components/Albums";
import styles from "./Index.module.css";
import { getAlbums, getImageTimestampRange } from "../services/album";
import { Content } from "../services/types";
import DynamicSearch from "../components/search/DynamicSearch";

type PageProps = {
  albums: Content[];
};

const Home: NextPage<PageProps> = (context) => {
  return (
    <div className={styles.container}>
      <Head>
        <title>Snapshots</title>
        <meta name="description" content="Snapshots from a better era" />
        <link rel="icon" href="/favicon.svg" />
        <meta name="theme-color" content="#2c2c2c" />
      </Head>

      <main className={styles.main}>
        <h1>Snapshots</h1>
        <DynamicSearch />
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
      </footer>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async (context) => {
  const albums = (await getAlbums())
    .sort((a, b) => {
      const bTime = getImageTimestampRange(b)[1] ?? 0;
      const aTime = getImageTimestampRange(a)[1] ?? 0;
      return bTime - aTime;
    })
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
    .sort((a, b) => (b.name.startsWith("test") ? -1 : 0));

  return {
    props: {
      albums: albums.map((a) => ({
        ...a,
        // Reduce page data size by only providing a partial list
        blocks: [...a.blocks.slice(0, 3)],
        _build: { ...a._build, timeRange: getImageTimestampRange(a) }, // FIXME: Unoptimal
      })),
    },
  };
};

export default Home;
