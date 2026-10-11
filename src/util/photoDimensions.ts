import type { PhotoBlock } from "../services/types";

export const isExifRotated = (block: PhotoBlock): boolean =>
  Boolean(
    block._build.exif.Orientation?.includes("270") || block._build.exif.Orientation?.includes("90"),
  );

export const getDisplayDimensions = (block: PhotoBlock): { width: number; height: number } =>
  isExifRotated(block)
    ? { width: block._build.height, height: block._build.width }
    : { width: block._build.width, height: block._build.height };
