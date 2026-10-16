import type { Block, Content, PhotoBlock } from "../services/types";
import type { TripPhoto } from "./computeTrips";
import { toVideoBlockEntry } from "./videoBlockEntry";
import { tripPhotoFromBlock } from "./tripPhotoFromBlock";

/**
 * A clip wearing a photograph's shape, so the album surfaces — the home cards,
 * the neighbouring albums, the album's own cover — can draw its poster frame
 * through exactly the components and URL conventions a still uses.
 *
 * The poster the pipeline extracted is addressed by the same
 * `.resized_images/<file>@<size>.avif` URLs as any photo's variants, and
 * `toVideoBlockEntry` supplies it together with the moment the clip was
 * captured. The clip's own `_build.tags` rides along unchanged, so its palette,
 * alt text, geocode and derived zone are read through exactly the keys a
 * photograph's are. Returns null until the poster prepass has run, matching the
 * entry: without a frame there is nothing to draw.
 */
const videoBlockAsPhotoBlock = (block: Block): PhotoBlock | null => {
  const entry = toVideoBlockEntry(block);
  const srcset = entry?.block._build?.poster?.srcset;
  if (!entry || !srcset || srcset.length === 0) return null;

  return {
    kind: "photo",
    id: entry.anchor,
    // The album-page anchor, so a href derived from this block matches the map
    // and timeline's own clip links.
    data: { src: entry.anchor },
    _build: {
      width: entry.poster.width,
      height: entry.poster.height,
      exif: {},
      tags: entry.block._build?.tags ?? {},
      srcset,
    },
  };
};

/** A block as a photograph when it is one: a still unchanged, else a clip's poster. */
export const mediaBlockAsPhoto = (block: Block): PhotoBlock | null =>
  block.kind === "photo" ? block : videoBlockAsPhotoBlock(block);

/**
 * The frame an album shows as its cover: the photo explicitly marked as the
 * cover, else its first photograph, else the first clip with a poster to draw.
 */
export const coverBlockOf = (blocks: readonly Block[]): PhotoBlock | undefined => {
  const photo =
    blocks.find(
      (block): block is PhotoBlock => block.kind === "photo" && Boolean(block.formatting?.cover),
    ) ?? blocks.find((block): block is PhotoBlock => block.kind === "photo");
  if (photo) return photo;

  for (const block of blocks) {
    const asPhoto = mediaBlockAsPhoto(block);
    if (asPhoto) return asPhoto;
  }
  return undefined;
};

/**
 * A clip's own trip input: the poster as a photograph, so the clip's palette,
 * tags, alt text and geocode arrive through `tripPhotoFromBlock` exactly as a
 * still's do.
 *
 * Only the moment and place are overridden from the entry: this clip was
 * captured at a wall clock the poster sidecar read and stood at coordinates it
 * recorded as decimals, so there are no EXIF rationals for `tripPhotoFromBlock`
 * to decode them from.
 */
const tripPhotoFromVideoBlock = (album: Content, block: Block): TripPhoto | null => {
  const entry = toVideoBlockEntry(block);
  const asPhoto = videoBlockAsPhotoBlock(block);
  if (!entry || !asPhoto) return null;

  return {
    ...tripPhotoFromBlock(album, asPhoto),
    date: entry.capturedAtLocal,
    lat: entry.decLat,
    lng: entry.decLng,
  };
};

/**
 * Every dated piece of an album as trip input: photographs and clips alike.
 *
 * The two callers — the build, over every album, and the album page, over its
 * own blocks — must read a piece of media identically or the same journey
 * renders differently depending on which page asked.
 */
export const albumTripPhotos = (album: Content): TripPhoto[] =>
  album.blocks.flatMap((block) => {
    if (block.kind === "photo") {
      return [tripPhotoFromBlock(album, block)];
    }
    const clip = tripPhotoFromVideoBlock(album, block);
    return clip ? [clip] : [];
  });
