import { getAlbums, getImageTimestampRange } from "../album";
import type { Content, PhotoBlock, Tags, VideoBlock } from "../types";
import type { AlbumPreview, HomePageData } from "../../util/pageDataTypes";
import { mediaBlockAsPhoto } from "../../util/videoBlockMedia";

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

const compactHomePreviewVideo = (video: VideoBlock): VideoBlock => {
  const poster = video._build?.poster;
  const { alt_text, colors }: Tags = video._build?.tags ?? {};
  return {
    kind: "video",
    id: video.id,
    data: video.data,
    _build: {
      src: video._build?.src ?? video.data.href,
      mimeType: video._build?.mimeType ?? "",
      ...(poster ? { poster: { srcset: poster.srcset } } : {}),
      ...(video._build?.capturedAtLocal !== undefined
        ? { capturedAtLocal: video._build.capturedAtLocal }
        : {}),
      // The card reads the same keys a photograph's preview keeps: the alt text
      // and the palette that fills the cover before it loads.
      tags: {
        ...(alt_text !== undefined ? { alt_text } : {}),
        ...(colors !== undefined ? { colors } : {}),
      },
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

/** An album as a card: its covers plus the first piece of media, nothing else. */
export const toAlbumPreview = (album: Content): AlbumPreview => {
  // Keep only covers plus the first media item, deduplicating when the cover is
  // also first. This limits the serialised payload. A clip joins a photograph
  // here — counted like one and drawn through its poster frame.
  const coverBlocks = album.blocks.filter(
    (block): block is PhotoBlock => block.kind === "photo" && Boolean(block.formatting?.cover),
  );
  const firstMedia = album.blocks.find(
    (block): block is PhotoBlock | VideoBlock => mediaBlockAsPhoto(block) !== null,
  );
  const previewBlocks: (PhotoBlock | VideoBlock)[] =
    firstMedia && !coverBlocks.some((block) => block.id === firstMedia.id)
      ? [...coverBlocks, firstMedia]
      : coverBlocks;
  return {
    ...album,
    photoCount: album.blocks.filter((block) => block.kind === "photo" || block.kind === "video")
      .length,
    blocks: previewBlocks.map((block) =>
      block.kind === "video" ? compactHomePreviewVideo(block) : compactHomePreviewPhoto(block),
    ),
    _build: { ...album._build, timeRange: getImageTimestampRange(album) },
  };
};

export const loadHomePageData = async (): Promise<HomePageData> => ({
  albums: sortAlbumsForHome(await getAlbums()).map(toAlbumPreview),
});
