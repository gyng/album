import { useEffect, useRef, useState } from "react";

// Keep one complete row on first display, then reveal another row per press.
export const usePhotoRowCapacity = (minimumTileWidth: number, fallback: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (!element.clientWidth) return;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      setCapacity(Math.max(1, Math.floor((element.clientWidth + gap) / (minimumTileWidth + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minimumTileWidth]);
  return { ref, capacity };
};
