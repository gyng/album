import { buildRssXml, escapeXml, toRssDate } from "../lib/rss";
const { generateAlbumFeed, generateMainFeed } = require("../bin/generate-feeds.cjs") as {
  generateMainFeed: typeof buildFeedXml;
  generateAlbumFeed: typeof buildAlbumFeedXml;
};

/** Mirrors the main feed builder from bin/generate-feeds.cjs for unit testing. */
const buildFeedXml = (
  entries: Array<{
    slug: string;
    title: string;
    description: string;
    lastmod: string;
  }>,
): string => {
  return generateMainFeed(entries);
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
  return generateAlbumFeed(entry, items);
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

    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Tokyo Trip</title>");
    expect(xml).toContain("<link>https://photos.example.com/album/tokyo</link>");
    expect(xml).toContain(
      "<description>Spring photos from Tokyo - city walks and train rides.</description>",
    );
    expect(xml).toContain('<atom:link href="https://photos.example.com/feed.xml"');
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
    expect(xml).toContain('<atom:link href="https://photos.example.com/album/tokyo/feed.xml"');
    expect(xml).toContain("<guid>https://photos.example.com/album/tokyo#shibuya.jpg</guid>");
  });

  it("omits the optional build date when a feed has no entries", () => {
    const xml = buildFeedXml([]);

    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).not.toContain("<item>");
  });

  it("escapes XML special characters", () => {
    expect(escapeXml(`Tom & Jerry's "<3>"`)).toBe("Tom &amp; Jerry&apos;s &quot;&lt;3&gt;&quot;");
  });

  it("converts dates to RSS format", () => {
    expect(toRssDate("2025-03-10")).toBe("Mon, 10 Mar 2025 00:00:00 GMT");
  });

  it("builds the shared RSS representation with items and an optional build date", () => {
    const xml = buildRssXml({
      title: "Archive & updates",
      link: "https://photos.example.com",
      description: "New <photos>",
      selfUrl: "https://photos.example.com/feed.xml",
      lastBuildDate: "Mon, 10 Mar 2025 00:00:00 GMT",
      items: [
        {
          title: "Tokyo's night",
          link: "https://photos.example.com/album/tokyo",
          guid: "tokyo-1",
          description: 'Neon "streets"',
          pubDate: "Sun, 09 Mar 2025 00:00:00 GMT",
        },
      ],
    });

    expect(xml).toContain("<title>Archive &amp; updates</title>");
    expect(xml).toContain("<title>Tokyo&apos;s night</title>");
    expect(xml).toContain("<lastBuildDate>Mon, 10 Mar 2025 00:00:00 GMT</lastBuildDate>");
    expect(xml).toContain("<description>Neon &quot;streets&quot;</description>");
  });

  it("omits the shared RSS build date when it is unavailable", () => {
    const xml = buildRssXml({
      title: "Archive",
      link: "https://photos.example.com",
      description: "Updates",
      selfUrl: "https://photos.example.com/feed.xml",
      items: [],
    });

    expect(xml).not.toContain("<lastBuildDate>");
  });
});
