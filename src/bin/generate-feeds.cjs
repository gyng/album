/**
 * Pre-build script: generates feed.xml, sitemap.xml, and per-album feed.xml
 * as static files in public/. These were previously SSR pages that read from
 * ../albums at request time, which fails on Vercel where albums aren't deployed.
 */
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const albumsDir = path.resolve(appRoot, "..", "albums");
const publicDir = path.join(appRoot, "public");

const MANIFEST_NAME = "manifest.json";
const MANIFEST_V2_NAME = "album.json";

const getSiteOrigin = () => {
  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!envOrigin) return "https://photos.awoo.party";
  if (envOrigin.startsWith("http://") || envOrigin.startsWith("https://"))
    return envOrigin.replace(/\/$/, "");
  return `https://${envOrigin.replace(/\/$/, "")}`;
};

const getCanonicalUrl = (pathname = "/") => {
  const normalised = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getSiteOrigin()}${encodeURI(normalised)}`;
};

const isTestAlbum = (slug) => slug.startsWith("test-");

const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toRssDate = (date) => new Date(date).toUTCString();

const formatSitemapDate = (timestampMs) =>
  new Date(timestampMs).toISOString().slice(0, 10);

const joinFeedDescriptionParts = (...parts) =>
  parts
    .map((p) => p?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" - ");

const humanizeAlbumFeedName = (value) =>
  value
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || value;

// --- Album reading ---

const getAlbumDirectoryEntries = () => {
  if (!fs.existsSync(albumsDir)) return [];

  return fs
    .readdirSync(albumsDir)
    .filter((it) => fs.lstatSync(path.join(albumsDir, it)).isDirectory())
    .map((slug) => {
      const albumPath = path.join(albumsDir, slug);
      const manifestPaths = [
        path.join(albumPath, MANIFEST_NAME),
        path.join(albumPath, MANIFEST_V2_NAME),
      ];
      const lastModifiedMs = Math.max(
        fs.statSync(albumPath).mtimeMs,
        ...manifestPaths
          .filter((p) => fs.existsSync(p))
          .map((p) => fs.statSync(p).mtimeMs),
      );
      return { slug, albumPath, lastmod: formatSitemapDate(lastModifiedMs) };
    });
};

const readAlbumFeedMetadata = (albumPath, slug) => {
  const manifestPath = path.join(albumPath, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath))
    return { title: slug, description: `${slug} photo album` };

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const firstTextBlock = manifest.blocks?.find((b) => b.kind === "text");
    const title =
      manifest.title?.trim() || firstTextBlock?.data?.title?.trim() || slug;
    const description =
      joinFeedDescriptionParts(
        manifest.kicker,
        firstTextBlock?.data?.kicker,
        firstTextBlock?.data?.description,
      ) || `${title} photo album`;
    return { title, description };
  } catch {
    return { title: slug, description: `${slug} photo album` };
  }
};

// --- XML builders ---

const buildRssXml = (channel) => {
  const items = channel.items
    .map(
      (item) =>
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
    "    <language>en</language>",
    `    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />`,
    ...(channel.lastBuildDate
      ? [
          `    <lastBuildDate>${escapeXml(channel.lastBuildDate)}</lastBuildDate>`,
        ]
      : []),
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
};

const buildSitemapXml = (entries) => {
  const urls = entries
    .map(({ url, lastmod }) =>
      [
        "  <url>",
        `    <loc>${url}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        "  </url>",
      ].join("\n"),
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
};

// --- Feed generation ---

const generateMainFeed = (entries) => {
  const siteUrl = getCanonicalUrl("/");
  const feedUrl = getCanonicalUrl("/feed.xml");

  return buildRssXml({
    title: "Snapshots",
    link: siteUrl,
    description: "Snapshots from a better era",
    selfUrl: feedUrl,
    lastBuildDate: entries[0]?.lastmod
      ? toRssDate(entries[0].lastmod)
      : undefined,
    items: entries.map((entry) => ({
      title: entry.title,
      link: getCanonicalUrl(`/album/${entry.slug}`),
      guid: getCanonicalUrl(`/album/${entry.slug}`),
      description: entry.description,
      pubDate: toRssDate(entry.lastmod),
    })),
  });
};

const generateAlbumFeed = (entry, items) => {
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

const getAlbumFeedItems = (slug, albumPath, albumMetadata, albumLastmod) => {
  const items = [];
  const manifestPath = path.join(albumPath, MANIFEST_NAME);
  const albumJsonPath = path.join(albumPath, MANIFEST_V2_NAME);

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const block of manifest.blocks ?? []) {
        if (block.kind !== "photo" && block.kind !== "video") continue;
        const source = block.data?.src ?? block.data?.href;
        if (!source) continue;

        const localPath = block.data?.src
          ? path.join(albumPath, block.data.src)
          : block.data?.type === "local" && block.data.href
            ? path.join(albumPath, block.data.href)
            : null;
        const statDate =
          localPath && fs.existsSync(localPath)
            ? formatSitemapDate(fs.statSync(localPath).mtimeMs)
            : null;
        const sortDate =
          block.data?.date?.slice(0, 10) ?? statDate ?? albumLastmod;
        const label =
          block.data?.title?.trim() ||
          block.data?.kicker?.trim() ||
          humanizeAlbumFeedName(source);

        items.push({
          title: label,
          description: joinFeedDescriptionParts(
            block.data?.kicker,
            block.data?.description,
            `From ${albumMetadata.title}`,
          ),
          link:
            block.kind === "photo"
              ? `/album/${slug}#${source.split("/").at(-1)}`
              : block.data?.type === "youtube"
                ? `/album/${slug}`
                : `/album/${slug}#${source.split("/").at(-1)}`,
          pubDate: sortDate,
          sortDate,
        });
      }
    } catch {
      // Fall back to filesystem-based feed
    }
  }

  if (items.length === 0) {
    const isZoneId = (f) => f.toLowerCase().includes(":zone.identifier");
    const mediaFiles = fs
      .readdirSync(albumPath)
      .filter((it) => !fs.lstatSync(path.join(albumPath, it)).isDirectory())
      .filter((it) => !it.match(/\.json$/))
      .filter((it) => !isZoneId(it));

    for (const file of mediaFiles) {
      const filePath = path.join(albumPath, file);
      const sortDate = formatSitemapDate(fs.statSync(filePath).mtimeMs);
      items.push({
        title: humanizeAlbumFeedName(file),
        description: joinFeedDescriptionParts(
          `From ${albumMetadata.title}`,
          albumMetadata.description,
        ),
        link: `/album/${slug}#${file}`,
        pubDate: sortDate,
        sortDate,
      });
    }
  }

  if (fs.existsSync(albumJsonPath)) {
    try {
      const albumJson = JSON.parse(fs.readFileSync(albumJsonPath, "utf-8"));
      for (const external of albumJson.externals ?? []) {
        const sortDate =
          external.date?.slice(0, 10) ??
          formatSitemapDate(fs.statSync(albumJsonPath).mtimeMs);
        items.push({
          title: humanizeAlbumFeedName(external.href),
          description: joinFeedDescriptionParts(
            `External item from ${albumMetadata.title}`,
            albumMetadata.description,
          ),
          link: `/album/${slug}`,
          pubDate: sortDate,
          sortDate,
        });
      }
    } catch {
      // Ignore malformed album.json
    }
  }

  return items
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    .slice(0, 20)
    .map(({ title, description, link, pubDate }) => ({
      title,
      description,
      link,
      pubDate,
    }));
};

const generateSitemap = (albumEntries) => {
  const latestLastmod = [...albumEntries]
    .map((e) => e.lastmod)
    .sort()
    .at(-1);

  const entries = [
    { url: getCanonicalUrl("/"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/map"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/timeline"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/explore"), lastmod: latestLastmod },
    ...albumEntries.map((e) => ({
      url: getCanonicalUrl(`/album/${e.slug}`),
      lastmod: e.lastmod,
    })),
  ];

  return buildSitemapXml(entries);
};

// --- Main ---

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const writeFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
};

const run = () => {
  const albumEntries = getAlbumDirectoryEntries();

  if (albumEntries.length === 0) {
    console.log("No albums found — skipping feed generation");
    return;
  }

  const realAlbumEntries = albumEntries.filter((e) => !isTestAlbum(e.slug));

  const feedEntries = realAlbumEntries
    .map(({ slug, albumPath, lastmod }) => {
      const metadata = readAlbumFeedMetadata(albumPath, slug);
      return { slug, albumPath, title: metadata.title, description: metadata.description, lastmod };
    })
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));

  // Main feed
  writeFile(
    path.join(publicDir, "feed.xml"),
    generateMainFeed(feedEntries.slice(0, 20)),
  );

  // Sitemap
  writeFile(path.join(publicDir, "sitemap.xml"), generateSitemap(realAlbumEntries));

  // Per-album feeds
  for (const entry of feedEntries) {
    const items = getAlbumFeedItems(
      entry.slug,
      entry.albumPath,
      { title: entry.title, description: entry.description },
      entry.lastmod,
    );
    writeFile(
      path.join(publicDir, "album", entry.slug, "feed.xml"),
      generateAlbumFeed(entry, items),
    );
  }

  console.log(
    `Generated feeds: feed.xml, sitemap.xml, ${feedEntries.length} album feeds`,
  );
};

run();
