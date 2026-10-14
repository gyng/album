import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

type Position = { x: number; y: number; path: string; at: number; viewport: number };
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
      };
    },
    [ref, edge],
  );
  useLayoutEffect(() => {
    const node = ref.current;
    const target = measure();
    if (!node || !target) return;
    let from = previous.current;
    const carried = !from;
    if (!from) {
      from = lastPositions.get(region) ?? null;
      try {
        from ??= JSON.parse(
          sessionStorage.getItem(`${STORAGE_KEY}:${region}`) ?? "null",
        ) as Position | null;
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
    previous.current = target;
    if (!from || !node.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const dx = from.x - target.x,
      dy = from.y - target.y;
    if (Math.hypot(dx, dy) < 0.5) return;
    animation.current?.cancel();
    animation.current = node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 180, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    );
  });
  useLayoutEffect(() => {
    const save = () => {
      const measured = measure(true) ?? previous.current;
      animation.current?.cancel();
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
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [measure, region]);
};
