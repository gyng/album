/* eslint react-hooks/rules-of-hooks: 0 */

import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import Head from "next/head";
import React from "react";
import { getAlbumFromName, getAlbumNames } from "../../services/album";
import { Content, PhotoBlock } from "../../services/types";
import { Nav } from "../../components/Nav";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { measureBuild } from "../../services/buildTiming";

type PageProps = {
  album?: Content;
};

const Album: NextPage<PageProps> = ({ album }) => {
  if (!album) {
    return <div>This seems to be missing.</div>;
  }

  // Have a stateful album for potential future state management
  const [statefulAlbum, setStatefulAlbum] = React.useState(album);
  React.useEffect(() => {
    setStatefulAlbum(album);
  }, [album]);

  // SEO/Meta tag generation
  const title =
    statefulAlbum.title ?? statefulAlbum.name ?? statefulAlbum._build.slug;

  const imageCount = statefulAlbum.blocks.filter(
    (b) => b.kind === "photo",
  ).length;

  const cover =
    statefulAlbum.blocks.find(
      (b) => b.kind === "photo" && b.formatting?.cover,
    ) ?? statefulAlbum.blocks.find((b) => b.kind === "photo");

  return (
    <>
      <Head>
        <title>{title}</title>
        {album.kicker ? (
          <meta name="description" content={album.kicker} />
        ) : (
          <meta
            name="description"
            content={`${title} photo album: ${imageCount} photos`}
          />
        )}
        {cover ? (
          <meta
            property="og:image"
            content={(cover as PhotoBlock)._build.srcset?.[0].src}
          />
        ) : null}
      </Head>

      <Nav albumName={statefulAlbum._build.slug} />
      <PhotoAlbum album={statefulAlbum} />
    </>
  );
};

export const getStaticProps: GetStaticProps<
  PageProps,
  { slug: string[] }
> = async (context) => {
  return measureBuild("page./album/[[...slug]].getStaticProps", async () => {
    if (!context.params?.slug?.[0]) {
      return {
        props: {
          album: undefined,
        },
      };
    }

    const album = await getAlbumFromName(context.params?.slug?.[0]);

    return {
      props: {
        album,
      },
    };
  });
};

export const getStaticPaths: GetStaticPaths = async () => {
  return measureBuild("page./album/[[...slug]].getStaticPaths", async () => {
    // TODO: move into routes
    const paths = (await getAlbumNames()).map((n) => `/album/${n}`);
    return {
      paths,
      fallback: true,
    };
  });
};

export default Album;
