import { PhotoBlock } from "../services/types";
import { parseExifLocalDateTime } from "../util/exifTime";

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
  const dt = parseExifLocalDateTime(rawDate);
  if (!dt) {
    return null;
  }

  // DateTimeOriginal is camera-local wall-clock time — label the calendar
  // date the photographer experienced, on any build machine
  return new Date(dt.year, dt.month - 1, dt.day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
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
