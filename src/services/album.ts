import fs from "fs";
import path from "path";
import { v4 } from "uuid";
import { deserializeContentBlock } from "./deserialize";
import {
  Block,
  Content,
  SerializedContent,
  SerializedPhotoBlock,
  SerializedTextBlock,
  V2AlbumMetadata,
} from "./types";
import { isVideoFile } from "./video";
import { incrementBuildCounter, measureBuild } from "./buildTiming";

export const ALBUMS_DIR = "../albums";
export const MANIFEST_NAME = "manifest.json";
export const MANIFEST_V2_NAME = "album.json";

const isZoneIdentifierFile = (filename: string): boolean => {
  return filename.toLowerCase().includes(":zone.identifier");
};

export const getBlockDate = (block: Block): number => {
  if (block.kind === "text") {
    return 1;
  }
  if (block.kind === "photo") {
    return Date.parse(block._build?.exif?.DateTimeOriginal ?? 0).valueOf() ?? 0;
  }
  if (block.kind === "video") {
    return block.data.date ? new Date(block.data.date).valueOf() : 0;
  }
  return 0;
};

const sortBlocksByDate = (
  blocks: Block[],
  sortOrder: "newest-first" | "oldest-first" = "oldest-first",
): Block[] => {
  return blocks.sort((a, b) =>
    sortOrder === "newest-first"
      ? getBlockDate(b) - getBlockDate(a)
      : getBlockDate(a) - getBlockDate(b),
  );
};

export const getImageTimestampRange = (
  album: Content,
): [number | null, number | null] => {
  let earliest = Number.MAX_VALUE;
  let latest = 0;
  for (const block of album.blocks) {
    if (block.kind !== "photo") continue;
    const dt = new Date(block._build?.exif?.DateTimeOriginal).getTime();
    if (dt < earliest) earliest = dt; // NaN comparisons are false → missing dates skipped
    if (dt > latest) latest = dt;
  }
  return [
    earliest !== Number.MAX_VALUE ? earliest : null,
    latest !== 0 ? latest : null,
  ];
};

export const getAlbumNames = async (
  albumsPath = ALBUMS_DIR,
): Promise<string[]> => {
  return measureBuild("album.getAlbumNames", async () => {
    return fs.readdirSync(albumsPath).filter((it) => {
      return fs.lstatSync(path.join(albumsPath, it)).isDirectory();
    });
  });
};

const formatSitemapDate = (timestampMs: number): string =>
  new Date(timestampMs).toISOString().slice(0, 10);

type AlbumDirectoryEntry = {
  slug: string;
  albumPath: string;
  lastmod: string;
};

const joinFeedDescriptionParts = (...parts: Array<string | null | undefined>): string => {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" - ");
};

const getAlbumDirectoryEntries = (albumsPath = ALBUMS_DIR): AlbumDirectoryEntry[] => {
  const albumNames = fs.readdirSync(albumsPath).filter((it) => {
    return fs.lstatSync(path.join(albumsPath, it)).isDirectory();
  });

  return albumNames.map((slug) => {
    const albumPath = path.join(albumsPath, slug);
    const manifestPaths = [
      path.join(albumPath, MANIFEST_NAME),
      path.join(albumPath, MANIFEST_V2_NAME),
    ];

    const lastModifiedMs = Math.max(
      fs.statSync(albumPath).mtimeMs,
      ...manifestPaths
        .filter((manifestPath) => fs.existsSync(manifestPath))
        .map((manifestPath) => fs.statSync(manifestPath).mtimeMs),
    );

    return {
      slug,
      albumPath,
      lastmod: formatSitemapDate(lastModifiedMs),
    };
  });
};

const getAlbumDirectoryEntry = (
  slug: string,
  albumsPath = ALBUMS_DIR,
): AlbumDirectoryEntry | null => {
  return (
    getAlbumDirectoryEntries(albumsPath).find((entry) => entry.slug === slug) ??
    null
  );
};

export const getAlbumSitemapEntries = async (
  albumsPath = ALBUMS_DIR,
): Promise<Array<{ slug: string; lastmod: string }>> => {
  return measureBuild("album.getAlbumSitemapEntries", async () => {
    return getAlbumDirectoryEntries(albumsPath).map(({ slug, lastmod }) => ({
      slug,
      lastmod,
    }));
  });
};

const readAlbumFeedMetadata = (
  albumPath: string,
  slug: string,
): { title: string; description: string } => {
  const manifestPath = path.join(albumPath, MANIFEST_NAME);

  if (!fs.existsSync(manifestPath)) {
    return {
      title: slug,
      description: `${slug} photo album`,
    };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      title?: string;
      kicker?: string;
      blocks?: Array<{
        kind?: string;
        data?: { title?: string; kicker?: string; description?: string };
      }>;
    };

    const firstTextBlock = manifest.blocks?.find((block) => block.kind === "text");
    const title =
      manifest.title?.trim() ||
      firstTextBlock?.data?.title?.trim() ||
      slug;
    const description =
      joinFeedDescriptionParts(
        manifest.kicker,
        firstTextBlock?.data?.kicker,
        firstTextBlock?.data?.description,
      ) || `${title} photo album`;

    return { title, description };
  } catch (_err) {
    return {
      title: slug,
      description: `${slug} photo album`,
    };
  }
};

const humanizeAlbumFeedName = (value: string): string => {
  return value
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || value;
};

export const getAlbumFeedEntries = async (
  albumsPath = ALBUMS_DIR,
  limit = 20,
): Promise<
  Array<{ slug: string; title: string; description: string; lastmod: string }>
> => {
  return measureBuild("album.getAlbumFeedEntries", async () => {
    return getAlbumDirectoryEntries(albumsPath)
      .map(({ slug, albumPath, lastmod }) => {
        const metadata = readAlbumFeedMetadata(albumPath, slug);
        return {
          slug,
          title: metadata.title,
          description: metadata.description,
          lastmod,
        };
      })
      .sort((left, right) => right.lastmod.localeCompare(left.lastmod))
      .slice(0, limit);
  });
};

export const getAlbumFeedEntry = async (
  slug: string,
  albumsPath = ALBUMS_DIR,
): Promise<
  { slug: string; title: string; description: string; lastmod: string } | null
> => {
  return measureBuild("album.getAlbumFeedEntry", async () => {
    const albumPath = path.join(albumsPath, slug);
    if (!fs.existsSync(albumPath) || !fs.lstatSync(albumPath).isDirectory()) {
      return null;
    }

    const { title, description } = readAlbumFeedMetadata(albumPath, slug);
    const lastmod =
      getAlbumDirectoryEntry(slug, albumsPath)?.lastmod ??
      formatSitemapDate(fs.statSync(albumPath).mtimeMs);

    return {
      slug,
      title,
      description,
      lastmod,
    };
  });
};

export const getAlbumFeedItems = async (
  slug: string,
  albumsPath = ALBUMS_DIR,
  limit = 20,
): Promise<
  Array<{
    title: string;
    description: string;
    link: string;
    pubDate: string;
  }>
> => {
  return measureBuild("album.getAlbumFeedItems", async () => {
    const albumPath = path.join(albumsPath, slug);
    if (!fs.existsSync(albumPath) || !fs.lstatSync(albumPath).isDirectory()) {
      return [];
    }
    const albumMetadata = readAlbumFeedMetadata(albumPath, slug);
    const albumLastmod =
      getAlbumDirectoryEntry(slug, albumsPath)?.lastmod ??
      formatSitemapDate(fs.statSync(albumPath).mtimeMs);

    const manifestPath = path.join(albumPath, MANIFEST_NAME);
    const albumJsonPath = path.join(albumPath, MANIFEST_V2_NAME);
    const items: Array<{
      title: string;
      description: string;
      link: string;
      pubDate: string;
      sortDate: string;
    }> = [];

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
          blocks?: Array<{
            kind?: string;
            data?: {
              src?: string;
              href?: string;
              title?: string;
              kicker?: string;
              description?: string;
              date?: string;
              type?: "youtube" | "local";
            };
          }>;
        };

        manifest.blocks?.forEach((block) => {
          if (block.kind !== "photo" && block.kind !== "video") {
            return;
          }

          const source = block.data?.src ?? block.data?.href;
          if (!source) {
            return;
          }

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
        });
      } catch (_err) {
        // Fall back to a filesystem-based feed when the manifest cannot be parsed.
      }
    }

    if (items.length === 0) {
      const mediaFiles = fs
        .readdirSync(albumPath)
        .filter((it) => !fs.lstatSync(path.join(albumPath, it)).isDirectory())
        .filter((it) => !it.match(/\.json$/))
        .filter((it) => !isZoneIdentifierFile(it));

      mediaFiles.forEach((file) => {
        const filePath = path.join(albumPath, file);
        const sortDate = formatSitemapDate(fs.statSync(filePath).mtimeMs);
        const title = humanizeAlbumFeedName(file);

        items.push({
          title,
          description: joinFeedDescriptionParts(
            `From ${albumMetadata.title}`,
            albumMetadata.description,
          ),
          link: `/album/${slug}#${file}`,
          pubDate: sortDate,
          sortDate,
        });
      });
    }

    if (fs.existsSync(albumJsonPath)) {
      try {
        const albumJson = JSON.parse(fs.readFileSync(albumJsonPath, "utf-8")) as {
          externals?: Array<{
            type: "youtube" | "local";
            href: string;
            date?: string;
          }>;
        };

        albumJson.externals?.forEach((external) => {
          const sortDate =
            external.date?.slice(0, 10) ??
            formatSitemapDate(fs.statSync(albumJsonPath).mtimeMs);
          const title = humanizeAlbumFeedName(external.href);
          items.push({
            title,
            description: joinFeedDescriptionParts(
              `External item from ${albumMetadata.title}`,
              albumMetadata.description,
            ),
            link: `/album/${slug}`,
            pubDate: sortDate,
            sortDate,
          });
        });
      } catch (_err) {
        // Ignore malformed album.json here and let the rest of the feed render.
      }
    }

    return items
      .sort((left, right) => right.sortDate.localeCompare(left.sortDate))
      .slice(0, limit)
      .map(({ title, description, link, pubDate }) => ({
        title,
        description,
        link,
        pubDate,
      }));
  });
};

export const getAlbums = (albumsPath = ALBUMS_DIR): Promise<Content[]> => {
  return measureBuild("album.getAlbums", async () => {
    const albumNames = fs.readdirSync(albumsPath).filter((it) => {
      return fs.lstatSync(path.join(albumsPath, it)).isDirectory();
    });

    incrementBuildCounter("album.getAlbums.calls");
    incrementBuildCounter("album.getAlbums.albumCount", albumNames.length);

    const albums = Promise.all(
      albumNames.map((an) => {
        return getAlbum(path.join(albumsPath, an));
      }),
    );
    return albums;
  });
};

export const getAlbumFromName = (albumName: string): Promise<Content> => {
  return measureBuild("album.getAlbumFromName", async () => {
    return getAlbum(path.join(ALBUMS_DIR, albumName));
  });
};

export const getAlbumWithoutManifest = async (
  albumPath: string,
): Promise<Content> => {
  return measureBuild("album.getAlbumWithoutManifest", async () => {
    const mediaFiles = fs
      .readdirSync(albumPath)
      .filter((it) => !fs.lstatSync(path.join(albumPath, it)).isDirectory())
      .filter((it) => !it.match(/\.json$/))
      .filter((it) => {
        if (!isZoneIdentifierFile(it)) {
          return true;
        }

        const sidecarPath = path.join(albumPath, it);
        try {
          fs.unlinkSync(sidecarPath);
          console.log(`Deleted Zone.Identifier sidecar file: ${sidecarPath}`);
        } catch (err) {
          console.warn(
            `Failed to delete Zone.Identifier sidecar: ${sidecarPath}`,
            err,
          );
        }
        return false;
      });

    const photos = mediaFiles.filter((it) => !isVideoFile(it));
    const videos = mediaFiles.filter((it) => isVideoFile(it));

    incrementBuildCounter("album.getAlbumWithoutManifest.photoCount", photos.length);
    incrementBuildCounter("album.getAlbumWithoutManifest.videoCount", videos.length);

    const dirname = path.parse(albumPath).name;

    const titleBlock: SerializedTextBlock = {
      kind: "text",
      id: v4(),
      data: {
        title: dirname,
      },
    };

    const photoBlocks: SerializedPhotoBlock[] = photos.map((p) => ({
      kind: "photo",
      id: p,
      data: {
        src: p,
      },
    }));

    const videoBlocks = videos.map((v) => ({
      kind: "video" as const,
      id: v,
      data: {
        type: "local" as const,
        href: v,
      },
    }));

    const coverBlock: SerializedPhotoBlock | null =
      photoBlocks.find((b) => b.data.src.includes("cover")) ?? null;

    const anonymousManifest: SerializedContent = {
      name: dirname,
      title: dirname,
      ...(coverBlock ? { cover: coverBlock } : {}),
      formatting: {
        sort: dirname.includes(".newest-first")
          ? "newest-first"
          : "oldest-first",
      },
      blocks: [titleBlock, ...photoBlocks, ...videoBlocks],
    };

    return deserializeContentBlock(anonymousManifest, albumPath);
  });
};

export const getAlbumWithManifest = async (
  /** Directory, eg, `public/data/albums/foobar` */
  rootRelativePath: string,
): Promise<Content> => {
  return measureBuild("album.getAlbumWithManifest", async () => {
    const txt = fs.readFileSync(
      path.join(rootRelativePath, MANIFEST_NAME),
      "utf-8",
    );
    const manifest = JSON.parse(txt);
    return deserializeContentBlock(manifest, rootRelativePath);
  });
};

const albumPromiseCache = new Map<string, Promise<Content>>();

// TODO: Add option to not optimise images until build time
export const getAlbum = async (
  /** Directory, eg, public/data/albums/simple */
  albumPath: string,
): Promise<Content> => {
  const cached = albumPromiseCache.get(albumPath);

  if (cached) {
    incrementBuildCounter("album.getAlbum.cacheHits");
    return cached;
  }

  incrementBuildCounter("album.getAlbum.cacheMisses");
  const pending = measureBuild("album.getAlbum", async () => {
    // v1 manifest: legacy support from LoL, internal serialisation format
    const isManifest = fs.existsSync(path.join(albumPath, MANIFEST_NAME));

    // V2 manifest exists: use it instead of v1 manifest
    const isV2Manifest = fs.existsSync(path.join(albumPath, MANIFEST_V2_NAME));

    if (isManifest && !isV2Manifest) {
      // Warning: deprecated!
      return getAlbumWithManifest(albumPath);
    }

    // This may be a v2 manifest
    // Get deserialised
    let manifest = await getAlbumWithoutManifest(albumPath);

    // Apply v2 manifest if it exists
    let v2Manifest: V2AlbumMetadata | null = null;
    if (isV2Manifest) {
      const v2Config = fs.readFileSync(
        path.join(albumPath, MANIFEST_V2_NAME),
        "utf-8",
      );
      v2Manifest = JSON.parse(v2Config) as V2AlbumMetadata;
    }

    // Sort by date
    manifest.blocks = sortBlocksByDate(manifest.blocks);

    // TODO: clean this up by splitting this up
    // and default behaviour (no v1 manifest or v2 manifest)
    if (isV2Manifest && v2Manifest) {
      // Add in externals first; this is needed as we are sorting later
      if (v2Manifest.externals) {
        v2Manifest.externals.forEach((ext) => {
          if (ext.type === "youtube") {
            manifest.blocks.push({
              kind: "video",
              id: v4(),
              data: {
                type: "youtube",
                href: ext.href,
                date: ext.date,
              },
            });
          } else if (ext.type === "local") {
            if (isZoneIdentifierFile(ext.href)) {
              const sidecarPath = path.join(albumPath, ext.href);
              try {
                if (fs.existsSync(sidecarPath)) {
                  fs.unlinkSync(sidecarPath);
                  console.log(
                    `Deleted Zone.Identifier sidecar file: ${sidecarPath}`,
                  );
                }
              } catch (err) {
                console.warn(
                  `Failed to delete Zone.Identifier sidecar: ${sidecarPath}`,
                  err,
                );
              }
              return;
            }

            manifest.blocks.push({
              kind: "video",
              id: v4(),
              data: {
                type: "local",
                href: ext.href,
                date: ext.date,
              },
            });
          }
        });
      }

      if (v2Manifest.cover) {
        manifest.cover = { src: v2Manifest.cover };
        const toSet = manifest.blocks.find(
          // @ts-expect-error ?. checks well enough
          (b) => b.data?.src?.includes(v2Manifest.cover),
        );
        if (toSet && toSet.kind === "photo") {
          toSet.formatting = { ...toSet?.formatting, cover: true };
        }
      }
    }

    manifest.blocks = sortBlocksByDate(
      manifest.blocks,
      v2Manifest?.sort ?? "oldest-first",
    );

    // Hack by moving text always to top
    const textBlocks = manifest.blocks.filter((b) => b.kind === "text");
    manifest.blocks = manifest.blocks.filter((b) => b.kind !== "text");
    manifest.blocks = [...textBlocks, ...manifest.blocks];

    // Set title defaults
    const title = manifest.blocks.at(0);
    if (title?.kind === "text") {
      const range = getImageTimestampRange(manifest).map((ts) =>
        new Date(ts!).getFullYear(),
      ) ?? [0, 0];
      const [from, to] =
        v2Manifest?.sort === "newest-first"
          ? [range[1], range[0]]
          : [range[0], range[1]];
      title.data.kicker = `${from}${to === from ? "" : `–${to}`}`;
    }

    return manifest;
  });

  albumPromiseCache.set(albumPath, pending);
  void pending.catch(() => {
    albumPromiseCache.delete(albumPath);
  });

  return pending;
};
