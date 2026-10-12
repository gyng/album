import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

type Position = { x: number; y: number; path: string; at: number };
const STORAGE_KEY = "gallery-nav-position";
let lastPosition: Position | null = null;

// Animate the measured position rather than the page padding: both the map's
// fixed chrome and the ordinary page shell can participate in the same move.
export const useNavPositionMotion = (ref: RefObject<HTMLElement | null>) => {
  const previous = useRef<Position | null>(null);
  const animation = useRef<Animation | null>(null);
  const measure = useCallback((): Position | null => {
    const node = ref.current;
    if (!node) return null;
    const rect = (node.querySelector("ul") ?? node).getBoundingClientRect();
    const transform = getComputedStyle(node).transform;
    const matrix =
      transform !== "none" && typeof DOMMatrixReadOnly !== "undefined"
        ? new DOMMatrixReadOnly(transform)
        : null;
    return {
      x: rect.x + window.scrollX - (matrix?.m41 ?? 0),
      y: rect.y + window.scrollY - (matrix?.m42 ?? 0),
      path: window.location.pathname,
      at: Date.now(),
    };
  }, [ref]);
  useLayoutEffect(() => {
    const node = ref.current;
    const target = measure();
    if (!node || !target) return;
    let from = previous.current;
    if (!from) {
      from = lastPosition;
      try {
        from ??= JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Position | null;
      } catch {
        /* Storage is optional. */
      }
      if (
        from &&
        (!Number.isFinite(from.x) ||
          !Number.isFinite(from.y) ||
          !Number.isFinite(from.at) ||
          from.path === target.path ||
          target.at - from.at > 10000)
      )
        from = null;
    }
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
      animation.current?.cancel();
      const measured = measure() ?? previous.current;
      // Client navigation updates the URL before unmounting the old screen.
      // Keep the path belonging to the measured nav, rather than the new URL.
      lastPosition = measured
        ? { ...measured, path: previous.current?.path ?? measured.path, at: Date.now() }
        : null;
      try {
        if (lastPosition) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lastPosition));
      } catch {
        /* Storage is optional. */
      }
    };
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [measure]);
};
