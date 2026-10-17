import React from "react";
import { isPlayableClipPath } from "../../util/videoScenePath";

/**
 * A tile's clip preview plays only where a pointer is doing the asking. A touch
 * device has no hover to arrive from, and a reader who has asked for reduced
 * motion has asked for exactly this not to happen.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `window.matchMedia` is absent in some environments and its media query lists
 * are not always subscribable, so both halves of the store guard themselves.
 * False on the server and during hydration, as it always was before mount.
 */
const mediaQuery = (query: string) => ({
  subscribe: (onChange: () => void): (() => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const list = window.matchMedia(query);
    if (typeof list.addEventListener !== "function") return () => {};
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  },
  read: (): boolean => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
});

const coarsePointer = mediaQuery(COARSE_POINTER_QUERY);
const reducedMotion = mediaQuery(REDUCED_MOTION_QUERY);

/**
 * A blocked autoplay rejects the promise, and this preview is decorative: there
 * is nothing to say to the reader about a poster that stayed a poster.
 */
const playIgnoringFailure = (video: HTMLVideoElement): void => {
  video.play().catch(() => {});
};

export type HoverPlayClipHandlers = {
  onPointerEnter: React.PointerEventHandler;
  onPointerLeave: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
  onBlur: React.FocusEventHandler;
};

/**
 * The clip preview a thumbnail plays while it is hovered.
 *
 * Nothing is fetched or decoded until a qualifying enter: the `<video>` does
 * not exist before then, and it asks for no data when it does (`preload="none"`
 * on the element). Once armed it stays mounted, so a second hover is instant
 * and issues no new request, and leaving and re-entering only pauses and plays.
 *
 * Focus deliberately does nothing: a keyboard reader keeps the poster and its
 * badge, and blur stops whatever a pointer started.
 */
export const useHoverPlayClip = (
  clipPath: string | null,
): {
  /** False for a coarse pointer, reduced motion, an unplayable path, or null. */
  isPlayable: boolean;
  /** False until the first qualifying pointerenter — the element must not exist before it. */
  shouldRenderVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Spread on the wrapper element the consumer already renders. */
  handlers: HoverPlayClipHandlers;
} => {
  const isCoarsePointer = React.useSyncExternalStore(
    coarsePointer.subscribe,
    coarsePointer.read,
    () => false,
  );
  const prefersReducedMotion = React.useSyncExternalStore(
    reducedMotion.subscribe,
    reducedMotion.read,
    () => false,
  );

  const isPlayable =
    !isCoarsePointer && !prefersReducedMotion && clipPath !== null && isPlayableClipPath(clipPath);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [shouldRenderVideo, setShouldRenderVideo] = React.useState(false);
  // Where the pointer is, kept in a ref: a visibility change reads it when it
  // happens, and a state copy would be stale by then.
  const pointerInsideRef = React.useRef(false);

  // A hidden tab must not keep decoding, so it pauses; coming back resumes only
  // for a pointer that is still on the tile.
  React.useEffect(() => {
    if (!isPlayable) return;

    const handleVisibilityChange = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        video.pause();
        return;
      }
      if (pointerInsideRef.current) {
        playIgnoringFailure(video);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isPlayable]);

  // The first qualifying enter mounts the element, and the pointer is already
  // inside by the time it exists, so the play it asked for happens here.
  React.useEffect(() => {
    if (!shouldRenderVideo || document.hidden) return;
    const video = videoRef.current;
    if (video && pointerInsideRef.current) {
      playIgnoringFailure(video);
    }
  }, [shouldRenderVideo]);

  const handlers: HoverPlayClipHandlers = {
    onPointerEnter: (event) => {
      // The media query describes the primary pointer only; a finger on a
      // touchscreen laptop is a touch whatever the device's primary pointer is.
      if (!isPlayable || event.pointerType === "touch") return;
      pointerInsideRef.current = true;
      setShouldRenderVideo(true);
      const video = videoRef.current;
      // On the first enter there is no element yet; the mount effect plays it.
      // A hidden tab starts nothing — the visibility listener resumes instead.
      if (video && !document.hidden) playIgnoringFailure(video);
    },
    onPointerLeave: () => {
      pointerInsideRef.current = false;
      videoRef.current?.pause();
    },
    onPointerCancel: () => {
      pointerInsideRef.current = false;
      videoRef.current?.pause();
    },
    onBlur: () => {
      videoRef.current?.pause();
    },
  };

  return { isPlayable, shouldRenderVideo, videoRef, handlers };
};
