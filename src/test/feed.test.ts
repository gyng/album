import { buildFeedXml, getServerSideProps as getFeedProps } from "../pages/feed.xml";
import {
  getAlbumFeedEntries,
  getAlbumFeedEntry,
  getAlbumFeedItems,
} from "../services/albumFeed";
import {
  buildAlbumFeedXml,
  getServerSideProps as getAlbumFeedProps,
} from "../pages/album/[slug]/feed.xml";
import type { ServerResponse, IncomingMessage } from "http";
import type { GetServerSidePropsContext } from "next";

jest.mock("../services/albumFeed", () => ({
  getAlbumFeedEntries: jest.fn(),
  getAlbumFeedEntry: jest.fn(),
  getAlbumFeedItems: jest.fn(),
}));

describe("RSS feed", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://photos.example.com";
    (getAlbumFeedEntries as jest.Mock).mockReset();
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

  it("serves feed xml from the route", async () => {
    (getAlbumFeedEntries as jest.Mock).mockResolvedValue([
      {
        slug: "trip",
        title: "Trip",
        description: "Trip photo album",
        lastmod: "2025-02-01",
      },
    ]);

    const write = jest.fn();
    const end = jest.fn();
    const setHeader = jest.fn();

    await getFeedProps({
      req: { cookies: {} } as IncomingMessage & { cookies: Record<string, string> },
      query: {},
      resolvedUrl: "/feed.xml",
      res: { write, end, setHeader } as unknown as ServerResponse<IncomingMessage>,
    } as GetServerSidePropsContext);

    expect(getAlbumFeedEntries).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/rss+xml; charset=utf-8",
    );
    expect(write.mock.calls[0][0]).toContain(
      "<link>https://photos.example.com/album/trip</link>",
    );
  });

  it("serves the per-album feed route", async () => {
    (getAlbumFeedEntry as jest.Mock).mockResolvedValue({
      slug: "trip",
      title: "Trip",
      description: "Trip photo album",
      lastmod: "2025-02-01",
    });
    (getAlbumFeedItems as jest.Mock).mockResolvedValue([
      {
        title: "Bridge at dusk",
        description: "Bridge at dusk from trip",
        link: "/album/trip#bridge.jpg",
        pubDate: "2025-01-30",
      },
    ]);

    const write = jest.fn();
    const end = jest.fn();
    const setHeader = jest.fn();

    await getAlbumFeedProps({
      req: { cookies: {} } as IncomingMessage & { cookies: Record<string, string> },
      params: { slug: "trip" },
      query: {},
      resolvedUrl: "/album/trip/feed.xml",
      res: { write, end, setHeader } as unknown as ServerResponse<IncomingMessage>,
    } as GetServerSidePropsContext);

    expect(getAlbumFeedEntry).toHaveBeenCalledWith("trip");
    expect(getAlbumFeedItems).toHaveBeenCalledWith("trip");
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/rss+xml; charset=utf-8",
    );
    expect(write.mock.calls[0][0]).toContain(
      "<link>https://photos.example.com/album/trip#bridge.jpg</link>",
    );
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
});
