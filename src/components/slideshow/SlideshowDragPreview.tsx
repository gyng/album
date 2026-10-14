import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./SlideshowShared.module.css";

/** Which neighbour a drag uncovers. How far it has come up is written by the gesture. */
export type DragPeek = { src: string; direction: number };

/** One reusable, decoded image per neighbour, not a new image on every drag. */
function Preview({
  source,
  direction,
  peek,
  settling,
  cover,
}: {
  source: string | null;
  direction: number;
  peek: DragPeek | undefined;
  settling: boolean;
  cover: boolean;
}) {
  const active = peek?.direction === direction;
  // The outgoing preview must keep its source while the queue advances.
  const src = active ? peek.src : source;
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A completed download (or a 1px preload) does not guarantee a full-size
    // decode. Start this outside the gesture; a failed neighbour is best-effort
    // and must not trigger slideshow navigation or retries.
    const image = ref.current;
    if (src && image?.decode) void image.decode().catch(() => {});
  }, [src]);

  if (!src) return null;
  return (
    <img
      ref={ref}
      className={[styles.dragPeek, cover ? styles.cover : ""].filter(Boolean).join(" ")}
      src={src}
      alt=""
      aria-hidden="true"
      decoding="async"
      data-drag-buffer={direction === 1 ? "next" : "previous"}
      {...(active ? { "data-drag-peek": "true" } : {})}
      data-settling={String(active && settling)}
      style={
        {
          "--drag-peek-direction": direction,
        } as CSSProperties
      }
    />
  );
}

export function SlideshowDragPreview({
  nextSrc,
  previousSrc,
  ...motion
}: {
  nextSrc: string | null;
  previousSrc: string | null;
  peek: DragPeek | undefined;
  settling: boolean;
  cover: boolean;
}) {
  return (
    <>
      <Preview source={nextSrc} direction={1} {...motion} />
      <Preview source={previousSrc} direction={-1} {...motion} />
    </>
  );
}
