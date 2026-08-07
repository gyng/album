import React from "react";
import { AppLink } from "./platform";
import { OverlayButton } from "./ui";
import {
  type EmbeddingSpaceAtlas,
  type EmbeddingSpaceEntry,
  fetchEmbeddingSpace,
} from "../util/embeddingSpaceData";
import { justifiedRows, type JustifiedLayout } from "../util/justifiedRows";
import styles from "./ContactSheet.module.css";

/**
 * The whole collection at once, in the order it was taken.
 *
 * The cloud arranges photographs by what they are of; this arranges them by
 * nothing at all, which is the other thing an archive is: a wall of frames you
 * can stand back from or walk up to. Zooming is the whole interaction — far out
 * it is the shape of fifteen years of shooting, close in it is a photograph.
 *
 * Canvas, and the cloud's own contact sheet, because fifteen hundred `<img>`
 * elements re-laid-out on every wheel tick is the cost the map already measured
 * and refused.
 */

/** Row heights, in CSS pixels. The far end is the shape; the near end is a photograph. */
const MIN_ROW = 24;
const MAX_ROW = 460;
const INITIAL_ROW = 96;
const ROW_GAP = 2;

/** Above this, a 48px sheet cell is being stretched and the real file is worth fetching. */
const FULL_RESOLUTION_ROW = 84;

/** New files started per frame, so a zoom does not fire five hundred requests. */
const LOADS_PER_FRAME = 4;

/** Movement past this, in pixels, makes a press a pan rather than a click. */
const DRAG_SLOP = 5;

/**
 * How much of the remaining distance to the zoom's target is left after a
 * second. A wheel tick sets the target and the sheet travels to it, so a
 * gesture reads as one movement rather than a series of jumps.
 */
const ZOOM_REMAINING_PER_SECOND = 0.00001;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * A photograph drawn to fill its box, cropped rather than squashed.
 *
 * The source may itself be a square cell of the contact sheet, in which case
 * this crops that square — a crop of a crop, which at a thumbnail's size reads
 * as the same photograph and at any larger size has been replaced by the file.
 */
const drawCover = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): void => {
  const scale = Math.max(box.width / source.width, box.height / source.height);
  const takeWidth = Math.min(source.width, box.width / scale);
  const takeHeight = Math.min(source.height, box.height / scale);

  context.drawImage(
    image,
    source.x + (source.width - takeWidth) / 2,
    source.y + (source.height - takeHeight) / 2,
    takeWidth,
    takeHeight,
    box.x,
    box.y,
    box.width,
    box.height,
  );
};

export type ContactSheetProps = { className?: string };

export const ContactSheet: React.FC<ContactSheetProps> = ({ className }) => {
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[]>([]);
  const [atlas, setAtlas] = React.useState<EmbeddingSpaceAtlas | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState<{
    entry: EmbeddingSpaceEntry;
    x: number;
    y: number;
  } | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [rowHeight, setRowHeight] = React.useState(INITIAL_ROW);

  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  /** Where the zoom is, and where it is going. The gap between them is the animation. */
  const heightRef = React.useRef(INITIAL_ROW);
  const targetRef = React.useRef(INITIAL_ROW);
  const offsetRef = React.useRef(0);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null);
  const travelledRef = React.useRef(0);
  const sheetsRef = React.useRef<HTMLImageElement[]>([]);
  const filesRef = React.useRef(new Map<string, HTMLImageElement>());
  /**
   * Each photograph resampled once at the size it is drawn, rather than on
   * every frame.
   *
   * A four-thousand-pixel file scaled into a two-hundred-pixel box is a full
   * resample, and sixty of those a second is where the lag was. Keyed by the
   * power-of-two size bucket, so a zoom re-cuts each photograph a few times
   * rather than continuously.
   */
  const scaledRef = React.useRef(new Map<string, { bucket: number; canvas: HTMLCanvasElement }>());
  const layoutRef = React.useRef<JustifiedLayout>({ items: [], rows: [], total: 0 });
  /**
   * Whether anything has changed since the last frame.
   *
   * A sheet nobody is touching redrew sixty times a second for nothing. Every
   * gesture, arriving image and resize raises this; the loop does nothing
   * otherwise, which is the difference between a warm laptop and a cold one.
   */
  const dirtyRef = React.useRef(true);

  const invalidate = React.useCallback(() => {
    dirtyRef.current = true;
  }, []);

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
        invalidate();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invalidate]);

  React.useEffect(() => {
    if (!atlas) return;
    sheetsRef.current = atlas.files.map((file) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", invalidate);
      image.src = file;
      return image;
    });
  }, [atlas, invalidate]);

  React.useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
      invalidate();
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("resize", invalidate);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("resize", invalidate);
    };
  }, [invalidate]);

  const zoomTo = React.useCallback(
    (next: number, at?: { x: number; y: number }) => {
      const target = clamp(next, MIN_ROW, MAX_ROW);
      if (target === targetRef.current) return;

      // Zooming about a point keeps what is under it under it. Measured against
      // the target rather than the current height, so a second tick mid-flight
      // is measured from where the sheet is going.
      const anchor = at?.y ?? (stageRef.current?.clientHeight ?? 0) / 2;
      const scale = target / targetRef.current;
      offsetRef.current = (offsetRef.current + anchor) * scale - anchor;
      targetRef.current = target;
      setRowHeight(Math.round(target));
      invalidate();
    },
    [invalidate],
  );

  /**
   * Attached by hand because React registers `onWheel` passively, so it cannot
   * take the gesture from the page — and only taken while there is room to
   * zoom, so at either limit the page scrolls again.
   */
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      const next = clamp(targetRef.current * Math.exp(-event.deltaY * 0.0015), MIN_ROW, MAX_ROW);
      if (next === targetRef.current) return;

      const bounds = stage.getBoundingClientRect();
      zoomTo(next, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      event.preventDefault();
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const fullResolution = React.useCallback(
    (src: string): HTMLImageElement => {
      const held = filesRef.current.get(src);
      if (held) return held;

      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", invalidate);
      image.src = src;
      filesRef.current.set(src, image);
      return image;
    },
    [invalidate],
  );

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const elapsed = Math.min(0.05, (now - last) / 1000);
      last = now;

      // The zoom travels towards its target; while it travels, every frame is a
      // change.
      const distance = targetRef.current - heightRef.current;
      if (Math.abs(distance) > 0.05) {
        heightRef.current += distance * (1 - ZOOM_REMAINING_PER_SECOND ** elapsed);
        dirtyRef.current = true;
      } else if (heightRef.current !== targetRef.current) {
        heightRef.current = targetRef.current;
        dirtyRef.current = true;
      }

      if (!dirtyRef.current || entries.length === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      dirtyRef.current = false;

      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const row = heightRef.current;
      const layout = justifiedRows(
        entries.map((entry) => entry.aspect ?? 1.5),
        width,
        row,
        ROW_GAP,
      );
      layoutRef.current = layout;

      // Scrolled no further than the sheet goes: past its end there is nothing
      // to look at, and a reader who overshoots has to find the way back.
      offsetRef.current = clamp(offsetRef.current, 0, Math.max(0, layout.total - height));
      const offset = offsetRef.current;
      const perRow = atlas ? Math.floor(atlas.sheet / atlas.cell) : 0;
      const pointer = pointerRef.current;
      let started = 0;
      let under: { entry: EmbeddingSpaceEntry; x: number; y: number } | null = null;

      for (const band of layout.rows) {
        if (band.top + band.height < offset || band.top > offset + height) continue;

        for (let index = band.from; index < band.to; index += 1) {
          const item = layout.items[index];
          const entry = item ? entries[item.index] : undefined;
          if (!item || !entry) continue;

          const box = {
            x: Math.round(item.x),
            y: Math.round(item.y - offset),
            width: Math.ceil(item.width),
            height: Math.ceil(item.height),
          };

          // Its own colour first, so a frame whose picture has not arrived is
          // still the photograph's own tone rather than a hole.
          context.fillStyle = entry.swatch ?? "#8899aa";
          context.fillRect(box.x, box.y, box.width, box.height);

          const wantsFile = row >= FULL_RESOLUTION_ROW;
          const own = wantsFile ? filesRef.current.get(entry.src) : undefined;
          if (own?.complete && own.naturalWidth > 0) {
            const bucket = 2 ** Math.ceil(Math.log2(Math.max(1, box.width)));
            const held = scaledRef.current.get(entry.src);
            let scaled = held?.bucket === bucket ? held.canvas : undefined;
            if (!scaled) {
              const cut = document.createElement("canvas");
              const cutHeight = Math.max(1, Math.round((bucket * box.height) / box.width));
              cut.width = bucket;
              cut.height = cutHeight;
              const into = cut.getContext("2d");
              if (into) {
                drawCover(
                  into,
                  own,
                  { x: 0, y: 0, width: own.naturalWidth, height: own.naturalHeight },
                  { x: 0, y: 0, width: bucket, height: cutHeight },
                );
                scaledRef.current.set(entry.src, { bucket, canvas: cut });
                scaled = cut;
              }
            }
            if (scaled) context.drawImage(scaled, box.x, box.y, box.width, box.height);
          } else {
            const sheet =
              atlas && entry.slot !== undefined
                ? sheetsRef.current[Math.floor(entry.slot / atlas.perSheet)]
                : undefined;
            if (sheet?.complete && sheet.naturalWidth > 0 && atlas && entry.slot !== undefined) {
              const within = entry.slot % atlas.perSheet;
              drawCover(
                context,
                sheet,
                {
                  x: (within % perRow) * atlas.cell,
                  y: Math.floor(within / perRow) * atlas.cell,
                  width: atlas.cell,
                  height: atlas.cell,
                },
                box,
              );
            }
            // Only what is on screen, and only a few per frame: a zoom that
            // fired every visible file at once would ask for a hundred images
            // in one gesture.
            if (wantsFile && started < LOADS_PER_FRAME && !own) {
              started += 1;
              fullResolution(entry.src);
            }
          }

          if (
            pointer &&
            pointer.x >= box.x &&
            pointer.x < box.x + box.width &&
            pointer.y >= box.y &&
            pointer.y < box.y + box.height
          ) {
            under = { entry, x: box.x + box.width / 2, y: box.y };
            context.strokeStyle = "rgba(255, 255, 255, 0.95)";
            context.lineWidth = 2;
            context.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
          }
        }
      }

      setHovered((current) =>
        current?.entry.src === under?.entry.src && current?.x === under?.x ? current : under,
      );

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [atlas, entries, fullResolution]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const entryUnder = (point: { x: number; y: number }): EmbeddingSpaceEntry | null => {
    const offset = offsetRef.current;
    const item = layoutRef.current.items.find(
      (candidate) =>
        point.x >= candidate.x &&
        point.x < candidate.x + candidate.width &&
        point.y >= candidate.y - offset &&
        point.y < candidate.y - offset + candidate.height,
    );
    return item ? (entries[item.index] ?? null) : null;
  };

  return failed ? null : (
    <figure className={[styles.sheet, className].filter(Boolean).join(" ")}>
      <div ref={stageRef} className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pointerRef.current = at(event);
            draggingRef.current = { x: event.clientX, y: event.clientY };
            travelledRef.current = 0;
          }}
          onPointerMove={(event) => {
            pointerRef.current = at(event);
            invalidate();

            const dragging = draggingRef.current;
            if (!dragging) return;

            travelledRef.current += Math.hypot(
              event.clientX - dragging.x,
              event.clientY - dragging.y,
            );
            offsetRef.current -= event.clientY - dragging.y;
            draggingRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            draggingRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            // A press that travelled is a pan, not a choice.
            if (travelledRef.current > DRAG_SLOP) return;
            const entry = entryUnder(at(event));
            if (entry) globalThis.location.assign(entry.href);
          }}
          onPointerCancel={(event) => {
            draggingRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerLeave={() => {
            draggingRef.current = null;
            pointerRef.current = null;
            invalidate();
          }}
        />

        <div className={styles.tools}>
          <OverlayButton aria-label="Zoom out" onClick={() => zoomTo(targetRef.current / 1.8)}>
            −
          </OverlayButton>
          <OverlayButton aria-label="Zoom in" onClick={() => zoomTo(targetRef.current * 1.8)}>
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

        {/* Above the frame it belongs to rather than in a corner: at this
            density a caption anywhere else is a caption for the whole wall. */}
        {hovered ? (
          <p
            className={styles.tooltip}
            aria-hidden="true"
            style={{ insetInlineStart: `${hovered.x}px`, insetBlockStart: `${hovered.y}px` }}
          >
            <span>{hovered.entry.label}</span>
            {hovered.entry.year ? (
              <span className={styles.tooltipYear}>{hovered.entry.year}</span>
            ) : null}
          </p>
        ) : null}

        <p className={styles.caption}>
          <span className={styles.captionYear}>
            {entries.length.toLocaleString("en")} photographs · {rowHeight}px rows
          </span>
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
