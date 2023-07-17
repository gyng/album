import path from "path";
import {
  getNextJsSafeExif,
  getPhotoSize,
  optimiseImages,
  stripPublicFromPath,
} from "./photo";
import {
  Block,
  Content,
  PhotoBlock,
  SerializedBlock,
  SerializedContent,
  SerializedPhotoBlock,
  SerializedTextBlock,
  TextBlock,
} from "./types";

export const deserializeTextBlock = async (
  serialized: SerializedTextBlock
): Promise<TextBlock> => {
  const copy = { ...serialized };
  return new Promise((resolve) => {
    resolve(copy);
  });
};

export const deserializePhotoBlock = async (
  block: SerializedPhotoBlock,
  options: {
    dirname: string;
  }
): Promise<PhotoBlock> => {
  const photoFilename = block.data.src;
  const localFilepath = path.join(options.dirname, photoFilename);

  const { width, height } = await getPhotoSize(localFilepath);
  const exif = await getNextJsSafeExif(localFilepath);
  const srcset = await optimiseImages(localFilepath);

  const copy: PhotoBlock = {
    ...block,
    formatting: {
      cover: block.data.src.includes("cover"),
      ...block.formatting,
    },
    data: {
      ...block.data,
      src: stripPublicFromPath(path.join(options.dirname, block.data.src)),
    },
    _build: {
      srcset,
      exif: exif,
      width,
      height,
    },
  };

  return copy;
};

export const deserializeBlock = async (
  b: SerializedBlock,
  dirname?: string
): Promise<Block> => {
  switch (b.kind) {
    case "photo":
      if (dirname) {
        return deserializePhotoBlock(b, { dirname });
      }
      throw new Error("Need dirname for photoblock deser");
    case "text":
      return deserializeTextBlock(b);
    default:
      // @ts-expect-error
      throw new Error(`unsupported kind ${b.kind}`);
  }
};

export const deserializeContentBlock = async (
  serialized: SerializedContent,
  /** Relative to Next.js root, eg, `public/data/albums/foobar` */
  dirname: string
): Promise<Content> => {
  return {
    ...serialized,
    blocks: await Promise.all(
      serialized.blocks.map(async (b) => deserializeBlock(b, dirname))
    ),
    _build: {
      slug: serialized.name,
      srcdir: dirname,
    },
  };
};
