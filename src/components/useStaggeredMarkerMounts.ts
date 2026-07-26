import React from "react";

/**
 * How many markers may mount in one frame.
 *
 * A warmed Firefox reload with 91 thumbnails took roughly 500ms to admit them
 * eight at a time, so cached pictures still visibly streamed in. Twenty-four
 * reduces that view to four batches while preserving the stagger that prevents
 * the measured 500–700ms frozen frame when every marker mounts together.
 */
export const MARKER_MOUNT_CHUNK = 24;

/**
 * Lets markers arrive over several frames instead of all in one.
 *
 * Crossing the thumbnail zoom over a dense city mounts every marker in view at
 * once — measured at a 500–700ms frozen frame and ~1.3s of long tasks for 126
 * of them, which is the stall the reader sees as the map lurching rather than
 * zooming. Nothing about that work is avoidable; it is the *simultaneity* that
 * hurts, so this admits a fixed number per frame and lets the rest follow.
 *
 * Departures are not staggered. Unmounting is cheap, and a marker that has left
 * the viewport has no reason to linger.
 */
export const useStaggeredMarkerMounts = <T extends { href: string }>(
  photos: readonly T[],
  chunk: number = MARKER_MOUNT_CHUNK,
  /**
   * Whether these markers are being drawn at all. Below the thumbnail zoom the
   * photos are one GPU layer and no marker exists, so admitting them anyway
   * would quietly spend the entire stagger before the reveal — and then hand
   * the reveal every marker at once, which is the burst this exists to spread.
   */
  enabled: boolean = true,
): T[] => {
  const [admitted, setAdmitted] = React.useState<ReadonlySet<string>>(() => new Set());
  // Derived rather than stored, so a marker that leaves is gone on the very
  // next render without waiting for a frame to be granted.
  const mounted = React.useMemo(
    () => (enabled ? photos.filter((photo) => admitted.has(photo.href)) : []),
    [admitted, enabled, photos],
  );

  // Nothing admitted at all — the map has just been handed a set it has never
  // shown, by a reveal, a filter, or a jump somewhere else entirely. Seeded
  // during this render rather than a frame later, because waiting would read as
  // the map having lost its markers. Converges immediately: the seed is
  // non-empty whenever `photos` is.
  if (enabled && photos.length > 0 && mounted.length === 0) {
    setAdmitted(new Set(photos.slice(0, chunk).map((photo) => photo.href)));
  }

  React.useEffect(() => {
    if (!enabled) {
      // Forgotten rather than kept: the next reveal has to stagger from
      // nothing, and holding the set would let it mount everything at once.
      setAdmitted((current) => (current.size > 0 ? new Set() : current));
      return;
    }

    const pending = photos.filter((photo) => !admitted.has(photo.href));
    if (pending.length === 0) {
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      setAdmitted(new Set(photos.map((photo) => photo.href)));
      return;
    }

    const handle = requestAnimationFrame(() => {
      setAdmitted((current) => {
        const next = new Set<string>();
        // Rebuilt from what is actually in range, so the set cannot grow into a
        // record of every photo the map has ever shown.
        photos.forEach((photo) => {
          if (current.has(photo.href)) {
            next.add(photo.href);
          }
        });
        pending.slice(0, chunk).forEach((photo) => {
          next.add(photo.href);
        });

        return next;
      });
    });

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [admitted, chunk, enabled, photos]);

  return mounted;
};
