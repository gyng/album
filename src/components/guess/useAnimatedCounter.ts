import { type RefCallback, useCallback, useRef } from "react";

/**
 * Imperatively animates a DOM element's textContent from 0 to the target value.
 * Avoids React state entirely so no re-renders are triggered during the count.
 *
 * Returns a ref callback to attach to the element whose textContent should be
 * animated. The `prevTarget` guard means re-renders with an unchanged target do
 * not restart the count, and reduced-motion users jump straight to the final
 * value.
 */
export const useAnimatedCounter = (
  target: number,
  durationMs = 600,
): RefCallback<HTMLElement> => {
  const rafRef = useRef<number>(0);
  const prevTarget = useRef<number | null>(null);

  return useCallback(
    (node: HTMLElement | null) => {
      cancelAnimationFrame(rafRef.current);
      if (!node) return;

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (target === 0 || target === prevTarget.current || prefersReducedMotion) {
        node.textContent = target.toLocaleString();
        prevTarget.current = target;
        return;
      }
      prevTarget.current = target;

      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(eased * target).toLocaleString();
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    },
    [target, durationMs],
  );
};
