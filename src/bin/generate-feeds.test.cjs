/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildRobotsTxt,
  buildSitemapXml,
  cleanupStaleAlbumFeeds,
  generateSitemap,
  getAlbumFeedItems,
  getCanonicalUrl,
  getSiteOrigin,
  humanizeAlbumFeedName,
  readAlbumFeedMetadata,
  run,
} = require("./generate-feeds.cjs");

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
};

describe("static feed generation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("normalises environment origins and canonical paths", () => {
    expect(getSiteOrigin()).toBe("https://photos.awoo.party");

    process.env.SITE_URL = "http://gallery.internal/";
    expect(getSiteOrigin()).toBe("http://gallery.internal");

    delete process.env.SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "gallery.example.com/";
    expect(getSiteOrigin()).toBe("https://gallery.example.com");
    expect(getCanonicalUrl()).toBe("https://gallery.example.com/");
    expect(getCanonicalUrl("album/türkiye")).toBe("https://gallery.example.com/album/t%C3%BCrkiye");
  });

  it("builds robots.txt from the configured canonical origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://photos.example.com/";

    expect(buildRobotsTxt()).toBe(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /search",
        "Disallow: /slideshow",
        "",
        "Sitemap: https://photos.example.com/sitemap.xml",
        "",
      ].join("\n"),
    );
  });

  it("builds sitemap entries with optional modification dates", () => {
    const xml = buildSitemapXml([
      { url: "https://example.com/dated", lastmod: "2025-01-01" },
      { url: "https://example.com/undated" },
    ]);

    expect(xml).toContain("<lastmod>2025-01-01</lastmod>");
    expect(xml).toContain("https://example.com/undated");
    expect(generateSitemap([])).toContain("https://photos.awoo.party/explore");
  });

  it("humanises filenames and preserves separator-only fallbacks", () => {
    expect(humanizeAlbumFeedName("clips/night_walk.mp4")).toBe("night walk");
    expect(humanizeAlbumFeedName("---.jpg")).toBe("---.jpg");
  });

  it("falls back through text-block and slug metadata and empty manifests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-feeds-metadata-"));
    const textAlbum = path.join(root, "text-title");
    const emptyAlbum = path.join(root, "empty");
    writeJson(path.join(textAlbum, "manifest.json"), {
      blocks: [{ kind: "text", data: { title: "  Text title  " } }],
    });
    writeJson(path.join(emptyAlbum, "manifest.json"), {});
    writeJson(path.join(emptyAlbum, "album.json"), {});

    expect(readAlbumFeedMetadata(textAlbum, "text-title")).toEqual({
      title: "Text title",
      description: "Text title photo album",
    });
    expect(readAlbumFeedMetadata(emptyAlbum, "empty")).toEqual({
      title: "empty",
      description: "empty photo album",
    });
    expect(
      getAlbumFeedItems("empty", emptyAlbum, { title: "empty", description: "" }, "2025-01-01"),
    ).toEqual([]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips cleanly when the albums directory is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-feeds-empty-"));
    const log = jest.fn();

    expect(
      run({
        albumsDirectory: path.join(root, "missing"),
        outputDirectory: path.join(root, "public"),
        log,
      }),
    ).toEqual({ generatedAlbumFeeds: 0, removedFeeds: 0 });
    expect(log).toHaveBeenCalledWith("No albums found — skipping feed generation");
    expect(fs.existsSync(path.join(root, "public", "robots.txt"))).toBe(true);
  });

  it("writes main, sitemap, and per-album feeds while cleaning stale outputs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-feeds-run-"));
    const albumsDirectory = path.join(root, "albums");
    const outputDirectory = path.join(root, "public");
    process.env.NEXT_PUBLIC_SITE_URL = "https://photos.example.com/";

    writeJson(path.join(albumsDirectory, "trip", "manifest.json"), {
      title: "Trip & trains",
      kicker: "  Spring   journey ",
      blocks: [
        { kind: "text", data: { title: "Ignored title", description: "Across the country" } },
        { kind: "photo", data: {} },
        {
          kind: "photo",
          data: {
            src: "night market.jpg",
            title: "Night market",
            kicker: "After dark",
            date: "2025-03-02T10:00:00",
          },
        },
        { kind: "video", data: { type: "local", href: "local_clip.mp4", description: "Clip" } },
        {
          kind: "video",
          data: { type: "youtube", href: "https://youtu.be/example", title: "YouTube clip" },
        },
        { kind: "photo", data: { src: "missing_photo.jpg" } },
      ],
    });
    fs.writeFileSync(path.join(albumsDirectory, "trip", "night market.jpg"), "photo");
    fs.writeFileSync(path.join(albumsDirectory, "trip", "local_clip.mp4"), "video");
    writeJson(path.join(albumsDirectory, "trip", "album.json"), {
      externals: [
        { type: "youtube", href: "https://youtu.be/external", date: "2025-04-01" },
        { type: "local", href: "clips/undated.mp4" },
      ],
    });

    fs.mkdirSync(path.join(albumsDirectory, "filesystem", "nested"), { recursive: true });
    fs.writeFileSync(path.join(albumsDirectory, "filesystem", "IMG_1234.JPG"), "photo");
    fs.writeFileSync(path.join(albumsDirectory, "filesystem", "ignored.json"), "{}");
    fs.writeFileSync(
      path.join(albumsDirectory, "filesystem", "IMG_1234.JPG:Zone.Identifier"),
      "zone",
    );

    fs.mkdirSync(path.join(albumsDirectory, "broken"), { recursive: true });
    fs.writeFileSync(path.join(albumsDirectory, "broken", "manifest.json"), "{");
    fs.writeFileSync(path.join(albumsDirectory, "broken", "album.json"), "{");
    fs.writeFileSync(path.join(albumsDirectory, "broken", "fallback.jpg"), "photo");

    fs.mkdirSync(path.join(albumsDirectory, "test-fixture"), { recursive: true });
    fs.writeFileSync(path.join(albumsDirectory, "README.txt"), "not an album");

    fs.mkdirSync(path.join(outputDirectory, "album", "stale-empty"), { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, "album", "stale-empty", "feed.xml"), "old");
    fs.mkdirSync(path.join(outputDirectory, "album", "stale-with-asset"), { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, "album", "stale-with-asset", "feed.xml"), "old");
    fs.writeFileSync(path.join(outputDirectory, "album", "stale-with-asset", "cover.jpg"), "keep");
    fs.writeFileSync(path.join(outputDirectory, "album", "README.txt"), "keep");

    const log = jest.fn();
    const summary = run({ albumsDirectory, outputDirectory, log });

    expect(summary).toEqual({ generatedAlbumFeeds: 3, removedFeeds: 2 });
    expect(fs.existsSync(path.join(outputDirectory, "feed.xml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDirectory, "sitemap.xml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDirectory, "robots.txt"))).toBe(true);
    expect(fs.existsSync(path.join(outputDirectory, "album", "trip", "feed.xml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDirectory, "album", "test-fixture", "feed.xml"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(outputDirectory, "album", "stale-empty"))).toBe(false);
    expect(
      fs.existsSync(path.join(outputDirectory, "album", "stale-with-asset", "cover.jpg")),
    ).toBe(true);

    const feed = fs.readFileSync(path.join(outputDirectory, "album", "trip", "feed.xml"), "utf8");
    expect(feed).toContain("Trip &amp; trains | Snapshots");
    expect(feed).toContain('guid isPermaLink="false"');
    expect(feed).toContain("https://youtu.be/example");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("removed 2 stale album feed(s)"));

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses the console logger by default and handles an absent stale-feed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-feeds-console-"));
    const albumsDirectory = path.join(root, "albums");
    fs.mkdirSync(albumsDirectory);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    expect(run({ albumsDirectory, outputDirectory: path.join(root, "public") })).toEqual({
      generatedAlbumFeeds: 0,
      removedFeeds: 0,
    });
    expect(cleanupStaleAlbumFeeds(new Set(), path.join(root, "public"))).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it("generates without a stale-feed suffix and ignores stale directories without feeds", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-feeds-no-stale-"));
    const albumsDirectory = path.join(root, "albums");
    const outputDirectory = path.join(root, "public");
    fs.mkdirSync(path.join(albumsDirectory, "one"), { recursive: true });
    fs.writeFileSync(path.join(albumsDirectory, "one", "photo.jpg"), "photo");
    fs.mkdirSync(path.join(outputDirectory, "album", "no-feed"), { recursive: true });
    const log = jest.fn();

    expect(cleanupStaleAlbumFeeds(new Set(["one"]), outputDirectory)).toBe(0);
    expect(fs.existsSync(path.join(outputDirectory, "album", "no-feed"))).toBe(false);

    expect(run({ albumsDirectory, outputDirectory, log })).toEqual({
      generatedAlbumFeeds: 1,
      removedFeeds: 0,
    });
    expect(log).toHaveBeenCalledWith(
      "Generated static metadata: robots.txt, feed.xml, sitemap.xml, 1 album feeds",
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
});
