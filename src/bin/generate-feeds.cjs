/**
 * Pre-build script: generates robots.txt, feed.xml, sitemap.xml, and per-album
 * feed.xml as static files in public/. These resources have no request-time
 * dependencies and can be served by any static host.
 */
const fs = require("fs");
const path = require("path");

const { resolveAlbumsDir, resolveSiteOrigin, siteConfig } = require("./siteConfig.cjs");

const appRoot = path.resolve(__dirname, "..");
const albumsDir = resolveAlbumsDir(appRoot);
const publicDir = path.join(appRoot, "public");

const MANIFEST_NAME = "manifest.json";
const MANIFEST_V2_NAME = "album.json";

const getSiteOrigin = () => resolveSiteOrigin();

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

const formatSitemapDate = (timestampMs) => new Date(timestampMs).toISOString().slice(0, 10);

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

const getAlbumDirectoryEntries = (albumsPath) => {
  if (!fs.existsSync(albumsPath)) return [];

  return fs
    .readdirSync(albumsPath)
    .filter((it) => fs.lstatSync(path.join(albumsPath, it)).isDirectory())
    .map((slug) => {
      const albumPath = path.join(albumsPath, slug);
      const manifestPaths = [
        path.join(albumPath, MANIFEST_NAME),
        path.join(albumPath, MANIFEST_V2_NAME),
      ];
      const lastModifiedMs = Math.max(
        fs.statSync(albumPath).mtimeMs,
        ...manifestPaths.filter((p) => fs.existsSync(p)).map((p) => fs.statSync(p).mtimeMs),
      );
      return { slug, albumPath, lastmod: formatSitemapDate(lastModifiedMs) };
    });
};

const readAlbumFeedMetadata = (albumPath, slug) => {
  const manifestPath = path.join(albumPath, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return { title: slug, description: `${slug} photo album` };

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const firstTextBlock = manifest.blocks?.find((b) => b.kind === "text");
    const title = manifest.title?.trim() || firstTextBlock?.data?.title?.trim() || slug;
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
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid${item.guidIsPermaLink === false ? ' isPermaLink="false"' : ""}>${escapeXml(item.guid)}</guid>`,
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
      ? [`    <lastBuildDate>${escapeXml(channel.lastBuildDate)}</lastBuildDate>`]
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
        `    <loc>${escapeXml(url)}</loc>`,
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
    title: siteConfig.site.name,
    link: siteUrl,
    description: siteConfig.site.description,
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

const generateAlbumFeed = (entry, items) => {
  const albumUrl = getCanonicalUrl(`/album/${entry.slug}`);
  const feedUrl = getCanonicalUrl(`/album/${entry.slug}/feed.xml`);

  return buildRssXml({
    title: `${entry.title} | ${siteConfig.site.name}`,
    link: albumUrl,
    description: entry.description,
    selfUrl: feedUrl,
    lastBuildDate: toRssDate(entry.lastmod),
    items: items.map((item) => ({
      title: item.title,
      link: getCanonicalUrl(item.link),
      // Photo/file items carry a unique #fragment in their link, so the
      // canonical URL is a fine permalink guid. YouTube/external items all share
      // the bare /album/<slug> link, so they supply an explicit non-permalink
      // guid to stop readers deduping them down to a single entry.
      ...(item.guid
        ? { guid: item.guid, guidIsPermaLink: false }
        : { guid: getCanonicalUrl(item.link) }),
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
        const sortDate = block.data?.date?.slice(0, 10) ?? statDate ?? albumLastmod;
        const label =
          block.data?.title?.trim() || block.data?.kicker?.trim() || humanizeAlbumFeedName(source);

        const isYoutube = block.kind === "video" && block.data?.type === "youtube";

        items.push({
          title: label,
          description: joinFeedDescriptionParts(
            block.data?.kicker,
            block.data?.description,
            `From ${albumMetadata.title}`,
          ),
          link: isYoutube ? `/album/${slug}` : `/album/${slug}#${source.split("/").at(-1)}`,
          // YouTube items all share the bare /album/<slug> link, so give them a
          // unique guid from the video href to stop readers deduping them.
          ...(isYoutube ? { guid: source } : {}),
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
          external.date?.slice(0, 10) ?? formatSitemapDate(fs.statSync(albumJsonPath).mtimeMs);
        items.push({
          title: humanizeAlbumFeedName(external.href),
          description: joinFeedDescriptionParts(
            `External item from ${albumMetadata.title}`,
            albumMetadata.description,
          ),
          link: `/album/${slug}`,
          // External items also share the bare album link — key their guid off
          // the (unique) external href, falling back to a positional id.
          guid: external.href,
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
    .map(({ title, description, link, pubDate, guid }) => ({
      title,
      description,
      link,
      pubDate,
      ...(guid ? { guid } : {}),
    }));
};

const generateSitemap = (albumEntries) => {
  const latestLastmod = [...albumEntries]
    .map((e) => e.lastmod)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);

  const entries = [
    { url: getCanonicalUrl("/"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/map"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/timeline"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/trips"), lastmod: latestLastmod },
    { url: getCanonicalUrl("/explore"), lastmod: latestLastmod },
    ...albumEntries.map((e) => ({
      url: getCanonicalUrl(`/album/${e.slug}`),
      lastmod: e.lastmod,
    })),
  ];

  return buildSitemapXml(entries);
};

const buildRobotsTxt = () =>
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /search",
    "Disallow: /slideshow",
    "",
    `Sitemap: ${getCanonicalUrl("/sitemap.xml")}`,
    "",
  ].join("\n");

// --- Branded assets ---
//
// The manifest and the social preview both embed the site's name, and the
// preview embeds its hostname too. Generating them from configuration keeps a
// fork from shipping the previous owner's identity in its install prompt and
// in every link preview.

const PWA_ICONS = [
  { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
  { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  { src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
];

const buildWebmanifest = (config = siteConfig) => ({
  name: config.site.name,
  short_name: config.site.shortName,
  description: config.pwa.description,
  id: "/",
  start_url: config.pwa.startUrl,
  scope: "/",
  display: "standalone",
  display_override: ["fullscreen", "standalone"],
  launch_handler: {
    // Reuses an installed window but always returns it to the launch URL.
    // `focus-existing` would need launchQueue handling as well.
    client_mode: "navigate-existing",
  },
  theme_color: config.branding.themeColor,
  background_color: config.branding.backgroundColor,
  icons: PWA_ICONS,
});

const escapeXmlText = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Hostname only: a scheme in a share card reads as clutter. */
const displayHost = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

const buildSocialPreviewSvg = (config = siteConfig, origin = resolveSiteOrigin()) => {
  const font = "Helvetica Neue, Arial, sans-serif";
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#2c2c2c"/>
  <circle cx="942" cy="146" r="208" fill="#e62065" fill-opacity="0.16"/>
  <circle cx="214" cy="520" r="180" fill="#ffffff" fill-opacity="0.08"/>
  <rect x="80" y="84" width="1040" height="462" rx="36" fill="url(#panel)"/>
  <text x="128" y="240" fill="white" font-family="${font}" font-size="96" font-weight="700">${escapeXmlText(config.site.name)}</text>
  <text x="128" y="322" fill="#d2d2d2" font-family="${font}" font-size="38">${escapeXmlText(config.branding.socialPreviewSubtitle)}</text>
  <text x="128" y="440" fill="#f3f3f3" font-family="${font}" font-size="30">${escapeXmlText(displayHost(origin))}</text>
  <defs>
    <linearGradient id="panel" x1="80" y1="84" x2="1120" y2="546" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1f1f1f"/>
      <stop offset="1" stop-color="#3a3a3a"/>
    </linearGradient>
  </defs>
</svg>`;
};

// --- Main ---

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const writeFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
};

// Remove per-album feeds for slugs that are no longer albums (renamed/deleted),
// otherwise their public/album/<slug>/feed.xml ships frozen forever. Deliberately
// conservative: only ever deletes feed.xml, and only removes the containing
// directory if it is then empty — never a recursive delete.
const cleanupStaleAlbumFeeds = (validSlugs, outputDirectory) => {
  const albumOutputDir = path.join(outputDirectory, "album");
  if (!fs.existsSync(albumOutputDir)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(albumOutputDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || validSlugs.has(entry.name)) continue;

    const slugDir = path.join(albumOutputDir, entry.name);
    const feedPath = path.join(slugDir, "feed.xml");
    if (fs.existsSync(feedPath)) {
      fs.rmSync(feedPath);
      removed += 1;
    }

    try {
      if (fs.readdirSync(slugDir).length === 0) {
        fs.rmdirSync(slugDir);
      }
    } catch {
      // Non-empty or already gone — leave any other generated assets untouched.
    }
  }

  return removed;
};

const run = ({ albumsDirectory, outputDirectory, log = console.log }) => {
  const albumEntries = getAlbumDirectoryEntries(albumsDirectory);

  // These do not depend on album discovery, so generate them even when a
  // checkout has no local album source directories.
  writeFile(path.join(outputDirectory, "robots.txt"), buildRobotsTxt());
  writeFile(
    path.join(outputDirectory, "manifest.webmanifest"),
    `${JSON.stringify(buildWebmanifest(), null, 2)}\n`,
  );

  // Only when the fork still points at the generated file: a fork that supplies
  // its own artwork keeps it.
  if (siteConfig.branding.socialPreviewImage === "/social-preview.svg") {
    writeFile(path.join(outputDirectory, "social-preview.svg"), buildSocialPreviewSvg());
  }

  if (albumEntries.length === 0) {
    log("No albums found — skipping feed generation");
    return { generatedAlbumFeeds: 0, removedFeeds: 0 };
  }

  const realAlbumEntries = albumEntries.filter((e) => !isTestAlbum(e.slug));

  const feedEntries = realAlbumEntries
    .map(({ slug, albumPath, lastmod }) => {
      const metadata = readAlbumFeedMetadata(albumPath, slug);
      return { slug, albumPath, title: metadata.title, description: metadata.description, lastmod };
    })
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));

  // Main feed
  writeFile(path.join(outputDirectory, "feed.xml"), generateMainFeed(feedEntries.slice(0, 20)));

  // Sitemap
  writeFile(path.join(outputDirectory, "sitemap.xml"), generateSitemap(realAlbumEntries));

  // Per-album feeds
  for (const entry of feedEntries) {
    const items = getAlbumFeedItems(
      entry.slug,
      entry.albumPath,
      { title: entry.title, description: entry.description },
      entry.lastmod,
    );
    writeFile(
      path.join(outputDirectory, "album", entry.slug, "feed.xml"),
      generateAlbumFeed(entry, items),
    );
  }

  const removedFeeds = cleanupStaleAlbumFeeds(
    new Set(feedEntries.map((entry) => entry.slug)),
    outputDirectory,
  );

  log(
    `Generated static metadata: robots.txt, feed.xml, sitemap.xml, ${feedEntries.length} album feeds` +
      (removedFeeds > 0 ? `, removed ${removedFeeds} stale album feed(s)` : ""),
  );
  return { generatedAlbumFeeds: feedEntries.length, removedFeeds };
};

module.exports = {
  buildRobotsTxt,
  buildRssXml,
  buildSitemapXml,
  buildSocialPreviewSvg,
  buildWebmanifest,
  cleanupStaleAlbumFeeds,
  generateAlbumFeed,
  generateMainFeed,
  generateSitemap,
  getAlbumDirectoryEntries,
  getAlbumFeedItems,
  getCanonicalUrl,
  getSiteOrigin,
  humanizeAlbumFeedName,
  readAlbumFeedMetadata,
  run,
};

/* istanbul ignore next -- direct CLI dispatch; run is tested independently */
if (require.main === module) {
  run({ albumsDirectory: albumsDir, outputDirectory: publicDir });
}
