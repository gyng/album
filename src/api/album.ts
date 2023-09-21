import fs from "fs";
import path from "path";
import { v4 } from "uuid";
import { deserializeContentBlock } from "./deserialize";
import {
  Block,
  Content,
  PhotoBlock,
  SerializedContent,
  SerializedPhotoBlock,
  SerializedTextBlock,
  V2AlbumMetadata,
} from "./types";

export const ALBUMS_DIR = "public/data/albums";
export const MANIFEST_NAME = "manifest.json";
export const MANIFEST_V2_NAME = "album.json";

export const stripDirectoryCommands = (input: string): string => {
  return input.replaceAll(".newest-first", "");
};

export const getImageTimestampRange = (
  album: Content
): [number | null, number | null] => {
  // FIXME: dedup
  const earliest = album.blocks.reduce((acc: number, val: Block) => {
    if (val.kind === "photo") {
      const dt = new Date(val._build?.exif.DateTimeOriginal).getTime();
      return dt < acc ? dt : acc;
    }
    return acc;
  }, Number.MAX_VALUE);

  const latest = album.blocks.reduce((acc: number, val: Block) => {
    if (val.kind === "photo") {
      const dt = new Date(val._build?.exif.DateTimeOriginal).getTime();
      return dt > acc ? dt : acc;
    }
    return acc;
  }, 0);

  return [
    earliest !== Number.MAX_VALUE ? earliest : null,
    latest !== 0 ? latest : null,
  ];
};

export const getAlbumNames = async (
  albumsPath = ALBUMS_DIR
): Promise<string[]> => {
  return (await getAlbums(albumsPath)).map(
    (al) => al._build.srcdir.split(path.sep).pop() ?? "" // potential error
  );
};

export const getAlbums = (albumsPath = ALBUMS_DIR): Promise<Content[]> => {
  const albumNames = fs.readdirSync(albumsPath);
  const albums = Promise.all(
    albumNames.map((an) => {
      return getAlbum(path.join(albumsPath, an));
    })
  );
  return albums;
};

export const getAlbumFromName = (albumName: string): Promise<Content> => {
  return getAlbum(path.join(ALBUMS_DIR, albumName));
};

export const getAlbumWithoutManifest = async (
  albumPath: string
): Promise<Content> => {
  const photos = fs
    .readdirSync(albumPath)
    .filter((it) => !fs.lstatSync(path.join(albumPath, it)).isDirectory())
    .filter((it) => !it.match(/\.json$/));

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

  const coverBlock: SerializedPhotoBlock | null =
    photoBlocks.find((b) => b.data.src.includes("cover")) ?? null;

  const anonymousManifest: SerializedContent = {
    name: dirname,
    title: dirname,
    ...(coverBlock ? { cover: coverBlock } : {}),
    formatting: {
      sort: dirname.includes(".newest-first") ? "newest-first" : "oldest-first",
    },
    blocks: [titleBlock, ...photoBlocks],
  };

  return deserializeContentBlock(anonymousManifest, albumPath);
};

export const getAlbumWithManifest = async (
  /** Directory, eg, `public/data/albums/foobar` */
  rootRelativePath: string
): Promise<Content> => {
  const txt = fs.readFileSync(
    path.join(rootRelativePath, MANIFEST_NAME),
    "utf-8"
  );
  const manifest = JSON.parse(txt);
  return deserializeContentBlock(manifest, rootRelativePath);
};

// TODO: Add option to not optimise images until build time
export const getAlbum = async (
  /** Directory, eg, public/data/albums/simple */
  albumPath: string
): Promise<Content> => {
  // v1 manifest: legacy support from LoL, internal serialisation format
  const isManifest = fs.existsSync(path.join(albumPath, MANIFEST_NAME));

  // V2 manifest exists: use it instead of v1 manifest
  const isV2Manifest = fs.existsSync(path.join(albumPath, MANIFEST_V2_NAME));

  if (isManifest && !isV2Manifest) {
    return getAlbumWithManifest(albumPath);
  } else {
    let manifest = await getAlbumWithoutManifest(albumPath);

    // Sort by date
    manifest.blocks = manifest.blocks.sort((a, b) => {
      return (
        Date.parse((a as PhotoBlock)._build?.exif?.DateTimeOriginal ?? 0) -
        Date.parse((b as PhotoBlock)._build?.exif?.DateTimeOriginal ?? 0)
      );
    });

    // Set defaults
    const title = manifest.blocks.at(0);
    if (title?.kind === "text") {
      const range = getImageTimestampRange(manifest).map((ts) =>
        new Date(ts!).getFullYear()
      ) ?? [0, 0];
      title.data.kicker = `${range[0]}${
        range[1] === range[0] ? "" : `–${range[1]}`
      }`;
    }

    // TODO: clean this up by splitting this up
    // and default behaviour (no v1 manifest or v2 manifest)
    if (isV2Manifest) {
      const v2Config = fs.readFileSync(
        path.join(albumPath, MANIFEST_V2_NAME),
        "utf-8"
      );
      const v2Manifest = JSON.parse(v2Config) as V2AlbumMetadata;
      if (v2Manifest.sort === "newest-first") {
        manifest.blocks = manifest.blocks.sort((a, b) => {
          return (
            Date.parse(
              (b as PhotoBlock)._build?.exif?.DateTimeOriginal ??
                Number.MAX_VALUE
            ) -
            Date.parse(
              (a as PhotoBlock)._build?.exif?.DateTimeOriginal ??
                Number.MAX_VALUE
            )
          );
        });

        // TODO: DRY this out with above
        const title = manifest.blocks.at(0);
        if (title?.kind === "text") {
          const range = getImageTimestampRange(manifest).map((ts) =>
            new Date(ts!).getFullYear()
          ) ?? [0, 0];
          title.data.kicker = `${range[1]}${
            range[1] === range[0] ? "" : `–${range[0]}`
          }`;
        }
      }
    }

    return manifest;
  }
};
