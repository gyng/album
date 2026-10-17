import {
  computeVisualSamenessStats,
  type VisualSamenessStats,
} from "../../util/computeEmbeddingStats";
import { computePhotoStats, type PhotoStats } from "../../util/computeStats";
import { rgbToString } from "../../util/colorDistance";
import { formatExifWallClockIso, parseExifLocalDateTime } from "../../util/exifTime";
import type { ExploreClipRow } from "../../util/pageDataTypes";
import { toVideoBlockEntry } from "../../util/videoBlockEntry";
import { getAlbums } from "../album";
import type { Block, Content, VideoBlock } from "../types";

const isLocalVideo = (block: Block): block is VideoBlock =>
  block.kind === "video" && block.data.type === "local";

/**
 * Every playable clip in the archive, newest first. An external has no file of
 * its own to watch, and a clip whose poster prepass has not run has no frame to
 * draw, so both are left out — exactly as the timeline and the map leave them.
 */
export const loadExploreClips = (albums: Content[]): ExploreClipRow[] =>
  albums
    .flatMap((album) =>
      album.blocks.flatMap((block): ExploreClipRow[] => {
        if (!isLocalVideo(block)) return [];

        const clip = toVideoBlockEntry(block);
        if (!clip) return [];

        const wallClock = parseExifLocalDateTime(clip.capturedAtLocal);
        if (!wallClock) return [];

        const tags = block._build?.tags;
        const primaryColor = tags?.colors?.[0];

        return [
          {
            id: clip.anchor,
            album: album._build.slug,
            href: `/album/${album._build.slug}#${encodeURIComponent(clip.anchor)}`,
            src: clip.poster,
            // One form, whichever the clip was read in: a sidecar's ISO or a
            // manifest's EXIF colons, which as raw strings sort out of order.
            capturedAtLocal: formatExifWallClockIso(wallClock),
            year: wallClock.year,
            ...(clip.durationSeconds !== undefined
              ? { durationSeconds: clip.durationSeconds }
              : {}),
            label: tags?.alt_text ?? clip.anchor,
            ...(primaryColor ? { swatch: rgbToString(primaryColor) } : {}),
          },
        ];
      }),
    )
    .sort((left, right) => {
      if (left.capturedAtLocal !== right.capturedAtLocal) {
        return right.capturedAtLocal.localeCompare(left.capturedAtLocal);
      }
      if (left.album !== right.album) return left.album.localeCompare(right.album);
      return left.id.localeCompare(right.id);
    });

export type ExplorePageData = {
  stats: PhotoStats;
  visualSameness: VisualSamenessStats | null;
  clips: ExploreClipRow[];
};

export const loadExplorePageData = async (): Promise<ExplorePageData> => {
  const albums = await getAlbums();
  const stats = computePhotoStats(albums);
  const clips = loadExploreClips(albums);
  // A corrupt or missing embeddings DB should remove this optional section,
  // not fail the complete static build.
  let visualSameness: VisualSamenessStats | null = null;
  try {
    visualSameness = await computeVisualSamenessStats(albums);
  } catch (error) {
    console.error("Failed to compute visual sameness stats", error);
  }
  return { stats, visualSameness, clips };
};
