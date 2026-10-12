import { useEffect, useRef, useState } from "react";

// Count complete rows from a minimum tile width or an already-rendered fixed tile.
export const usePhotoRowCapacity = (minimumTileWidth: number | "rendered", fallback: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (!element.clientWidth) return;
      const tileWidth =
        minimumTileWidth === "rendered"
          ? (element.firstElementChild?.getBoundingClientRect().width ?? 0)
          : minimumTileWidth;
      if (tileWidth <= 0) return;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      setCapacity(Math.max(1, Math.floor((element.clientWidth + gap) / (tileWidth + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minimumTileWidth]);
  return { ref, capacity };
};
