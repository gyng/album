import { useEffect, useRef } from "react";

/** Marks what J/K and ←/→ step between: each photograph and clip, then the album's end. */
export const ALBUM_STEP_ATTRIBUTE = "data-album-step";

const DIRECTIONS: Record<string, 1 | -1> = { j: 1, ArrowRight: 1, k: -1, ArrowLeft: -1 };
// A smooth scroll is still travelling for about this long; a key pressed meanwhile
// steps on from where it is going, not from where it has got to.
const IN_FLIGHT_MS = 700;

/**
 * Which stop to go to, given each stop's distance from where a scroll would
 * leave it (negative: above). Next is the first still below; previous the last
 * already above, so pressing it partway through a photograph goes back to its
 * start. Null when there is nowhere further to go.
 */
export const pickStep = (offsets: readonly number[], direction: 1 | -1): number | null => {
  if (direction === 1) {
    const index = offsets.findIndex((offset) => offset > 1);
    return index < 0 ? null : index;
  }
  for (let index = offsets.length - 1; index >= 0; index--) if (offsets[index]! < -1) return index;
  return null;
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest("input, textarea, select")));

// Arrows belong to whatever has focus — a video's seek bar, a map, a slider. J and K
// mean nothing to those, so they step from anywhere except a text field.
const arrowsClaimed = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target !== document.body &&
  target !== document.documentElement &&
  !target.matches("a, button, summary");

/** J/→ and K/← scroll an album a photograph at a time. */
export const useAlbumStepping = () => {
  const last = useRef<{ index: number; at: number } | null>(null);
  useEffect(() => {
    const step = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key];
      if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
        return;
      if (typing(event.target)) return;
      if (event.key.startsWith("Arrow") && arrowsClaimed(event.target)) return;
      const stops = [...document.querySelectorAll<HTMLElement>(`[${ALBUM_STEP_ATTRIBUTE}]`)];
      if (!stops.length) return;
      const recent = last.current && performance.now() - last.current.at < IN_FLIGHT_MS;
      const index = recent
        ? Math.min(stops.length - 1, Math.max(0, last.current!.index + direction))
        : pickStep(
            stops.map(
              (stop) =>
                stop.getBoundingClientRect().top -
                (Number.parseFloat(getComputedStyle(stop).scrollMarginBlockStart) || 0),
            ),
            direction,
          );
      if (index === null || (recent && index === last.current!.index)) return;
      event.preventDefault();
      last.current = { index, at: performance.now() };
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      stops[index]!.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, []);
};
