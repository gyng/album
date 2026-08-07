import React from "react";
import { AppLink } from "./platform";
import { OverlayButton } from "./ui";
import {
  type EmbeddingSpaceAtlas,
  type EmbeddingSpaceEntry,
  fetchEmbeddingSpace,
} from "../util/embeddingSpaceData";
import styles from "./ContactSheet.module.css";

/**
 * The whole collection at once, in the order it was taken.
 *
 * The cloud arranges photographs by what they are of; this arranges them by
 * nothing at all, which is the other thing an archive is: a wall of frames you
 * can stand back from or walk up to. Zooming is the whole interaction — far out
 * it is the shape of fifteen years of shooting, close in it is a photograph.
 *
 * Canvas, and the same contact sheet the cloud draws from: fifteen hundred
 * `<img>` elements re-laid-out on every wheel tick is the cost the map already
 * measured and refused, and the sheet is one request for all of them. Cells
 * only fetch their own file once they are drawn larger than the sheet can
 * honestly fill.
 */

/** Cell sizes, in CSS pixels. The far end is the shape; the near end is a photograph. */
const MIN_CELL = 12;
const MAX_CELL = 320;
const INITIAL_CELL = 56;

/** Above this, a sheet cell is being stretched and the real file is worth fetching. */
const FULL_RESOLUTION_CELL = 72;

/** New files started per frame, so a zoom does not fire five hundred requests. */
const LOADS_PER_FRAME = 4;

/** Movement past this, in pixels, makes a press a pan rather than a click. */
const DRAG_SLOP = 5;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The middle of the frame, cropped square, the way a contact sheet crops. */
const drawSquare = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): void => {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    x,
    y,
    size,
    size,
  );
};

export type ContactSheetProps = { className?: string };

export const ContactSheet: React.FC<ContactSheetProps> = ({ className }) => {
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[]>([]);
  const [atlas, setAtlas] = React.useState<EmbeddingSpaceAtlas | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState<EmbeddingSpaceEntry | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  /** Shown as a number so a reader can tell a nudge from nothing happening. */
  const [cellSize, setCellSize] = React.useState(INITIAL_CELL);

  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const cellRef = React.useRef(INITIAL_CELL);
  /** How far the sheet has been scrolled, in pixels of the current cell size. */
  const offsetRef = React.useRef({ x: 0, y: 0 });
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null);
  const travelledRef = React.useRef(0);
  const sheetsRef = React.useRef<HTMLImageElement[]>([]);
  const filesRef = React.useRef(new Map<string, HTMLImageElement>());
  const hitRef = React.useRef<((at: { x: number; y: number }) => number | null) | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSpace()
      .then((space) => {
        if (cancelled) return;
        // Taken order, with the undated left at the end in the order they came:
        // a sheet is a chronology, and a file name is not one.
        setEntries(
          [...space.points].sort(
            (left, right) => (left.taken ?? Infinity) - (right.taken ?? Infinity),
          ),
        );
        setAtlas(space.atlas);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!atlas) return;
    sheetsRef.current = atlas.files.map((file) => {
      const image = new Image();
      image.decoding = "async";
      image.src = file;
      return image;
    });
  }, [atlas]);

  React.useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  /**
   * The wheel zooms about the pointer, so the photograph under it stays under
   * it — the thing a reader is looking at is the thing they are zooming into.
   * Attached by hand because React registers `onWheel` passively, and only
   * taken while there is room to zoom, so the page still scrolls at either end.
   */
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      const next = clamp(cellRef.current * Math.exp(-event.deltaY * 0.0015), MIN_CELL, MAX_CELL);
      if (next === cellRef.current) return;

      const bounds = stage.getBoundingClientRect();
      const at = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const scale = next / cellRef.current;
      offsetRef.current = {
        x: (offsetRef.current.x + at.x) * scale - at.x,
        y: (offsetRef.current.y + at.y) * scale - at.y,
      };
      cellRef.current = next;
      setCellSize(Math.round(next));
      event.preventDefault();
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const fullResolution = React.useCallback((src: string): HTMLImageElement => {
    const held = filesRef.current.get(src);
    if (held) return held;

    const image = new Image();
    image.decoding = "async";
    image.src = src;
    filesRef.current.set(src, image);
    return image;
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || entries.length === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    const draw = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const cell = cellRef.current;
      const columns = Math.max(1, Math.floor(width / cell));
      const rows = Math.ceil(entries.length / columns);
      // Panned no further than the sheet goes: past its end there is nothing to
      // look at, and a reader who overshoots has to find their way back.
      const maxX = Math.max(0, columns * cell - width);
      const maxY = Math.max(0, rows * cell - height);
      offsetRef.current = {
        x: clamp(offsetRef.current.x, 0, maxX),
        y: clamp(offsetRef.current.y, 0, maxY),
      };
      const offset = offsetRef.current;

      const firstRow = Math.max(0, Math.floor(offset.y / cell));
      const lastRow = Math.min(rows - 1, Math.ceil((offset.y + height) / cell));
      const perRow = atlas ? Math.floor(atlas.sheet / atlas.cell) : 0;
      const pointer = pointerRef.current;
      let started = 0;
      let under: number | null = null;

      hitRef.current = (at) => {
        const column = Math.floor((at.x + offset.x) / cell);
        const row = Math.floor((at.y + offset.y) / cell);
        if (column < 0 || column >= columns || row < 0) return null;
        const index = row * columns + column;
        return index >= 0 && index < entries.length ? index : null;
      };

      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const entry = entries[index];
          if (!entry) continue;

          const x = Math.round(column * cell - offset.x);
          const y = Math.round(row * cell - offset.y);
          const size = Math.ceil(cell);

          // Its own colour first, so a cell whose picture has not arrived is
          // still the photograph's own tone rather than a hole.
          context.fillStyle = entry.swatch ?? "#8899aa";
          context.fillRect(x, y, size, size);

          const own = cell >= FULL_RESOLUTION_CELL ? filesRef.current.get(entry.src) : undefined;
          if (own?.complete && own.naturalWidth > 0) {
            drawSquare(context, own, x, y, size);
          } else {
            const sheet =
              atlas && entry.slot !== undefined
                ? sheetsRef.current[Math.floor(entry.slot / atlas.perSheet)]
                : undefined;
            if (sheet?.complete && sheet.naturalWidth > 0 && atlas && entry.slot !== undefined) {
              const within = entry.slot % atlas.perSheet;
              context.drawImage(
                sheet,
                (within % perRow) * atlas.cell,
                Math.floor(within / perRow) * atlas.cell,
                atlas.cell,
                atlas.cell,
                x,
                y,
                size,
                size,
              );
            }
            // Only what is on screen, and only a few per frame: a zoom that
            // fired every visible file at once would ask for a hundred images
            // in one gesture.
            if (cell >= FULL_RESOLUTION_CELL && started < LOADS_PER_FRAME && !own) {
              started += 1;
              fullResolution(entry.src);
            }
          }

          if (
            pointer &&
            pointer.x >= x &&
            pointer.x < x + size &&
            pointer.y >= y &&
            pointer.y < y + size
          ) {
            under = index;
          }
        }
      }

      if (under !== null) {
        const column = under % columns;
        const row = Math.floor(under / columns);
        context.strokeStyle = "rgba(255, 255, 255, 0.95)";
        context.lineWidth = 2;
        context.strokeRect(
          Math.round(column * cell - offset.x) + 1,
          Math.round(row * cell - offset.y) + 1,
          Math.ceil(cell) - 2,
          Math.ceil(cell) - 2,
        );
      }

      const focused = under === null ? null : (entries[under] ?? null);
      setHovered((current) => (current?.src === focused?.src ? current : focused));

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [atlas, entries, fullResolution]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    draggingRef.current = { x: event.clientX, y: event.clientY };
    travelledRef.current = 0;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

    const dragging = draggingRef.current;
    if (!dragging) return;

    travelledRef.current += Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y);
    offsetRef.current = {
      x: offsetRef.current.x - (event.clientX - dragging.x),
      y: offsetRef.current.y - (event.clientY - dragging.y),
    };
    draggingRef.current = { x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const openUnderPointer = () => {
    // A press that travelled is a pan, not a choice.
    if (travelledRef.current > DRAG_SLOP) return;
    const at = pointerRef.current;
    const index = at ? (hitRef.current?.(at) ?? null) : null;
    const entry = index === null ? null : entries[index];
    if (entry) globalThis.location.assign(entry.href);
  };

  // Only a failed payload takes the section away. The stage is rendered while
  // the photographs are still on their way, because the wheel listener is
  // attached to it once on mount: returning nothing until the data arrived left
  // the listener bound to a stage that did not exist yet, and the sheet could
  // not be zoomed at all.
  if (failed) {
    return null;
  }

  return (
    <figure className={[styles.sheet, className].filter(Boolean).join(" ")}>
      <div ref={stageRef} className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            endDrag(event);
            openUnderPointer();
          }}
          onPointerCancel={endDrag}
          onPointerLeave={(event) => {
            endDrag(event);
            pointerRef.current = null;
          }}
        />

        <div className={styles.tools}>
          <OverlayButton
            aria-label="Zoom out"
            onClick={() => {
              cellRef.current = clamp(cellRef.current / 1.6, MIN_CELL, MAX_CELL);
              setCellSize(Math.round(cellRef.current));
            }}
          >
            −
          </OverlayButton>
          <OverlayButton
            aria-label="Zoom in"
            onClick={() => {
              cellRef.current = clamp(cellRef.current * 1.6, MIN_CELL, MAX_CELL);
              setCellSize(Math.round(cellRef.current));
            }}
          >
            +
          </OverlayButton>
          <OverlayButton
            aria-pressed={fullscreen}
            className={fullscreen ? styles.toolActive : ""}
            onClick={() => {
              const stage = stageRef.current;
              if (!stage) return;
              if (document.fullscreenElement === stage) {
                document.exitFullscreen().catch(() => {});
              } else {
                stage.requestFullscreen?.().catch(() => {});
              }
            }}
          >
            {fullscreen ? "Exit" : "Full"}
          </OverlayButton>
        </div>

        {/* What is under the pointer, named where it can be read rather than
            painted into the canvas. */}
        <p className={styles.caption} aria-live="off">
          {hovered ? (
            <>
              <span>{hovered.label}</span>
              {hovered.year ? <span className={styles.captionYear}>{hovered.year}</span> : null}
            </>
          ) : (
            <span className={styles.captionYear}>
              {entries.length.toLocaleString("en")} photographs · {cellSize}px
            </span>
          )}
        </p>

        {/* A canvas has no children, so the photographs in it are offered again
            as an ordinary list — the same answer the cloud and the map's GPU
            pins give. */}
        <ul className={styles.hiddenList}>
          {entries.map((entry) => (
            <li key={entry.src}>
              <AppLink href={entry.href}>{entry.label}</AppLink>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
};

export default ContactSheet;
