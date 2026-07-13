import type { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import {
  buildMapPhotoSearchText,
  getMapPhotoHref,
  hasMapCoordinates,
  type MapSearchIndexEntry,
} from "../../components/mapSearchIndex";
import { getAlbums } from "../../services/album";
import { measureBuild } from "../../services/buildTiming";

type PageProps = { entries: MapSearchIndexEntry[] };

/** Internal static-data route; the map fetches its Next data JSON on demand. */
const MapSearchIndexPage: NextPage = () => (
  <Head>
    <meta name="robots" content="noindex, nofollow" />
  </Head>
);

export const getStaticProps: GetStaticProps<PageProps> = async () =>
  measureBuild("page./map/search-index.getStaticProps", async () => {
    const albums = await getAlbums();
    const entries = albums.flatMap((album): MapSearchIndexEntry[] =>
      album.blocks.filter(hasMapCoordinates).flatMap((photo) => {
        const searchText = buildMapPhotoSearchText(photo);
        return searchText
          ? [[getMapPhotoHref(album._build.slug, photo), searchText] satisfies MapSearchIndexEntry]
          : [];
      }),
    );

    return { props: { entries } };
  });

export default MapSearchIndexPage;
