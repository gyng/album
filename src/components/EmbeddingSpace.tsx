import React from "react";
import { AppLink } from "./platform";
import {
  backToFront,
  type Camera,
  pickPoint,
  projectPoint,
  type ProjectedPoint,
} from "../util/embeddingSpace";
import { type EmbeddingSpaceEntry, fetchEmbeddingSpace } from "../util/embeddingSpaceData";
import styles from "./EmbeddingSpace.module.css";

/**
 * The collection as a cloud you can turn around.
 *
 * Each photograph sits where the model thinks it belongs: the three directions
 * this collection varies along most, computed at build time. Nothing here is a
 * chart — the axes have no names and no units. What the shape means is that
 * photographs near each other look and read alike, so the clumps are the
 * collection's own recurring subjects rather than ones anybody chose.
 *
 * Canvas rather than DOM: fifteen hundred elements repositioned every frame is
 * the cost the map already measured and refused, and the whole point of this is
 * that it moves.
 */

export type EmbeddingSpaceProps = {
  className?: string;
  /** Height of the viewer. A cloud wants room; the caller decides how much. */
  height?: number;
};

const INITIAL_CAMERA: Camera = { yaw: 0.7, pitch: 0.22, distance: 2.9 };

/** Radians per second while nobody is holding it. Slow enough to read. */
const DRIFT = 0.11;

const MIN_DISTANCE = 1.4;
const MAX_DISTANCE = 6;
const MAX_PITCH = Math.PI / 2.4;

/** Dot size at the centre of the cloud, in pixels. */
const DOT_RADIUS = 3.4;

/**
 * How many of the nearest photographs are drawn as photographs.
 *
 * Small because the smallest variant this site publishes is 800px and about
 * 100KB: a cloud that drew a hundred of them would cost ten megabytes to look
 * at. The rest are their own dominant colour, which is what the collection
 * looks like from a distance anyway.
 */
const THUMBNAIL_BUDGET = 24;

/** Thumbnail size at the centre of the cloud, in pixels. */
const THUMBNAIL_SIZE = 34;

/** New images started per frame, so a turn does not fire a hundred requests. */
const LOADS_PER_FRAME = 3;

type Placed = ProjectedPoint & { entry: EmbeddingSpaceEntry; index: number };

/**
 * A photograph drawn square without being squashed into square: the middle of
 * the frame, cropped, the way a contact sheet crops.
 */
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
    x - size / 2,
    y - size / 2,
    size,
    size,
  );
};

const radiusOf = (point: Placed, withThumbnail: boolean): number =>
  (withThumbnail ? THUMBNAIL_SIZE / 2 : DOT_RADIUS + 3) * point.scale;

export const EmbeddingSpace: React.FC<EmbeddingSpaceProps> = ({ className, height = 520 }) => {
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState<Placed | null>(null);
  const [drifting, setDrifting] = React.useState(true);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const cameraRef = React.useRef<Camera>({ ...INITIAL_CAMERA });
  const placedRef = React.useRef<Placed[]>([]);
  const thumbnailsRef = React.useRef(new Map<string, HTMLImageElement>());
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null);
  const driftingRef = React.useRef(true);

  driftingRef.current = drifting;

  React.useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSpace()
      .then((points) => {
        if (!cancelled) setEntries(points);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One pass: turn the cloud, project it, draw the far ones first.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entries || entries.length === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
    let previous = 0;

    const draw = (time: number) => {
      const elapsed = previous === 0 ? 0 : Math.min(0.05, (time - previous) / 1000);
      previous = time;

      if (driftingRef.current && !reduced && !draggingRef.current) {
        cameraRef.current.yaw += DRIFT * elapsed;
      }

      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const viewHeight = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(viewHeight * ratio)) {
        canvas.height = Math.round(viewHeight * ratio);
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, viewHeight);

      const viewport = { width, height: viewHeight };
      const placed: Placed[] = [];
      entries.forEach((entry, index) => {
        const projected = projectPoint(entry, cameraRef.current, viewport);
        if (projected) placed.push({ ...projected, entry, index });
      });

      const ordered = backToFront(placed);
      placedRef.current = ordered;

      // The nearest handful become photographs; the rest stay as their own
      // dominant colour, which is what keeps fifteen hundred of them readable.
      const nearest = new Set(
        [...ordered]
          .sort((a, b) => a.depth - b.depth)
          .slice(0, THUMBNAIL_BUDGET)
          .map((point) => point.index),
      );

      let started = 0;
      for (const point of ordered) {
        const wantsThumbnail = nearest.has(point.index);
        const image = thumbnailsRef.current.get(point.entry.src);

        if (wantsThumbnail && !image && started < LOADS_PER_FRAME) {
          started += 1;
          const loading = new Image();
          loading.decoding = "async";
          loading.src = point.entry.src;
          thumbnailsRef.current.set(point.entry.src, loading);
        }

        // Further away is fainter: depth carries the shape of the cloud even
        // where the colours do not.
        context.globalAlpha = Math.max(0.18, Math.min(1, 1.6 / point.depth));

        if (wantsThumbnail && image?.complete && image.naturalWidth > 0) {
          drawSquare(context, image, point.x, point.y, THUMBNAIL_SIZE * point.scale);
        } else {
          context.beginPath();
          context.arc(point.x, point.y, DOT_RADIUS * point.scale, 0, Math.PI * 2);
          context.fillStyle = point.entry.swatch ?? "#8899aa";
          context.fill();
        }
      }

      // Whatever the pointer is over is worth a photograph even when it is deep
      // in the cloud: that is what hovering is for.
      const pointer = pointerRef.current;
      const under = pointer
        ? pickPoint(ordered, pointer, (point) => radiusOf(point, nearest.has(point.index)))
        : null;

      if (under) {
        const size = THUMBNAIL_SIZE * 2.4 * Math.max(0.8, under.scale);
        let image = thumbnailsRef.current.get(under.entry.src);
        if (!image) {
          image = new Image();
          image.decoding = "async";
          image.src = under.entry.src;
          thumbnailsRef.current.set(under.entry.src, image);
        }
        context.globalAlpha = 1;
        context.save();
        context.shadowColor = "rgba(0, 0, 0, 0.45)";
        context.shadowBlur = 18;
        if (image.complete && image.naturalWidth > 0) {
          drawSquare(context, image, under.x, under.y, size);
        } else {
          context.fillStyle = under.entry.swatch ?? "#8899aa";
          context.fillRect(under.x - size / 2, under.y - size / 2, size, size);
        }
        context.restore();
        context.strokeStyle = "rgba(255, 255, 255, 0.9)";
        context.lineWidth = 1.5;
        context.strokeRect(under.x - size / 2, under.y - size / 2, size, size);
      }

      // React state only when the answer changes: this runs sixty times a
      // second, and the label below the cloud is the only thing that needs it.
      setHovered((current) => (current?.index === under?.index ? current : under));

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [entries]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

    const dragging = draggingRef.current;
    if (!dragging) return;

    const camera = cameraRef.current;
    camera.yaw += (event.clientX - dragging.x) * 0.006;
    camera.pitch = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, camera.pitch + (event.clientY - dragging.y) * 0.004),
    );
    draggingRef.current = { x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const camera = cameraRef.current;
    camera.distance = Math.max(
      MIN_DISTANCE,
      Math.min(MAX_DISTANCE, camera.distance + event.deltaY * 0.0015),
    );
  };

  if (failed) {
    return null;
  }

  const count = entries?.length ?? 0;

  return (
    <div className={[styles.space, className].filter(Boolean).join(" ")}>
      <div className={styles.stage} style={{ blockSize: `${height}px` }}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`${count} photographs arranged by what they are of. Drag to turn the cloud.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(event) => {
            pointerRef.current = null;
            endDrag(event);
          }}
          onWheel={onWheel}
          onClick={() => {
            if (hovered) globalThis.location.assign(hovered.entry.href);
          }}
        />

        {count === 0 ? <p className={styles.status}>Arranging the collection…</p> : null}

        {hovered ? (
          <figcaption className={styles.caption}>
            <span className={styles.captionLabel}>
              {hovered.entry.album ?? hovered.entry.label}
            </span>
            {hovered.entry.tag ? (
              <span className={styles.captionTag}>{hovered.entry.tag.replaceAll("_", " ")}</span>
            ) : null}
          </figcaption>
        ) : null}
      </div>

      <div className={styles.controls}>
        <p className={styles.hint}>
          Drag to turn · scroll to move closer · click a photograph to open it
        </p>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setDrifting((current) => !current)}
        >
          {drifting ? "Hold still" : "Turn again"}
        </button>
      </div>

      {/* A canvas has no children, so the photographs in it are unreachable
          without this: the same compensation the map makes for its GPU pins. */}
      <ul className={styles.hiddenList}>
        {(entries ?? []).map((entry) => (
          <li key={entry.href}>
            <AppLink href={entry.href}>{entry.label}</AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default EmbeddingSpace;
