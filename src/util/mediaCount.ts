/**
 * "12 photos", "3 clips", "12 photos and 3 clips". A clip is media too, so it
 * belongs in a count shown to readers — but as a clip: counted as a photo, a
 * day of five clips read "5 photos".
 */
export const formatMediaCount = (photoCount: number, clipCount: number): string => {
  const photos = `${photoCount.toLocaleString("en")} ${photoCount === 1 ? "photo" : "photos"}`;
  if (clipCount === 0) return photos;
  const clips = `${clipCount.toLocaleString("en")} ${clipCount === 1 ? "clip" : "clips"}`;
  return photoCount === 0 ? clips : `${photos} and ${clips}`;
};

/** The same, for a list whose clips are marked `mediaKind: "video"`. */
export const formatMediaCountOf = (items: ReadonlyArray<{ mediaKind?: string }>): string => {
  const clipCount = items.filter((item) => item.mediaKind === "video").length;
  return formatMediaCount(items.length - clipCount, clipCount);
};
