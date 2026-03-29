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
});
