import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { getAlbumFromName, getAlbumNames } from "../../services/album";
import { Content, PhotoBlock } from "../../services/types";
import { GlobalNav } from "../../components/GlobalNav";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { Footer, buttonStyles } from "../../components/ui";
import { measureBuild } from "../../services/buildTiming";
import { Seo } from "../../components/Seo";
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  getCanonicalUrl,
  resolveAbsoluteUrl,
} from "../../lib/seo";

type PageProps = {
  album: Content;
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
        // A malformed percent-sequence (e.g. a bare "%") throws URIError; fall
        // back to the raw hash rather than crashing the navigation handler.
        let id = hash;
        try {
          id = decodeURIComponent(hash);
        } catch {
          id = hash;
        }
        const target = document.getElementById(id);
        target?.scrollIntoView();
      });
    };

    router.events.on("routeChangeComplete", scrollToHash);
    return () => {
      router.events.off("routeChangeComplete", scrollToHash);
    };
  }, [router.events]);

  // SEO/Meta tag generation
  const title = album.title ?? album.name ?? album._build.slug;

  const imageCount = album.blocks.filter((b) => b.kind === "photo").length;

  const cover =
    album.blocks.find((b) => b.kind === "photo" && b.formatting?.cover) ??
    album.blocks.find((b) => b.kind === "photo");

  const albumName = album._build.slug;

  return (
    <>
      <Seo
        title={`${title} | Snapshots`}
        description={album.kicker ?? `${title} photo album: ${imageCount} photos`}
        pathname={`/album/${album._build.slug}`}
        image={(cover as PhotoBlock | undefined)?._build.srcset?.[0].src}
        type="article"
        extraFeeds={[
          {
            title: `${title} RSS Feed`,
            href: getCanonicalUrl(`/album/${album._build.slug}/feed.xml`),
          },
        ]}
        jsonLd={[
          buildCollectionPageJsonLd({
            name: `${title} | Snapshots`,
            description: album.kicker ?? `${title} photo album: ${imageCount} photos`,
            pathname: `/album/${album._build.slug}`,
            image: resolveAbsoluteUrl((cover as PhotoBlock | undefined)?._build.srcset?.[0]?.src),
          }),
          buildBreadcrumbJsonLd([
            { name: "Snapshots", pathname: "/" },
            {
              name: title,
              pathname: `/album/${album._build.slug}`,
            },
          ]),
        ]}
      />

      <GlobalNav
        extraItems={
          <>
            <li>
              <Link href={`/map?filter_album=${albumName}`} className={buttonStyles.base}>
                Album map
              </Link>
            </li>
            <li>
              <Link href={`/timeline?filter_album=${albumName}`} className={buttonStyles.base}>
                Album timeline
              </Link>
            </li>
            <li>
              <Link href={`/slideshow?filter=${albumName}`} className={buttonStyles.base}>
                Album slideshow
              </Link>
            </li>
          </>
        }
      />
      <main id="main-content">
        <PhotoAlbum album={album} />
      </main>
      <Footer />
    </>
  );
};

export const getStaticProps: GetStaticProps<PageProps, { slug: string[] }> = async (context) => {
  return measureBuild("page./album/[[...slug]].getStaticProps", async () => {
    const slug = context.params?.slug?.[0];
    if (!slug) {
      return { notFound: true };
    }

    // With fallback: false only slugs returned by getStaticPaths are ever
    // rendered, and always at build time where the ../albums source exists, so
    // getAlbumFromName is guaranteed to resolve a real directory here.
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
    // Every album is known at build time and ../albums is not deployed to the
    // Vercel lambda, so fallback: false gives the styled 404 for unknown slugs
    // instead of a 500 (getAlbumNames would throw reading a missing directory).
    const paths = (await getAlbumNames()).map((n) => `/album/${n}`);
    return {
      paths,
      fallback: false,
    };
  });
};

export default Album;
