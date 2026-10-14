import { useEffect, useRef, useState } from "react";

type Props = { src: string; blocks: number; label: string; className?: string | undefined };

/**
 * A photograph reduced to `blocks` squares across. Drawn into a canvas that small and
 * scaled up without smoothing: unlike a blur, coarse blocks keep no outline to read.
 */
export const PixelatedPhoto = ({ src, blocks, label, className }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null);
  // A new source shows nothing until its own image has loaded.
  const image = loaded?.src === src ? loaded.image : null;
  useEffect(() => {
    let live = true;
    const next = new Image();
    next.onload = () => {
      if (live) setLoaded({ src, image: next });
    };
    next.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  const rows = Math.max(
    1,
    Math.round(blocks * (image ? image.naturalHeight / image.naturalWidth : 2 / 3)),
  );
  useEffect(() => {
    const context = image ? canvasRef.current?.getContext("2d") : null;
    if (!image || !context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, blocks, rows);
  }, [image, blocks, rows]);
  return (
    <canvas
      ref={canvasRef}
      width={blocks}
      height={rows}
      role="img"
      aria-label={label}
      data-photo={src}
      {...(className ? { className } : {})}
    />
  );
};
