import {
  AppLink as Link,
  useAfterNavigation,
  usePublicConfig,
  useUrlSearchParams,
} from "../../components/platform";
import { seekLinkedMoment } from "../../util/seekLinkedMoment";
import React from "react";
import { AlbumNavigation } from "../../components/AlbumNavigation";
import { GlobalNav } from "../../components/GlobalNav";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { AlbumTripsView } from "../../components/AlbumTripsView";
import { AlbumNeighbours } from "../../components/AlbumNeighbours";
import { getDisplayDimensions } from "../../util/photoDimensions";
import { coverBlockOf, mediaBlockAsPhoto } from "../../util/videoBlockMedia";
import { Footer, buttonStyles } from "../../components/ui";
import commonStyles from "../../styles/common.module.css";
import styles from "./AlbumScreen.module.css";
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
  // Scroll to the photo the hash names and seek a linked moment in a clip.
  // Photo ids contain dots and other characters, so the hash is decoded before
  // the node is looked up — and this runs on first load as well as after
  // client-side navigation. The framework's own mount-time hash scroll looks the
  // element up by the raw hash, so a photo whose name has a space ("2015-10-18
  // 16.10.22.jpg", which reaches the URL as %20) never matched it, and a shared
  // link to that photo opened at the top of the album.
  const applyHash = React.useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      // A malformed percent-sequence (e.g. a bare "%") throws URIError; fall
      // back to the raw hash rather than crashing the navigation handler.
      let id = hash;
      try {
        id = decodeURIComponent(hash);
      } catch {
        id = hash;
      }
      document.getElementById(id)?.scrollIntoView();
    }
    seekLinkedMoment(getSearchParam);
  }, [getSearchParam]);

  // Deferred a frame so the freshly-navigated album's photo elements are in the
  // DOM before the anchor is looked up, and the video element exists to be
  // seeked.
  const scrollToHash = React.useCallback(() => {
    requestAnimationFrame(applyHash);
  }, [applyHash]);
  useAfterNavigation(scrollToHash);

  React.useEffect(() => {
    const frame = requestAnimationFrame(applyHash);
    return () => cancelAnimationFrame(frame);
  }, [applyHash]);

  // SEO/Meta tag generation
  const title = album.title ?? album.name ?? album._build.slug;

  // A clip is media too: it belongs in the count shown to readers, and its
  // poster frame can stand as the album's cover. An album of clips alone is
  // described as clips rather than as zero photos.
  const photoCount = album.blocks.filter((block) => block.kind === "photo").length;
  const clipCount = album.blocks.filter((block) => block.kind === "video").length;
  const mediaCount =
    clipCount === 0
      ? `${photoCount + clipCount} photos`
      : [
          photoCount > 0 ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"}` : null,
          `${clipCount} ${clipCount === 1 ? "clip" : "clips"}`,
        ]
          .filter(Boolean)
          .join(" and ");

  const cover = coverBlockOf(album.blocks);

  const albumName = album._build.slug;
  // The neighbouring albums line up with the edges of the album's widest frame,
  // a clip's poster included.
  const widest = album.blocks
    .flatMap((block) => {
      const media = mediaBlockAsPhoto(block);
      return media ? [getDisplayDimensions(media)] : [];
    })
    .reduce<{ width: number; height: number } | null>(
      (best, each) =>
        !best || each.width / Math.max(1, each.height) > best.width / Math.max(1, best.height)
          ? each
          : best,
      null,
    );

  const coverImageSrc = cover?._build.srcset?.[0]?.src;
  const coverImageAbsolute = resolveAbsoluteUrl(coverImageSrc, siteOrigin);

  return (
    <>
      <Seo
        title={formatPageTitle(title)}
        description={album.kicker ?? `${title} photo album: ${mediaCount}`}
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
              description: album.kicker ?? `${title} photo album: ${mediaCount}`,
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

      <AlbumNavigation
        routeKey={`${albumName}:${view}`}
        navigation={
          <GlobalNav
            themeAdjacentItem={
              <div className={styles.controls} role="group" aria-label="Album navigation">
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

                <Link
                  href={`/map?${new URLSearchParams({ filter_album: albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album map
                </Link>

                <Link
                  href={`/explore/timeline?${new URLSearchParams({ filter_album: albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album timeline
                </Link>

                <Link
                  href={`/slideshow/shell?${new URLSearchParams({ filter: albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album slideshow
                </Link>
              </div>
            }
          />
        }
      >
        <main id="main-content">
          {view === "trips" ? <AlbumTripsView album={album} /> : <PhotoAlbum album={album} />}
          <AlbumNeighbours slug={albumName} {...(widest ? { frame: widest } : {})} />
        </main>
        <Footer />
      </AlbumNavigation>
    </>
  );
};

export default AlbumScreen;
