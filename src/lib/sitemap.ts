import { getCanonicalUrl } from "./seo";
import { escapeXml } from "./rss";

type SitemapEntry = {
  path: string;
  lastmod?: string;
};

export const buildSitemapXml = (entries: SitemapEntry[], siteOrigin?: string): string => {
  const urls = entries
    .map(({ path, lastmod }) => {
      // getCanonicalUrl already percent-encodes the path; escapeXml then
      // handles XML metacharacters (&, <, >) so an album named "food & drink"
      // cannot invalidate the whole sitemap.
      return [
        "  <url>",
        `    <loc>${escapeXml(getCanonicalUrl(path, siteOrigin))}</loc>`,
        ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
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
