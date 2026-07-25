import React from "react";
import type { MapWorldEntry } from "../util/pageDataTypes";

/**
 * How many thumbnails one warming pass will ask for.
 *
 * A city viewport can hold hundreds of photos, and every request made here
 * competes with the map's own tiles — which the reader is looking at *now*,
 * for images they may never zoom far enough to see. The cap is deliberately
 * around what a screen has room to show at the reveal zoom.
 */
export const THUMBNAIL_PREFETCH_LIMIT = 60;

/**
 * Fetches marker thumbnails slightly before anything draws them.
 *
 * Crossing the reveal zoom swaps the whole marker path at once: the drawn pins
 * go, a DOM marker each arrives, and every image starts loading from cold. That
 * is the moment the reader is watching, so the loading should have happened
 * before it — by the time the markers mount the browser has the pictures and
 * the fade is a real fade rather than a grid of empty frames filling in.
 *
 * Requests go out through plain `Image` objects rather than the marker's own
 * `<img loading="lazy">`, which cannot help here: there is no element yet.
 */
export const useMapThumbnailPrefetch = (
  photos: readonly Pick<MapWorldEntry, "src">[],
  enabled: boolean,
  limit: number = THUMBNAIL_PREFETCH_LIMIT,
): void => {
  // Every source asked for so far this session. A pan inside the warming band
  // hands over a mostly-overlapping set each time, and a photo the browser has
  // already fetched does not need asking for again.
  const requestedRef = React.useRef<Set<string>>(new Set());
  // The requests still in flight. An `Image` with nothing referring to it is
  // collectable, and a collected one may never finish loading.
  const pendingRef = React.useRef<Set<HTMLImageElement>>(new Set());

  React.useEffect(() => {
    if (!enabled || typeof Image !== "function") {
      return;
    }

    let started = 0;
    for (const photo of photos) {
      if (started >= limit) {
        break;
      }

      const source = photo.src.src;
      if (requestedRef.current.has(source)) {
        continue;
      }

      requestedRef.current.add(source);
      started += 1;

      const image = new Image();
      image.decoding = "async";
      // Behind the tiles and anything else the current view is actually made
      // of: this is work for a zoom level the reader has not reached.
      image.fetchPriority = "low";
      pendingRef.current.add(image);
      const settle = () => {
        pendingRef.current.delete(image);
      };
      image.addEventListener("load", settle, { once: true });
      image.addEventListener("error", settle, { once: true });
      image.src = source;
    }
  }, [enabled, limit, photos]);
};
