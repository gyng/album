import type { GetStaticPaths, GetStaticProps } from "next";
import AlbumScreen, { type AlbumScreenProps } from "../../screens/album/AlbumScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadAlbumPageData, loadAlbumPagePaths } from "../../services/pageData/album";

export const getStaticProps: GetStaticProps<AlbumScreenProps, { slug: string[] }> = async (
  context,
) =>
  measureBuild("page./album/[[...slug]].getStaticProps", async () => {
    const slug = context.params?.slug?.[0];
    return slug ? { props: await loadAlbumPageData(slug) } : { notFound: true };
  });

export const getStaticPaths: GetStaticPaths = async () =>
  measureBuild("page./album/[[...slug]].getStaticPaths", async () => ({
    // Album sources are build-only, so unknown slugs use the static 404.
    paths: await loadAlbumPagePaths(),
    fallback: false,
  }));

export default AlbumScreen;
