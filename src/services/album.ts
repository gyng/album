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

const listAlbumDirectories = (albumsPath: string): string[] => {
  return fs.readdirSync(albumsPath).filter((it) => {
    return fs.lstatSync(path.join(albumsPath, it)).isDirectory();
  });
};

const isZoneIdentifierFile = (filename: string): boolean => {
  return filename.toLowerCase().includes(":zone.identifier");
};

const removeZoneIdentifierSidecar = (sidecarPath: string): boolean => {
  try {
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
      console.log(`Deleted Zone.Identifier sidecar file: ${sidecarPath}`);
    }
  } catch (err) {
    console.warn(`Failed to delete Zone.Identifier sidecar: ${sidecarPath}`, err);
  }

  return false;
};

const listAlbumMediaFiles = (albumPath: string): string[] => {
  return fs
    .readdirSync(albumPath)
    .filter((it) => !fs.lstatSync(path.join(albumPath, it)).isDirectory())
    .filter((it) => !it.match(/\.json$/))
    .filter((it) => {
      if (!isZoneIdentifierFile(it)) {
        return true;
      }

      return removeZoneIdentifierSidecar(path.join(albumPath, it));
    });
};

export const getBlockDate = (block: Block): number => {
  if (block.kind === "text") {
    return 1;
  }
  if (block.kind === "photo") {
    const t = Date.parse(block._build?.exif?.DateTimeOriginal ?? "");
    return isNaN(t) ? 0 : t;
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
    const dt = new Date(block._build?.exif?.DateTimeOriginal ?? "").getTime();
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
    return listAlbumDirectories(albumsPath);
  });
};

export const getAlbums = (albumsPath = ALBUMS_DIR): Promise<Content[]> => {
  return measureBuild("album.getAlbums", async () => {
    const albumNames = listAlbumDirectories(albumsPath);

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
    const mediaFiles = listAlbumMediaFiles(albumPath);

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

const loadV2Manifest = (albumPath: string): V2AlbumMetadata | null => {
  const v2Path = path.join(albumPath, MANIFEST_V2_NAME);
  if (!fs.existsSync(v2Path)) {
    return null;
  }

  const v2Config = fs.readFileSync(v2Path, "utf-8");
  return JSON.parse(v2Config) as V2AlbumMetadata;
};

const appendExternalBlocks = (
  manifest: Content,
  albumPath: string,
  externals?: V2AlbumMetadata["externals"],
): void => {
  externals?.forEach((ext) => {
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
      return;
    }

    if (isZoneIdentifierFile(ext.href)) {
      removeZoneIdentifierSidecar(path.join(albumPath, ext.href));
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
  });
};

const isPhotoBlockWithSrc = (
  block: Block,
  src: string,
): block is import("./types").PhotoBlock => {
  return block.kind === "photo" && block.data.src.includes(src);
};

const applyCoverSelection = (
  manifest: Content,
  cover?: string,
): void => {
  if (!cover) {
    return;
  }

  manifest.cover = { src: cover };
  const coverBlock = manifest.blocks.find((block) =>
    isPhotoBlockWithSrc(block, cover),
  );

  if (coverBlock) {
    coverBlock.formatting = { ...coverBlock.formatting, cover: true };
  }
};

const moveTextBlocksToTop = (blocks: Block[]): Block[] => {
  const textBlocks = blocks.filter((b) => b.kind === "text");
  const otherBlocks = blocks.filter((b) => b.kind !== "text");
  return [...textBlocks, ...otherBlocks];
};

const applyTitleKickerDefaults = (
  manifest: Content,
  sortOrder: "newest-first" | "oldest-first",
): void => {
  const title = manifest.blocks.at(0);
  if (title?.kind !== "text") {
    return;
  }

  const [earliest, latest] = getImageTimestampRange(manifest);
  if (earliest == null || latest == null) {
    return;
  }

  const [from, to] =
    sortOrder === "newest-first"
      ? [new Date(latest).getFullYear(), new Date(earliest).getFullYear()]
      : [new Date(earliest).getFullYear(), new Date(latest).getFullYear()];
  title.data.kicker = `${from}${to === from ? "" : `–${to}`}`;
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
    const v2Manifest = loadV2Manifest(albumPath);

    if (isManifest && !v2Manifest) {
      // Warning: deprecated!
      return getAlbumWithManifest(albumPath);
    }

    // This may be a v2 manifest
    // Get deserialised
    let manifest = await getAlbumWithoutManifest(albumPath);

    // Sort by date
    manifest.blocks = sortBlocksByDate(manifest.blocks);

    if (v2Manifest) {
      appendExternalBlocks(manifest, albumPath, v2Manifest.externals);
      applyCoverSelection(manifest, v2Manifest.cover);
    }

    manifest.blocks = sortBlocksByDate(
      manifest.blocks,
      v2Manifest?.sort ?? "oldest-first",
    );
    manifest.blocks = moveTextBlocksToTop(manifest.blocks);
    applyTitleKickerDefaults(manifest, v2Manifest?.sort ?? "oldest-first");

    return manifest;
  });

  albumPromiseCache.set(albumPath, pending);
  void pending.catch(() => {
    albumPromiseCache.delete(albumPath);
  });

  return pending;
};
