export type RssItem = {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
};

export type RssChannel = {
  title: string;
  link: string;
  description: string;
  selfUrl: string;
  lastBuildDate?: string;
  items: RssItem[];
};

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const toRssDate = (date: string): string => new Date(date).toUTCString();

export const buildRssXml = (channel: RssChannel): string => {
  const items = channel.items
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid>${escapeXml(item.guid)}</guid>`,
        `      <description>${escapeXml(item.description)}</description>`,
        `      <pubDate>${escapeXml(item.pubDate)}</pubDate>`,
        "    </item>",
      ].join("\n"),
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />`,
    ...(channel.lastBuildDate
      ? [`    <lastBuildDate>${escapeXml(channel.lastBuildDate)}</lastBuildDate>`]
      : []),
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
};
