import type { GetServerSideProps } from "next";
import { getAlbumFeedEntries } from "../services/albumFeed";
import { getCanonicalUrl, getDefaultSeo } from "../lib/seo";
import { buildRssXml, toRssDate } from "../lib/rss";

export const buildFeedXml = (
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

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const entries = await getAlbumFeedEntries();

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.write(buildFeedXml(entries));
  res.end();

  return {
    props: {},
  };
};

const FeedXml = () => null;

export default FeedXml;
