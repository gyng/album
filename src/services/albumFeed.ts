import fs from "fs";
import path from "path";
import {
  ALBUMS_DIR,
  MANIFEST_NAME,
  MANIFEST_V2_NAME,
} from "./album";
import { measureBuild } from "./buildTiming";

type AlbumDirectoryEntry = {
  slug: string;
  albumPath: string;
  lastmod: string;
};

const isZoneIdentifierFile = (filename: string): boolean => {
  return filename.toLowerCase().includes(":zone.identifier");
};

const formatSitemapDate = (timestampMs: number): string =>
  new Date(timestampMs).toISOString().slice(0, 10);

const joinFeedDescriptionParts = (
  ...parts: Array<string | null | undefined>
): string => {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" - ");
};

const getAlbumDirectoryEntries = (
  albumsPath = ALBUMS_DIR,
): AlbumDirectoryEntry[] => {
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
  return (
    value
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || value
  );
};

export const getAlbumSitemapEntries = async (
  albumsPath = ALBUMS_DIR,
): Promise<Array<{ slug: string; lastmod: string }>> => {
  return measureBuild("albumFeed.getAlbumSitemapEntries", async () => {
    return getAlbumDirectoryEntries(albumsPath).map(({ slug, lastmod }) => ({
      slug,
      lastmod,
    }));
  });
};

export const getAlbumFeedEntries = async (
  albumsPath = ALBUMS_DIR,
  limit = 20,
): Promise<
  Array<{ slug: string; title: string; description: string; lastmod: string }>
> => {
  return measureBuild("albumFeed.getAlbumFeedEntries", async () => {
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
  return measureBuild("albumFeed.getAlbumFeedEntry", async () => {
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
  return measureBuild("albumFeed.getAlbumFeedItems", async () => {
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
