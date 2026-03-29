import { PhotoBlock } from "../services/types";

const normalizeWhitespace = (value?: string): string | null => {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
};

const humanizeFilename = (src?: string): string | null => {
  const filename = src?.split("/").at(-1)?.replace(/\.[^.]+$/, "");
  if (!filename) {
    return null;
  }

  const humanized = filename
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return humanized || null;
};

const getPhotoDateLabel = (block: PhotoBlock): string | null => {
  const rawDate = block._build?.exif?.DateTimeOriginal;
  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

export const getPhotoAltText = (
  block: PhotoBlock,
  fallback = "Photo",
): string => {
  const explicit =
    normalizeWhitespace(block._build?.tags?.alt_text) ??
    normalizeWhitespace(block.data.title) ??
    normalizeWhitespace(block.data.kicker) ??
    normalizeWhitespace(block.data.description);

  if (explicit) {
    return explicit;
  }

  const filename = humanizeFilename(block.data.src);
  const dateLabel = getPhotoDateLabel(block);

  if (filename && dateLabel) {
    return `${filename}, ${dateLabel}`;
  }

  if (filename) {
    return filename;
  }

  if (dateLabel) {
    return `${fallback}, ${dateLabel}`;
  }

  return fallback;
};
