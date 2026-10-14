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
 * already above, so pressing it with a photograph off centre centres it first.
 * Null when there is nowhere further to go.
 */
export const pickStep = (offsets: readonly number[], direction: 1 | -1): number | null => {
  if (direction === 1) {
    const index = offsets.findIndex((offset) => offset > 1);
    return index < 0 ? null : index;
  }
  for (let index = offsets.length - 1; index >= 0; index--) if (offsets[index]! < -1) return index;
  return null;
};

/**
 * How far a photograph's centre sits from the middle of the visible area —
 * the viewport below `inset`, the sticky chrome that covers its top. Zero when
 * the photograph is centred; negative above.
 */
export const centreOffset = (
  rect: { top: number; height: number },
  inset: number,
  viewportHeight: number,
): number => rect.top + rect.height / 2 - (inset + (viewportHeight - inset) / 2);

// What to centre: a block's photograph or clip itself, not the block around it,
// whose details band on a phone sits above the picture. The album's end is
// centred whole.
const subjectOf = (stop: HTMLElement): HTMLElement =>
  (stop.localName === "nav" ? null : stop.querySelector<HTMLElement>("img, video")) ?? stop;

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

/** J/→ and K/← scroll an album a photograph at a time, centring each one. */
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
      // Centred in the whole window. The phone's sticky album nav slides away
      // as the page scrolls down, so it is no fixed inset; and a centred
      // photograph clears it anyway.
      const offsetOf = (stop: HTMLElement) =>
        centreOffset(subjectOf(stop).getBoundingClientRect(), 0, window.innerHeight);
      const index = recent
        ? Math.min(stops.length - 1, Math.max(0, last.current!.index + direction))
        : pickStep(stops.map(offsetOf), direction);
      if (index === null || (recent && index === last.current!.index)) return;
      event.preventDefault();
      last.current = { index, at: performance.now() };
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: window.scrollY + offsetOf(stops[index]!),
        behavior: reduced ? "auto" : "smooth",
      });
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, []);
};
