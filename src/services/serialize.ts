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

export const serializePhotoBlock = (
  block: PhotoBlock,
): SerializedPhotoBlock => {
  const copy = { ...block };

  if (!block.formatting?.immersive) {
    delete block.formatting?.immersive;
  }
  if (block.formatting && Object.keys(block.formatting).length === 0) {
    delete block.formatting;
  }
  // @ts-expect-error
  delete copy._build;

  return copy;
};

export const serializeContentBlock = (block: Content): SerializedContent => {
  const copy = { ...block, blocks: block.blocks.map((b) => serializeBlock(b)) };
  // @ts-expect-error Converting Content to Serialized
  delete copy._build;
  return copy;
};

export const serializeTextBlock = (block: TextBlock): SerializedTextBlock => {
  const copy = { ...block };

  if (block.formatting && Object.keys(block.formatting).length === 0) {
    delete block.formatting;
  }

  return copy;
};

export const serializeBlock = (block: Block): SerializedBlock => {
  switch (block.kind) {
    case "photo":
      return serializePhotoBlock(block);
    case "text":
      return serializeTextBlock(block);
    default:
      // @ts-expect-error
      throw new Error(`serializeBlock: Unsupported block ${block.kind}`);
  }
};
