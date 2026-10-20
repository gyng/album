import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

type Position = {
  x: number;
  y: number;
  path: string;
  at: number;
  viewport: number;
  scrollLeft?: number;
};
const STORAGE_KEY = "gallery-nav-position";
type Region = "left" | "right" | "trailing";
const lastPositions = new Map<Region, Position>();

// Animate the measured position rather than the page padding: both the map's
// fixed chrome and the ordinary page shell can participate in the same move.
export const useNavPositionMotion = (
  ref: RefObject<HTMLElement | null>,
  region: Region,
  edge: "left" | "right" = "left",
) => {
  const previous = useRef<Position | null>(null);
  const animation = useRef<Animation | null>(null);
  const startFrame = useRef<number | null>(null);
  const idleStart = useRef<number | null>(null);
  const continued = useRef(false);
  const measure = useCallback(
    (visual = false): Position | null => {
      const node = ref.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const viewportRegion = node.closest("[data-nav-viewport-motion]");
      const sticky = viewportRegion && getComputedStyle(viewportRegion).position === "sticky";
      const transform = getComputedStyle(node).transform;
      const matrix =
        transform !== "none" && typeof DOMMatrixReadOnly !== "undefined"
          ? new DOMMatrixReadOnly(transform)
          : null;
      return {
        x:
          (edge === "right" ? rect.right : rect.x) +
          window.scrollX -
          (visual ? 0 : (matrix?.m41 ?? 0)),
        // Sticky album chrome is already anchored to the viewport. Adding its
        // document scroll would launch the next page's nav hundreds of pixels away.
        y: rect.y + (sticky ? 0 : window.scrollY) - (visual ? 0 : (matrix?.m42 ?? 0)),
        path: window.location.pathname,
        at: Date.now(),
        viewport: window.innerWidth,
        ...(region === "left" ? { scrollLeft: node.scrollLeft } : {}),
      };
    },
    [ref, edge, region],
  );
  const updatePosition = useCallback(
    (restored = false) => {
      const node = ref.current;
      const target = measure();
      if (!node || !target) return;
      let from = restored ? null : previous.current;
      const carried = !from;
      if (!from) {
        from = lastPositions.get(region) ?? null;
        try {
          const stored = JSON.parse(
            sessionStorage.getItem(`${STORAGE_KEY}:${region}`) ?? "null",
          ) as Position | null;
          // Another document can update storage while this one is in the
          // back/forward cache; its in-memory position is then older.
          if (stored && (!from || stored.at >= from.at)) from = stored;
        } catch {
          /* Storage is optional. */
        }
        if (from && (!Number.isFinite(from.at) || target.at - from.at > 10000)) from = null;
      }
      // A resize or a rotated phone also re-renders the nav somewhere new, and
      // gliding there from a desktop-width position slid it in from beyond the edge
      // of a phone; a position from another width is never a starting point. Within
      // one page a move is the page's own (Guess Where starting a round swaps in its
      // map chrome); one carried from storage only counts after a navigation.
      if (
        from &&
        (!Number.isFinite(from.x) ||
          !Number.isFinite(from.y) ||
          from.viewport !== target.viewport ||
          (carried && from.path === target.path))
      )
        from = null;
      if (carried && from && region === "left" && Number.isFinite(from.scrollLeft)) {
        node.scrollLeft = from.scrollLeft!;
        continued.current = true;
      }
      previous.current = target;
      if (!from || !node.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
      const dx = from.x - target.x,
        dy = from.y - target.y;
      if (Math.hypot(dx, dy) < 0.5) return;
      animation.current?.cancel();
      if (startFrame.current !== null) cancelAnimationFrame(startFrame.current);
      if (idleStart.current !== null) window.cancelIdleCallback(idleStart.current);
      const motion = node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: 180, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
      );
      // Mount effects and the first layout can occupy the entire duration on
      // Explore. Paint the carried position and let startup work settle before
      // starting its animation clock.
      motion.pause();
      motion.currentTime = 0;
      animation.current = motion;
      const play = () => {
        startFrame.current = requestAnimationFrame(() => {
          startFrame.current = null;
          if (animation.current === motion) motion.play();
        });
      };
      startFrame.current = requestAnimationFrame(() => {
        startFrame.current = null;
        if (typeof window.requestIdleCallback === "function") {
          idleStart.current = window.requestIdleCallback(
            () => {
              idleStart.current = null;
              play();
            },
            { timeout: 1000 },
          );
        } else {
          play();
        }
      });
    },
    [measure, ref, region],
  );
  useLayoutEffect(() => updatePosition());
  useLayoutEffect(() => {
    const save = () => {
      const measured = measure(true) ?? previous.current;
      if (startFrame.current !== null) cancelAnimationFrame(startFrame.current);
      startFrame.current = null;
      if (idleStart.current !== null) window.cancelIdleCallback(idleStart.current);
      idleStart.current = null;
      animation.current?.cancel();
      animation.current = null;
      // Client navigation updates the URL before unmounting the old screen.
      // Keep the path belonging to the measured nav, rather than the new URL.
      const lastPosition = measured
        ? { ...measured, path: previous.current?.path ?? measured.path, at: Date.now() }
        : null;
      try {
        if (lastPosition) {
          lastPositions.set(region, lastPosition);
          sessionStorage.setItem(`${STORAGE_KEY}:${region}`, JSON.stringify(lastPosition));
        }
      } catch {
        /* Storage is optional. */
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) updatePosition(true);
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("pageshow", restore);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
      window.removeEventListener("pageshow", restore);
    };
  }, [measure, region, updatePosition]);
  return continued;
};
