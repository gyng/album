/**
 * @jest-environment node
 */

import fs from "fs";
import path from "path";
import os from "os";

jest.mock("./album", () => ({
  ALBUMS_DIR: "../albums",
  MANIFEST_NAME: "manifest.json",
  MANIFEST_V2_NAME: "album.json",
}));

import {
  getAlbumFeedEntries,
  getAlbumFeedEntry,
  getAlbumFeedItems,
  getAlbumSitemapEntries,
} from "./albumFeed";

const createTempAlbumsDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "album-feed-test-"));

const writeJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

describe("albumFeed", () => {
  let albumsDir: string;

  beforeEach(() => {
    albumsDir = createTempAlbumsDir();
  });

  afterEach(() => {
    fs.rmSync(albumsDir, { recursive: true, force: true });
  });

  it("builds sitemap entries from album directory metadata", async () => {
    fs.mkdirSync(path.join(albumsDir, "tokyo"), { recursive: true });
    writeJson(path.join(albumsDir, "tokyo", "manifest.json"), {
      title: "Tokyo",
    });

    const entries = await getAlbumSitemapEntries(albumsDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.slug).toBe("tokyo");
    expect(entries[0]?.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prefers manifest metadata for top-level feed entries", async () => {
    writeJson(path.join(albumsDir, "tokyo", "manifest.json"), {
      title: "Tokyo Trip",
      kicker: "Spring photos from Tokyo",
      blocks: [
        {
          kind: "text",
          data: {
            title: "Tokyo Trip",
            kicker: "Late-night walks",
            description: "Train rides and city lights",
          },
        },
      ],
    });

    const entries = await getAlbumFeedEntries(albumsDir);

    expect(entries[0]).toMatchObject({
      slug: "tokyo",
      title: "Tokyo Trip",
      description: "Spring photos from Tokyo - Late-night walks - Train rides and city lights",
    });
  });

  it("returns a single album feed entry when the album exists", async () => {
    writeJson(path.join(albumsDir, "trip", "manifest.json"), {
      title: "Trip",
      kicker: "Road trip photos",
    });

    const entry = await getAlbumFeedEntry("trip", albumsDir);

    expect(entry).toMatchObject({
      slug: "trip",
      title: "Trip",
      description: "Road trip photos",
    });
  });

  it("builds useful per-item descriptions from manifest blocks", async () => {
    writeJson(path.join(albumsDir, "tokyo", "manifest.json"), {
      title: "Tokyo Trip",
      blocks: [
        {
          kind: "photo",
          data: {
            src: "shibuya.jpg",
            title: "Shibuya crossing",
            kicker: "After dark",
            description: "Crowds and lights",
          },
        },
      ],
    });
    fs.writeFileSync(path.join(albumsDir, "tokyo", "shibuya.jpg"), "x");

    const items = await getAlbumFeedItems("tokyo", albumsDir);

    expect(items[0]).toMatchObject({
      title: "Shibuya crossing",
      description: "After dark - Crowds and lights - From Tokyo Trip",
      link: "/album/tokyo#shibuya.jpg",
    });
  });

  it("falls back to filesystem media items when no manifest is present", async () => {
    fs.mkdirSync(path.join(albumsDir, "kansai"), { recursive: true });
    fs.writeFileSync(path.join(albumsDir, "kansai", "IMG_1234.JPG"), "x");

    const items = await getAlbumFeedItems("kansai", albumsDir);

    expect(items[0]).toMatchObject({
      title: "IMG 1234",
      description: "From kansai - kansai photo album",
      link: "/album/kansai#IMG_1234.JPG",
    });
  });

  it("includes external items from album.json", async () => {
    writeJson(path.join(albumsDir, "snapshots", "manifest.json"), {
      title: "Snapshots",
    });
    writeJson(path.join(albumsDir, "snapshots", "album.json"), {
      externals: [
        {
          type: "youtube",
          href: "https://www.youtube.com/embed/example-video",
          date: "2025-04-12T18:21:00.000+08:00",
        },
      ],
    });

    const items = await getAlbumFeedItems("snapshots", albumsDir);

    expect(items[0]).toMatchObject({
      title: "example video",
      description: "External item from Snapshots - Snapshots photo album",
      link: "/album/snapshots",
    });
  });

  it("returns empty results for missing albums and ignores non-directory entries", async () => {
    fs.writeFileSync(path.join(albumsDir, "README.txt"), "not an album");

    await expect(getAlbumFeedEntry("missing", albumsDir)).resolves.toBeNull();
    await expect(getAlbumFeedItems("missing", albumsDir)).resolves.toEqual([]);
    await expect(getAlbumSitemapEntries(albumsDir)).resolves.toEqual([]);
  });

  it("falls back from malformed manifests and sorts and limits top-level entries", async () => {
    fs.mkdirSync(path.join(albumsDir, "broken"), { recursive: true });
    fs.writeFileSync(path.join(albumsDir, "broken", "manifest.json"), "{");
    writeJson(path.join(albumsDir, "named", "manifest.json"), {
      blocks: [{ kind: "text", data: { title: "  Text title  ", description: "Details" } }],
    });
    fs.utimesSync(
      path.join(albumsDir, "named", "manifest.json"),
      new Date("2025-01-01"),
      new Date("2025-01-01"),
    );
    fs.utimesSync(
      path.join(albumsDir, "broken", "manifest.json"),
      new Date("2026-01-01"),
      new Date("2026-01-01"),
    );

    const entries = await getAlbumFeedEntries(albumsDir, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      slug: "broken",
      title: "broken",
      description: "broken photo album",
    });
    await expect(getAlbumFeedEntry("named", albumsDir)).resolves.toMatchObject({
      title: "Text title",
      description: "Details",
    });
  });

  it("builds photo, local-video, and YouTube items with the available date and label fallbacks", async () => {
    writeJson(path.join(albumsDir, "mixed", "manifest.json"), {
      title: "Mixed media",
      blocks: [
        { kind: "text", data: { title: "Ignored" } },
        { kind: "photo", data: {} },
        {
          kind: "photo",
          data: { src: "street_scene.jpg", kicker: "Street scene", date: "2025-03-02T10:00:00" },
        },
        {
          kind: "video",
          data: { type: "local", href: "local_clip.mp4", description: "A local clip" },
        },
        {
          kind: "video",
          data: { type: "youtube", href: "https://youtu.be/example", title: "YouTube clip" },
        },
      ],
    });
    fs.writeFileSync(path.join(albumsDir, "mixed", "street_scene.jpg"), "photo");
    fs.writeFileSync(path.join(albumsDir, "mixed", "local_clip.mp4"), "video");

    const items = await getAlbumFeedItems("mixed", albumsDir);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Street scene",
          link: "/album/mixed#street_scene.jpg",
          pubDate: "2025-03-02",
        }),
        expect.objectContaining({
          title: "local clip",
          description: "A local clip - From Mixed media",
          link: "/album/mixed#local_clip.mp4",
        }),
        expect.objectContaining({
          title: "YouTube clip",
          link: "/album/mixed",
        }),
      ]),
    );
  });

  it("uses a clean filesystem fallback and tolerates malformed v2 metadata", async () => {
    fs.mkdirSync(path.join(albumsDir, "filesystem", "nested"), { recursive: true });
    fs.writeFileSync(path.join(albumsDir, "filesystem", "manifest.json"), "{");
    fs.writeFileSync(path.join(albumsDir, "filesystem", "album.json"), "{");
    fs.writeFileSync(path.join(albumsDir, "filesystem", "---.jpg"), "photo");
    fs.writeFileSync(path.join(albumsDir, "filesystem", "ignored.json"), "{}");
    fs.writeFileSync(path.join(albumsDir, "filesystem", "photo.jpg:Zone.Identifier"), "zone");

    const items = await getAlbumFeedItems("filesystem", albumsDir);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "---.jpg", link: "/album/filesystem#---.jpg" });
  });

  it("uses album metadata timestamps for undated external items", async () => {
    writeJson(path.join(albumsDir, "external", "album.json"), {
      externals: [{ type: "local", href: "clips/night_walk.mp4" }],
    });

    const items = await getAlbumFeedItems("external", albumsDir);

    expect(items[0]).toMatchObject({
      title: "night walk",
      description: "External item from external - external photo album",
      link: "/album/external",
    });
    expect(items[0]?.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the slug when a parsed manifest contains no title", async () => {
    writeJson(path.join(albumsDir, "untitled", "manifest.json"), {});

    await expect(getAlbumFeedEntry("untitled", albumsDir)).resolves.toMatchObject({
      title: "untitled",
      description: "untitled photo album",
    });
  });

  it("falls back to the album directory timestamp if a concurrent listing omits it", async () => {
    writeJson(path.join(albumsDir, "race", "manifest.json"), {
      blocks: [{ kind: "photo", data: { src: "photo.jpg" } }],
    });
    const readdir = jest.spyOn(fs, "readdirSync").mockReturnValue([]);

    try {
      await expect(getAlbumFeedEntry("race", albumsDir)).resolves.toMatchObject({ slug: "race" });
      await expect(getAlbumFeedItems("race", albumsDir)).resolves.toEqual([
        expect.objectContaining({ link: "/album/race#photo.jpg" }),
      ]);
    } finally {
      readdir.mockRestore();
    }
  });

  it("supports the configured default albums directory", async () => {
    await expect(getAlbumSitemapEntries()).resolves.toEqual(expect.any(Array));
    await expect(getAlbumFeedEntries()).resolves.toEqual(expect.any(Array));
    await expect(getAlbumFeedEntry("definitely-missing-default-album")).resolves.toBeNull();
    await expect(getAlbumFeedItems("definitely-missing-default-album")).resolves.toEqual([]);
  });
});
