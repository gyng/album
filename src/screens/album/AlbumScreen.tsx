import {
  AppLink as Link,
  useAfterNavigation,
  usePublicConfig,
  useUrlSearchParams,
} from "../../components/platform";
import { seekLinkedMoment } from "../../util/seekLinkedMoment";
import React from "react";
import type { PhotoBlock } from "../../services/types";
import { GlobalNav } from "../../components/GlobalNav";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { AlbumTripsView } from "../../components/AlbumTripsView";
import { Footer, buttonStyles } from "../../components/ui";
import commonStyles from "../../styles/common.module.css";
import type { AlbumPageData } from "../../util/pageDataTypes";
import { Seo } from "../../components/Seo";
import {
  SITE_NAME,
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  formatPageTitle,
  getCanonicalUrl,
  resolveAbsoluteUrl,
} from "../../lib/seo";

export type AlbumScreenProps = AlbumPageData;

const AlbumScreen = ({ album }: AlbumScreenProps) => {
  const { siteOrigin } = usePublicConfig();
  const { getSearchParam, ready } = useUrlSearchParams();
  // The grid stays the default. Trips is a second reading of the same photos,
  // and it is a URL so a particular album's journeys can be linked to.
  const view = ready && getSearchParam("view") === "trips" ? "trips" : "grid";
  // Re-run the hash scroll after client-side navigation. Photo ids contain
  // dots and other characters, so decode the hash before looking up the node.
  const scrollToHash = React.useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    // Defer to the next frame so the freshly-navigated album's photo elements
    // are in the DOM before looking the anchor up.
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
      seekLinkedMoment(getSearchParam);
    });
  }, [getSearchParam]);
  useAfterNavigation(scrollToHash);

  // On first load the browser scrolls to the anchor itself, but nothing seeks
  // the clip — so only that half runs on mount, deferred a frame so the video
  // element exists to be seeked.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => seekLinkedMoment(getSearchParam));
    return () => cancelAnimationFrame(frame);
  }, [getSearchParam]);

  // SEO/Meta tag generation
  const title = album.title ?? album.name ?? album._build.slug;

  const imageCount = album.blocks.filter((b) => b.kind === "photo").length;

  const cover =
    album.blocks.find((b) => b.kind === "photo" && b.formatting?.cover) ??
    album.blocks.find((b) => b.kind === "photo");

  const albumName = album._build.slug;

  const coverImageSrc = (cover as PhotoBlock | undefined)?._build.srcset?.[0]?.src;
  const coverImageAbsolute = resolveAbsoluteUrl(coverImageSrc, siteOrigin);

  return (
    <>
      <Seo
        title={formatPageTitle(title)}
        description={album.kicker ?? `${title} photo album: ${imageCount} photos`}
        pathname={`/album/${album._build.slug}`}
        {...(coverImageSrc ? { image: coverImageSrc } : {})}
        type="article"
        extraFeeds={[
          {
            title: `${title} RSS Feed`,
            href: getCanonicalUrl(`/album/${album._build.slug}/feed.xml`, siteOrigin),
          },
        ]}
        jsonLd={[
          buildCollectionPageJsonLd(
            {
              name: formatPageTitle(title),
              description: album.kicker ?? `${title} photo album: ${imageCount} photos`,
              pathname: `/album/${album._build.slug}`,
              ...(coverImageAbsolute ? { image: coverImageAbsolute } : {}),
            },
            siteOrigin,
          ),
          buildBreadcrumbJsonLd(
            [
              { name: SITE_NAME, pathname: "/" },
              {
                name: title,
                pathname: `/album/${album._build.slug}`,
              },
            ],
            siteOrigin,
          ),
        ]}
      />

      <GlobalNav
        extraItems={
          <>
            <li>
              {/* One of the album's views, named like its siblings here rather
                  than shaped as a switch — and a link, so it survives without
                  JavaScript and can be shared. Putting it above the photographs
                  pushed the first one below the fold on a split-screen tablet. */}
              <Link
                href={view === "trips" ? `/album/${albumName}` : `/album/${albumName}?view=trips`}
                className={`${buttonStyles.base} ${commonStyles.navContext}`}
              >
                {view === "trips" ? "Album grid" : "Album trips"}
              </Link>
            </li>
            <li>
              <Link
                href={`/map?filter_album=${albumName}`}
                className={`${buttonStyles.base} ${commonStyles.navContext}`}
              >
                Album map
              </Link>
            </li>
            <li>
              <Link
                href={`/timeline?filter_album=${albumName}`}
                className={`${buttonStyles.base} ${commonStyles.navContext}`}
              >
                Album timeline
              </Link>
            </li>
            <li>
              <Link
                href={`/slideshow?filter=${albumName}`}
                className={`${buttonStyles.base} ${commonStyles.navContext}`}
              >
                Album slideshow
              </Link>
            </li>
          </>
        }
      />
      <main id="main-content">
        {view === "trips" ? <AlbumTripsView album={album} /> : <PhotoAlbum album={album} />}
      </main>
      <Footer />
    </>
  );
};

export default AlbumScreen;
