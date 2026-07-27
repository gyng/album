import type { Block, VideoBlock } from "../services/types";

/**
 * The parts of a video block that let it stand beside photos on the map and the
 * timeline: a moment, a frame, and sometimes a place.
 *
 * A clip has all three only once `npm run prepare:posters` has extracted its
 * poster — before that there is no frame to draw, so it is left out rather than
 * rendered as a hole in a grid.
 */
export type VideoBlockEntry = {
  block: VideoBlock;
  /** Stable anchor within the album page, matching the search index's name. */
  anchor: string;
  poster: { src: string; width: number; height: number };
  capturedAtLocal: string;
  decLat: number | null;
  decLng: number | null;
  durationSeconds?: number;
};

const isVideoBlock = (block: Block): block is VideoBlock => block.kind === "video";

export const toVideoBlockEntry = (block: Block): VideoBlockEntry | null => {
  if (!isVideoBlock(block)) {
    return null;
  }

  const build = block._build;
  const poster = build?.poster?.srcset?.[0];
  // `data.date` is the manifest's own value where one was given, and the
  // pipeline already normalised both to camera-local wall clock.
  const capturedAtLocal = build?.capturedAtLocal ?? block.data.date;
  if (!poster || !capturedAtLocal) {
    return null;
  }

  return {
    block,
    anchor: block.id,
    poster,
    capturedAtLocal,
    decLat: build?.latDeg ?? null,
    decLng: build?.lngDeg ?? null,
    ...(build?.durationSeconds !== undefined ? { durationSeconds: build.durationSeconds } : {}),
  };
};
