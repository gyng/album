import { buildRssXml, escapeXml, toRssDate } from "../lib/rss";
import { getCanonicalUrl, getDefaultSeo } from "../lib/seo";

/** Mirrors the main feed builder from bin/generate-feeds.cjs for unit testing. */
const buildFeedXml = (
  entries: Array<{
    slug: string;
    title: string;
    description: string;
    lastmod: string;
  }>,
): string => {
  const defaults = getDefaultSeo();
  const siteUrl = getCanonicalUrl("/");
  const feedUrl = getCanonicalUrl("/feed.xml");

  return buildRssXml({
    title: defaults.siteName,
    link: siteUrl,
    description: defaults.defaultDescription,
    selfUrl: feedUrl,
    lastBuildDate: entries[0]?.lastmod ? toRssDate(entries[0].lastmod) : undefined,
    items: entries.map((entry) => ({
      title: entry.title,
      link: getCanonicalUrl(`/album/${entry.slug}`),
      guid: getCanonicalUrl(`/album/${entry.slug}`),
      description: entry.description,
      pubDate: toRssDate(entry.lastmod),
    })),
  });
};

/** Mirrors the per-album feed builder from bin/generate-feeds.cjs for unit testing. */
const buildAlbumFeedXml = (
  entry: {
    slug: string;
    title: string;
    description: string;
    lastmod: string;
  },
  items: Array<{
    title: string;
    description: string;
    link: string;
    pubDate: string;
  }>,
): string => {
  const albumUrl = getCanonicalUrl(`/album/${entry.slug}`);
  const feedUrl = getCanonicalUrl(`/album/${entry.slug}/feed.xml`);

  return buildRssXml({
    title: `${entry.title} | Snapshots`,
    link: albumUrl,
    description: entry.description,
    selfUrl: feedUrl,
    lastBuildDate: toRssDate(entry.lastmod),
    items: items.map((item) => ({
      title: item.title,
      link: getCanonicalUrl(item.link),
      guid: getCanonicalUrl(item.link),
      description: item.description,
      pubDate: toRssDate(item.pubDate),
    })),
  });
};

describe("RSS feed", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://photos.example.com";
  });

  it("builds RSS xml for album updates", () => {
    const xml = buildFeedXml([
      {
        slug: "tokyo",
        title: "Tokyo Trip",
        description: "Spring photos from Tokyo - city walks and train rides.",
        lastmod: "2025-03-10",
      },
      {
        slug: "kansai",
        title: "Kansai",
        description: "Autumn photos in Kansai.",
        lastmod: "2025-02-01",
      },
    ]);

    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain("<title>Tokyo Trip</title>");
    expect(xml).toContain("<link>https://photos.example.com/album/tokyo</link>");
    expect(xml).toContain(
      "<description>Spring photos from Tokyo - city walks and train rides.</description>",
    );
    expect(xml).toContain("<atom:link href=\"https://photos.example.com/feed.xml\"");
    expect(xml).toContain("<lastBuildDate>Mon, 10 Mar 2025 00:00:00 GMT</lastBuildDate>");
  });

  it("builds a per-album rss feed", () => {
    const xml = buildAlbumFeedXml(
      {
        slug: "tokyo",
        title: "Tokyo Trip",
        description: "Spring photos from Tokyo.",
        lastmod: "2025-03-10",
      },
      [
        {
          title: "Shibuya crossing",
          description: "Night street scene",
          link: "/album/tokyo#shibuya.jpg",
          pubDate: "2025-03-09",
        },
      ],
    );

    expect(xml).toContain("<title>Tokyo Trip | Snapshots</title>");
    expect(xml).toContain(
      "<atom:link href=\"https://photos.example.com/album/tokyo/feed.xml\"",
    );
    expect(xml).toContain(
      "<guid>https://photos.example.com/album/tokyo#shibuya.jpg</guid>",
    );
  });

  it("escapes XML special characters", () => {
    expect(escapeXml("Tom & Jerry <3>")).toBe("Tom &amp; Jerry &lt;3&gt;");
  });

  it("converts dates to RSS format", () => {
    expect(toRssDate("2025-03-10")).toBe("Mon, 10 Mar 2025 00:00:00 GMT");
  });
});
