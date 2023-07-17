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
} from "./types";

export const ALBUMS_DIR = "public/data/albums";
export const MANIFEST_NAME = "manifest.json";

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
    formatting: {},
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
  const isManifest = fs.existsSync(path.join(albumPath, MANIFEST_NAME));

  if (isManifest) {
    return getAlbumWithManifest(albumPath);
  } else {
    let manifest = await getAlbumWithoutManifest(albumPath);
    manifest.blocks = manifest.blocks.sort((a, b) => {
      return (
        Date.parse((a as PhotoBlock)._build?.exif?.DateTimeOriginal ?? 0) -
        Date.parse((b as PhotoBlock)._build?.exif?.DateTimeOriginal ?? 0)
      );
    });

    const title = manifest.blocks.at(0);
    if (title?.kind === "text") {
      const range = getImageTimestampRange(manifest).map((ts) =>
        new Date(ts!).getFullYear()
      ) ?? [0, 0];
      title.data.kicker = `${range[0]}${
        range[1] === range[0] ? "" : `–${range[1]}`
      }`;
    }

    return manifest;
  }
};
