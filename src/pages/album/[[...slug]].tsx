/* eslint react-hooks/rules-of-hooks: 0 */

import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { getAlbumFromName, getAlbumNames } from "../../services/album";
import { Content, PhotoBlock } from "../../services/types";
import { GlobalNav } from "../../components/GlobalNav";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { Footer } from "../../components/ui";
import commonStyles from "../../styles/common.module.css";
import styles from "./album.module.css";
import { measureBuild } from "../../services/buildTiming";
import { Seo } from "../../components/Seo";
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  getCanonicalUrl,
} from "../../lib/seo";

type PageProps = {
  album?: Content;
};

const Album: NextPage<PageProps> = ({ album }) => {
  const router = useRouter();

  // Re-run the hash scroll after client-side navigation. Next.js only honours
  // the URL hash on a full document load, so similar-photo links that navigate
  // to /album/<slug>#<photo-id> would otherwise land at the top of a very tall
  // album. Photo ids contain dots and other characters, so the hash must be
  // decoded before looking up the element.
  React.useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      // Defer to the next frame so the freshly-navigated album's photo
      // elements are in the DOM before we look the anchor up.
      requestAnimationFrame(() => {
        const target = document.getElementById(decodeURIComponent(hash));
        target?.scrollIntoView();
      });
    };

    router.events.on("routeChangeComplete", scrollToHash);
    return () => {
      router.events.off("routeChangeComplete", scrollToHash);
    };
  }, [router.events]);

  if (router.isFallback) {
    return (
      <div className={styles.fallbackPlaceholder}>Loading album&hellip;</div>
    );
  }

  if (!album) {
    return (
      <div className={styles.fallbackPlaceholder}>
        <h1>🔥</h1>
        <Link href="/">404. Back to album list</Link>
      </div>
    );
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

  const albumName = statefulAlbum._build.slug;

  return (
    <>
      <Seo
        title={`${title} | Snapshots`}
        description={
          album.kicker ?? `${title} photo album: ${imageCount} photos`
        }
        pathname={`/album/${statefulAlbum._build.slug}`}
        image={(cover as PhotoBlock | undefined)?._build.srcset?.[0].src}
        type="article"
        extraFeeds={[
          {
            title: `${title} RSS Feed`,
            href: getCanonicalUrl(`/album/${statefulAlbum._build.slug}/feed.xml`),
          },
        ]}
        jsonLd={[
          buildCollectionPageJsonLd({
            name: `${title} | Snapshots`,
            description:
              album.kicker ?? `${title} photo album: ${imageCount} photos`,
            pathname: `/album/${statefulAlbum._build.slug}`,
            image: (cover as PhotoBlock | undefined)?._build.srcset?.[0].src,
          }),
          buildBreadcrumbJsonLd([
            { name: "Snapshots", pathname: "/" },
            {
              name: title,
              pathname: `/album/${statefulAlbum._build.slug}`,
            },
          ]),
        ]}
      />

      <GlobalNav
        extraItems={
          <>
            <li>
              <Link
                href={`/map?filter_album=${albumName}`}
                className={commonStyles.button}
              >
                Album map
              </Link>
            </li>
            <li>
              <Link
                href={`/timeline?filter_album=${albumName}`}
                className={commonStyles.button}
              >
                Album timeline
              </Link>
            </li>
            <li>
              <Link
                href={`/slideshow?filter=${albumName}`}
                className={commonStyles.button}
              >
                Album slideshow
              </Link>
            </li>
          </>
        }
      />
      <main>
        <PhotoAlbum album={statefulAlbum} />
      </main>
      <Footer />
    </>
  );
};

export const getStaticProps: GetStaticProps<
  PageProps,
  { slug: string[] }
> = async (context) => {
  return measureBuild("page./album/[[...slug]].getStaticProps", async () => {
    const slug = context.params?.slug?.[0];
    if (!slug) {
      return { notFound: true };
    }

    // Reject slugs that do not correspond to a real album directory so the
    // styled 404 renders instead of an undesigned "missing" placeholder. With
    // fallback: true a request can arrive for any path, and getAlbumFromName
    // throws on a non-existent directory.
    const albumNames = await getAlbumNames();
    if (!albumNames.includes(slug)) {
      return { notFound: true };
    }

    const album = await getAlbumFromName(slug);

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
