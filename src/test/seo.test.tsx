/**
 * @jest-environment node
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../services/album", () => ({
  getAlbumFromName: jest.fn(),
  getAlbumNames: jest.fn(),
}));

jest.mock("../services/albumFeed", () => ({
  getAlbumSitemapEntries: jest.fn(),
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
} from "../lib/seo";
import { buildRobotsTxt } from "../pages/robots.txt";
import { buildSitemapXml, getServerSideProps as getSitemapProps } from "../pages/sitemap.xml";
import {
  getAlbumSitemapEntries,
} from "../services/albumFeed";

const AlbumPage = require("../pages/album/[[...slug]]").default;
const MapPage = require("../pages/map/index").default;
const TimelinePage = require("../pages/timeline/index").default;

describe("SEO helpers", () => {
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
        title="Search & Explore | Snapshots"
        description="Search the photo archive."
        pathname="/search"
        noindex
        image="https://photos.example.com/cover.jpg"
        jsonLd={buildCollectionPageJsonLd({
          name: "Search & Explore | Snapshots",
          description: "Search the photo archive.",
          pathname: "/search",
        })}
      />,
    );

    expect(html).toContain("<title>Search &amp; Explore | Snapshots</title>");
    expect(html).toContain(
      'name="description" content="Search the photo archive."',
    );
    expect(html).toContain(
      'rel="canonical" href="https://photos.example.com/search"',
    );
    expect(html).toContain(
      'rel="alternate" type="application/rss+xml" title="Snapshots RSS Feed" href="https://photos.example.com/feed.xml"',
    );
    expect(html).toContain('property="og:url" content="https://photos.example.com/search"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(
      'type="application/ld+json"',
    );
  });

  it("builds canonical URLs from the configured site origin", () => {
    expect(getCanonicalUrl("/timeline")).toBe("https://photos.example.com/timeline");
  });

  it("uses the default social preview image when no page image is supplied", () => {
    expect(getDefaultSocialImageUrl()).toBe(
      "https://photos.example.com/social-preview.svg",
    );
  });

  it("builds robots.txt with sitemap and utility route exclusions", () => {
    expect(buildRobotsTxt()).toContain("Disallow: /search");
    expect(buildRobotsTxt()).toContain("Disallow: /slideshow");
    expect(buildRobotsTxt()).toContain(
      "Sitemap: https://photos.example.com/sitemap.xml",
    );
  });

  it("builds sitemap.xml for core pages and albums", () => {
    const xml = buildSitemapXml([
      { path: "/", lastmod: "2025-01-01" },
      { path: "/map", lastmod: "2025-01-01" },
      { path: "/album/trip", lastmod: "2024-12-31" },
    ]);

    expect(xml).toContain("<loc>https://photos.example.com/</loc>");
    expect(xml).toContain("<lastmod>2025-01-01</lastmod>");
    expect(xml).toContain("<loc>https://photos.example.com/map</loc>");
    expect(xml).toContain("<loc>https://photos.example.com/album/trip</loc>");
  });

  it("builds reusable JSON-LD payloads", () => {
    const website = buildWebSiteJsonLd();
    const collection = buildCollectionPageJsonLd({
      name: "Timeline | Snapshots",
      description: "Explore dated photos across the archive timeline.",
      pathname: "/timeline",
    });
    const breadcrumbs = buildBreadcrumbJsonLd([
      { name: "Snapshots", pathname: "/" },
      { name: "Timeline", pathname: "/timeline" },
    ]);

    expect(website["@type"]).toBe("WebSite");
    expect(collection.url).toBe("https://photos.example.com/timeline");
    expect(
      (breadcrumbs.itemListElement as Array<{ item: string }>)[1]?.item,
    ).toBe("https://photos.example.com/timeline");
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
    expect(html).toContain(
      'property="og:image" content="https://photos.example.com/cover.jpg"',
    );
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

    expect(html).toContain(
      'rel="canonical" href="https://photos.example.com/timeline"',
    );
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });
});

describe("sitemap route", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://photos.example.com";
    (getAlbumSitemapEntries as jest.Mock).mockReset();
  });

  it("requests album sitemap entries for sitemap generation", async () => {
    (getAlbumSitemapEntries as jest.Mock).mockResolvedValue([
      { slug: "trip", lastmod: "2025-02-01" },
      { slug: "tokyo", lastmod: "2025-03-10" },
    ]);

    const write = jest.fn();
    const end = jest.fn();
    const setHeader = jest.fn();

    await getSitemapProps({
      res: { write, end, setHeader },
    });

    expect(getAlbumSitemapEntries).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/xml; charset=utf-8",
    );
    expect(write.mock.calls[0][0]).toContain("<lastmod>2025-03-10</lastmod>");
    expect(write.mock.calls[0][0]).toContain(
      "<loc>https://photos.example.com/album/tokyo</loc>",
    );
  });
});
