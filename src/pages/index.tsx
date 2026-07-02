import type { GetStaticProps, NextPage } from "next";
import { Albums } from "../components/Albums";
import { Footer, Heading } from "../components/ui";
import styles from "./Index.module.css";
import { getAlbums, getImageTimestampRange } from "../services/album";
import { Block, Content } from "../services/types";
import { measureBuild } from "../services/buildTiming";
// import DynamicSearchWithCoi from "../components/search/DynamicSearchWithCoi";
import { Seo } from "../components/Seo";
import {
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
} from "../lib/seo";
import { GlobalNav } from "../components/GlobalNav";

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

      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="home" hasPadding={false} />
        <Heading level={1} as="h1">
          Snapshots
        </Heading>
        <Albums albums={context.albums} />
      </main>

      <Footer />
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
        albums: albums.map((a) => {
          // Reduce page data size by only providing a partial list: the
          // cover(s) plus the first photo. Dedupe when the cover *is* the first
          // photo, otherwise the same block ships twice (duplicate React keys).
          const coverBlocks = a.blocks.filter(
            (b) => b.kind === "photo" && b.formatting?.cover,
          );
          const firstPhoto = a.blocks.find((b) => b.kind === "photo");
          const previewBlocks: Block[] =
            firstPhoto && !coverBlocks.some((b) => b.id === firstPhoto.id)
              ? [...coverBlocks, firstPhoto]
              : coverBlocks;

          return {
            ...a,
            blocks: previewBlocks,
            _build: { ...a._build, timeRange: getImageTimestampRange(a) }, // FIXME: Unoptimal
          };
        }),
      },
    };
  });
};

export default Home;
