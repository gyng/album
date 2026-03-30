import { getCanonicalUrl } from "./seo";

type SitemapEntry = {
  path: string;
  lastmod?: string;
};

export const buildSitemapXml = (entries: SitemapEntry[]): string => {
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
