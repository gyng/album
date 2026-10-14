import { getAlbums, getImageTimestampRange } from "../album";
import type { Content, PhotoBlock } from "../types";
import type { AlbumPreview, HomePageData } from "../../util/pageDataTypes";

const compactHomePreviewPhoto = (photo: PhotoBlock): PhotoBlock => {
  const { DateTimeOriginal, Orientation } = photo._build.exif;
  const { alt_text, colors } = photo._build.tags;
  return {
    kind: "photo",
    id: photo.id ?? photo.data.src,
    data: photo.data,
    ...(photo.formatting ? { formatting: photo.formatting } : {}),
    _build: {
      width: photo._build.width,
      height: photo._build.height,
      exif: {
        ...(DateTimeOriginal !== undefined ? { DateTimeOriginal } : {}),
        ...(Orientation !== undefined ? { Orientation } : {}),
      },
      tags: {
        ...(alt_text !== undefined ? { alt_text } : {}),
        ...(colors !== undefined ? { colors } : {}),
      },
      srcset: photo._build.srcset,
    },
  };
};

/** The order albums appear in on the home page, which album pages also step through. */
export const sortAlbumsForHome = <T extends Content>(albums: readonly T[]): T[] =>
  [...albums]
    .sort((a, b) => {
      const bTime = getImageTimestampRange(b)[1] ?? "";
      const aTime = getImageTimestampRange(a)[1] ?? "";
      return bTime.localeCompare(aTime);
    })
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
    // Push test albums to the end.
    .sort((a, b) => (a.name.startsWith("test") ? 1 : 0) - (b.name.startsWith("test") ? 1 : 0));

/** An album as a card: its covers plus the first photo, nothing else. */
export const toAlbumPreview = (album: Content): AlbumPreview => {
  // Keep only covers plus the first photo, deduplicating when the cover is
  // also first. This limits the serialised payload.
  const coverBlocks = album.blocks.filter(
    (block): block is PhotoBlock => block.kind === "photo" && Boolean(block.formatting?.cover),
  );
  const firstPhoto = album.blocks.find((block) => block.kind === "photo");
  const previewBlocks: PhotoBlock[] =
    firstPhoto && !coverBlocks.some((block) => block.id === firstPhoto.id)
      ? [...coverBlocks, firstPhoto]
      : coverBlocks;
  return {
    ...album,
    photoCount: album.blocks.filter((block) => block.kind === "photo").length,
    blocks: previewBlocks.map(compactHomePreviewPhoto),
    _build: { ...album._build, timeRange: getImageTimestampRange(album) },
  };
};

export const loadHomePageData = async (): Promise<HomePageData> => ({
  albums: sortAlbumsForHome(await getAlbums()).map(toAlbumPreview),
});
