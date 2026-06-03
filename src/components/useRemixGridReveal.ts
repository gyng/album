import React, { useCallback, useEffect } from "react";

// Tracks when every cell of a remix slide has loaded, so the grid can reveal
// all at once (opacity 0 until ready) rather than letting cells pop in one by
// one. A single (non-remix) slide is always ready. Extracted from the
// slideshow page; the visual fade/backdrop crossfade stays there.
export type UseRemixGridReveal = {
  // Call from each cell's onLoad (and onError, so a broken cell can't pin the
  // grid hidden). Path-keyed so React double-firing a load handler can't
  // inflate the count.
  markRemixCellLoaded: (path: string) => void;
  // True once every cell has loaded — or for a non-remix slide, or after the
  // safety-net timeout.
  isRemixGridReady: boolean;
};

export const useRemixGridReveal = (input: {
  seedPath: string | undefined;
  // The companion photo paths. MUST be referentially stable per layout (memoise
  // at the call site) so the safety-net effect doesn't reset every render.
  companionPaths: string[];
}): UseRemixGridReveal => {
  const { seedPath, companionPaths } = input;

  const remixLoadedPathsRef = React.useRef<Set<string>>(new Set());
  const [remixLoadedCount, setRemixLoadedCount] = React.useState(0);
  const remixLayoutKey = [seedPath ?? "", ...companionPaths].join("|");

  // Layout changed — clear the loaded set so the new grid waits for its own
  // cells before revealing.
  useEffect(() => {
    remixLoadedPathsRef.current = new Set();
    // Reset the counter to match the cleared set on a layout change — an
    // external-state sync, not a derived-state cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemixLoadedCount(0);
  }, [remixLayoutKey]);

  const markRemixCellLoaded = useCallback((path: string) => {
    if (remixLoadedPathsRef.current.has(path)) return;
    remixLoadedPathsRef.current.add(path);
    setRemixLoadedCount(remixLoadedPathsRef.current.size);
  }, []);

  const totalRemixCells = companionPaths.length + 1;
  const isRemixGridReady =
    companionPaths.length === 0 || remixLoadedCount >= totalRemixCells;

  // Safety net: if a cell never fires onLoad (broken file, dropped network,
  // CORS), the grid would stay at opacity 0 indefinitely. After 3s reveal
  // whatever is there. Populates the ref directly so late load handlers no-op.
  useEffect(() => {
    if (companionPaths.length === 0 || !seedPath) return;
    const t = window.setTimeout(() => {
      if (remixLoadedPathsRef.current.size >= totalRemixCells) return;
      const all = new Set<string>([seedPath, ...companionPaths]);
      remixLoadedPathsRef.current = all;
      setRemixLoadedCount(all.size);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [remixLayoutKey, seedPath, companionPaths, totalRemixCells]);

  return { markRemixCellLoaded, isRemixGridReady };
};
