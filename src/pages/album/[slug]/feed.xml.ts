import type { GetServerSideProps } from "next";
import {
  getAlbumFeedEntry,
  getAlbumFeedItems,
} from "../../../services/album";
import { getCanonicalUrl } from "../../../lib/seo";
import { buildRssXml, toRssDate } from "../../../lib/rss";

export const buildAlbumFeedXml = (
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

export const getServerSideProps: GetServerSideProps = async ({ params, res }) => {
  const slug = typeof params?.slug === "string" ? params.slug : null;

  if (!slug) {
    res.statusCode = 404;
    res.end("Not found");
    return { props: {} };
  }

  const entry = await getAlbumFeedEntry(slug);
  const items = await getAlbumFeedItems(slug);

  if (!entry) {
    res.statusCode = 404;
    res.end("Not found");
    return { props: {} };
  }

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.write(buildAlbumFeedXml(entry, items));
  res.end();

  return {
    props: {},
  };
};

const AlbumFeedXml = () => null;

export default AlbumFeedXml;
