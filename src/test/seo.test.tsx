/**
 * @jest-environment node
 */

import React from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { NextPlatformProvider } from "../components/platform/next/NextPlatformProvider";

const renderToStaticMarkup = (node: React.ReactNode): string =>
  renderMarkup(<NextPlatformProvider>{node}</NextPlatformProvider>);

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../services/album", () => ({
  getAlbumFromName: jest.fn(),
  getAlbumNames: jest.fn(),
}));

const useRouter = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => useRouter(),
}));

jest.mock("../components/Nav", () => ({
  Nav: () => null,
}));

jest.mock("../components/PhotoAlbum", () => ({
  PhotoAlbum: () => null,
}));

import { Seo } from "../components/Seo";
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
  getCanonicalUrl,
  getDefaultSocialImageUrl,
  getSiteOrigin,
  resolveAbsoluteUrl,
} from "../lib/seo";
import { buildSitemapXml } from "../lib/sitemap";
const { buildRobotsTxt } = require("../bin/generate-feeds.cjs");

const AlbumPage = require("../screens/album/AlbumScreen").default;
const MapPage = require("../screens/map/MapScreen").default;
const TimelinePage = require("../screens/timeline/TimelineScreen").default;

describe("SEO helpers", () => {
  const siteOrigin = "https://photos.example.com";
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NEXT_PUBLIC_SITE_URL: "https://photos.example.com" };
    useRouter.mockReturnValue({
      pathname: "/",
      query: {},
      replace: jest.fn(),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("renders canonical, social tags, and robots directives", () => {
    const html = renderToStaticMarkup(
      <Seo
        title="Search | Snapshots"
        description="Search the photo archive."
        pathname="/search"
        noindex
        image="https://photos.example.com/cover.jpg"
        jsonLd={buildCollectionPageJsonLd(
          {
            name: "Search | Snapshots",
            description: "Search the photo archive.",
            pathname: "/search",
          },
          siteOrigin,
        )}
      />,
    );

    expect(html).toContain("<title>Search | Snapshots</title>");
    expect(html).toContain('name="description" content="Search the photo archive."');
    expect(html).toContain('rel="canonical" href="https://photos.example.com/search"');
    expect(html).toContain(
      'rel="alternate" type="application/rss+xml" title="Snapshots RSS Feed" href="https://photos.example.com/feed.xml"',
    );
    expect(html).toContain('property="og:url" content="https://photos.example.com/search"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('type="application/ld+json"');
  });

  it("builds canonical URLs from the configured site origin", () => {
    expect(getCanonicalUrl("/timeline", siteOrigin)).toBe("https://photos.example.com/timeline");
  });

  it("normalises configured and deployment site origins", () => {
    expect(getSiteOrigin("http://photos.internal/")).toBe("http://photos.internal");
    expect(getSiteOrigin("gallery.example.com/")).toBe("https://gallery.example.com");
    expect(getSiteOrigin()).toBe("https://photos.awoo.party");
  });

  it("normalises canonical paths and resolves only relative asset URLs", () => {
    expect(getCanonicalUrl("/", siteOrigin)).toBe("https://photos.example.com/");
    expect(getCanonicalUrl("timeline", siteOrigin)).toBe("https://photos.example.com/timeline");
    expect(resolveAbsoluteUrl()).toBeUndefined();
    expect(resolveAbsoluteUrl("https://cdn.example.com/photo.jpg")).toBe(
      "https://cdn.example.com/photo.jpg",
    );
    expect(resolveAbsoluteUrl("//cdn.example.com/photo.jpg")).toBe("//cdn.example.com/photo.jpg");
    expect(resolveAbsoluteUrl("data:image/gif;base64,AAAA")).toBe("data:image/gif;base64,AAAA");
    expect(resolveAbsoluteUrl("photos/cover.jpg", siteOrigin)).toBe(
      "https://photos.example.com/photos/cover.jpg",
    );
  });

  it("uses the default social preview image when no page image is supplied", () => {
    expect(getDefaultSocialImageUrl(siteOrigin)).toBe(
      "https://photos.example.com/social-preview.svg",
    );
  });

  it("builds robots.txt with sitemap and utility route exclusions", () => {
    expect(buildRobotsTxt()).toContain("Disallow: /search");
    expect(buildRobotsTxt()).toContain("Disallow: /slideshow");
    expect(buildRobotsTxt()).toContain("Sitemap: https://photos.example.com/sitemap.xml");
  });

  it("builds sitemap.xml for core pages and albums", () => {
    const xml = buildSitemapXml(
      [
        { path: "/", lastmod: "2025-01-01" },
        { path: "/map", lastmod: "2025-01-01" },
        { path: "/album/trip", lastmod: "2024-12-31" },
      ],
      siteOrigin,
    );

    expect(xml).toContain("<loc>https://photos.example.com/</loc>");
    expect(xml).toContain("<lastmod>2025-01-01</lastmod>");
    expect(xml).toContain("<loc>https://photos.example.com/map</loc>");
    expect(xml).toContain("<loc>https://photos.example.com/album/trip</loc>");
  });

  it("XML-escapes ampersands and percent-encodes spaces in <loc>", () => {
    const xml = buildSitemapXml([{ path: "/album/food & drink" }], siteOrigin);

    expect(xml).toContain("<loc>https://photos.example.com/album/food%20&amp;%20drink</loc>");
    expect(xml).not.toContain("food & drink");
  });

  it("percent-encodes non-ASCII album slugs in canonical URLs", () => {
    // Canonical and sitemap must agree byte-for-byte for e.g. "türkiye".
    expect(getCanonicalUrl("/album/türkiye", siteOrigin)).toBe(
      "https://photos.example.com/album/t%C3%BCrkiye",
    );
  });

  it("resolves a relative page image to absolute og:image/twitter:image", () => {
    const html = renderToStaticMarkup(
      <Seo image="/data/albums/trip/cover.avif" pathname="/album/trip" />,
    );

    expect(html).toContain(
      'property="og:image" content="https://photos.example.com/data/albums/trip/cover.avif"',
    );
    expect(html).toContain(
      'name="twitter:image" content="https://photos.example.com/data/albums/trip/cover.avif"',
    );
  });

  it("escapes < in JSON-LD to prevent </script> injection", () => {
    const html = renderToStaticMarkup(
      <Seo
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Thing",
          name: "</script><script>alert(1)</script>",
        }}
      />,
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("\\u003c");
  });

  it("builds reusable JSON-LD payloads", () => {
    const website = buildWebSiteJsonLd(siteOrigin);
    const collection = buildCollectionPageJsonLd(
      {
        name: "Timeline | Snapshots",
        description: "Explore dated photos across the archive timeline.",
        pathname: "/timeline",
      },
      siteOrigin,
    );
    const breadcrumbs = buildBreadcrumbJsonLd(
      [
        { name: "Snapshots", pathname: "/" },
        { name: "Timeline", pathname: "/timeline" },
      ],
      siteOrigin,
    );

    expect(website["@type"]).toBe("WebSite");
    expect(collection.url).toBe("https://photos.example.com/timeline");
    expect((breadcrumbs.itemListElement as Array<{ item: string }>)[1]?.item).toBe(
      "https://photos.example.com/timeline",
    );

    expect(
      buildCollectionPageJsonLd(
        {
          name: "Trip",
          description: "Trip photos",
          pathname: "/album/trip",
          image: "https://photos.example.com/cover.jpg",
        },
        siteOrigin,
      ).image,
    ).toBe("https://photos.example.com/cover.jpg");
  });

  it("renders album page metadata with cover image and breadcrumb schema", () => {
    const html = renderToStaticMarkup(
      <AlbumPage
        album={{
          name: "trip",
          title: "Tokyo Trip",
          kicker: "Spring photos from Tokyo.",
          blocks: [
            {
              kind: "photo",
              id: "cover.jpg",
              data: { src: "cover.jpg" },
              formatting: { cover: true },
              _build: {
                width: 1200,
                height: 630,
                exif: {},
                tags: {},
                srcset: [
                  {
                    src: "https://photos.example.com/cover.jpg",
                    width: 1200,
                    height: 630,
                  },
                ],
              },
            },
          ],
          formatting: {},
          _build: { slug: "trip", srcdir: "../albums/trip" },
        }}
      />,
    );

    expect(html).toContain("<title>Tokyo Trip | Snapshots</title>");
    expect(html).toContain('property="og:image" content="https://photos.example.com/cover.jpg"');
    expect(html).toContain("BreadcrumbList");
    expect(html).toContain("https://photos.example.com/album/trip");
    expect(html).toContain(
      'rel="alternate" type="application/rss+xml" title="Tokyo Trip RSS Feed" href="https://photos.example.com/album/trip/feed.xml"',
    );
  });

  it("marks filtered map views as noindex while keeping the base canonical", () => {
    useRouter.mockReturnValue({
      pathname: "/map",
      query: { filter_album: "trip" },
      replace: jest.fn(),
    });

    const html = renderToStaticMarkup(<MapPage photos={[]} />);

    expect(html).toContain('rel="canonical" href="https://photos.example.com/map"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("marks dated timeline views as noindex while keeping the base canonical", () => {
    useRouter.mockReturnValue({
      pathname: "/timeline",
      query: { date: "2024-04-07" },
      replace: jest.fn(),
    });

    const html = renderToStaticMarkup(<TimelinePage entries={[]} />);

    expect(html).toContain('rel="canonical" href="https://photos.example.com/timeline"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });
});
