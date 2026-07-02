import {
  Block,
  Content,
  PhotoBlock,
  SerializedBlock,
  SerializedContent,
  SerializedPhotoBlock,
  SerializedTextBlock,
  SerializedVideoBlock,
  TextBlock,
  VideoBlock,
} from "./types";

export const serializePhotoBlock = (
  block: PhotoBlock,
): SerializedPhotoBlock => {
  // Work on a shallow copy of `formatting` so the source Content is never
  // mutated (the previous `delete` operated on the shared reference).
  const formatting = block.formatting ? { ...block.formatting } : undefined;

  if (formatting && !formatting.immersive) {
    delete formatting.immersive;
  }

  const hasFormatting = formatting && Object.keys(formatting).length > 0;

  const copy: SerializedPhotoBlock = {
    kind: block.kind,
    id: block.id,
    data: block.data,
    ...(hasFormatting ? { formatting } : {}),
  };

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

export const serializeVideoBlock = (
  block: VideoBlock,
): SerializedVideoBlock => {
  const copy = { ...block };
  return copy;
};

export const serializeBlock = (block: Block): SerializedBlock => {
  switch (block.kind) {
    case "photo":
      return serializePhotoBlock(block);
    case "text":
      return serializeTextBlock(block);
    case "video":
      return serializeVideoBlock(block);
    default:
      throw new Error(`serializeBlock: Unsupported block ${(block as any).kind}`);
  }
};
