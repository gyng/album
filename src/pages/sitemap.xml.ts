import type { GetServerSideProps } from "next";
import { getAlbumSitemapEntries } from "../services/album";
import { getCanonicalUrl } from "../lib/seo";

type SitemapEntry = {
  path: string;
  lastmod?: string;
};

const buildSitemapXml = (entries: SitemapEntry[]): string => {
  const urls = entries
    .map(({ path, lastmod }) => {
      return [
        "  <url>",
        `    <loc>${getCanonicalUrl(path)}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
};

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const albumEntries = await getAlbumSitemapEntries();
  const latestLastmod = [...albumEntries]
    .map((entry) => entry.lastmod)
    .sort()
    .at(-1);
  const entries = [
    { path: "/", lastmod: latestLastmod },
    { path: "/map", lastmod: latestLastmod },
    { path: "/timeline", lastmod: latestLastmod },
    ...albumEntries.map((entry) => ({
      path: `/album/${entry.slug}`,
      lastmod: entry.lastmod,
    })),
  ];

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.write(buildSitemapXml(entries));
  res.end();

  return {
    props: {},
  };
};

const SitemapXml = () => null;

export { buildSitemapXml };
export default SitemapXml;
