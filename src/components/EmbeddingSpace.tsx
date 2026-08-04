import React from "react";
import { AppLink } from "./platform";
import { Caption, OverlayButton, pillStyles } from "./ui";
import { useActiveTheme } from "./useActiveTheme";
import {
  backToFront,
  type Camera,
  distinctiveTag,
  isInsidePolygon,
  pickPoint,
  projectPoint,
  type ProjectedPoint,
  type ScreenPosition,
} from "../util/embeddingSpace";
import { buildSearchHref, buildSimilaritySearchHref } from "../util/searchFacets";
import {
  type EmbeddingSpaceAtlas,
  type EmbeddingSpaceCluster,
  type EmbeddingSpaceEntry,
  fetchEmbeddingSpace,
  indexedPathFromSrc,
} from "../util/embeddingSpaceData";
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

const INITIAL_CAMERA: Camera = { yaw: 0.7, pitch: 0.22, distance: 3.8 };

/** Radians per second while nobody is holding it. Slow enough to read. */
const DRIFT = 0.11;

const MIN_DISTANCE = 1.4;
const MAX_DISTANCE = 6;
const MAX_PITCH = Math.PI / 2.4;

/** Dot size at the centre of the cloud, in pixels. */
const DOT_RADIUS = 3.4;

/**
 * How many of the nearest photographs are drawn from their own file when there
 * is no contact sheet.
 *
 * Small because the smallest variant this site publishes is 800px and about
 * 100KB: a cloud that drew a hundred of them that way would cost ten megabytes
 * to look at. With a sheet — the normal case — every photograph is a
 * photograph and this does not apply.
 */
const THUMBNAIL_BUDGET = 24;

/**
 * How many are drawn as photographs when there *is* a sheet.
 *
 * Not all of them, even though the sheet makes that free: fifteen hundred
 * thumbnails at any legible size cover the view completely and the cloud stops
 * having a shape. The nearest few hundred are photographs and everything behind
 * them is its own dominant colour, which is also the depth cue — a photograph
 * is near, a dot is far.
 */
const ATLAS_THUMBNAIL_BUDGET = 420;

/**
 * Thumbnail size at the centre of the cloud, in pixels.
 *
 * Deliberately smaller than it could be: at forty pixels fifteen hundred
 * photographs close up into a mosaic and the shape of the cloud — which is the
 * only thing it has to say — disappears behind them.
 */
const THUMBNAIL_SIZE = 22;

/** New images started per frame, so a turn does not fire a hundred requests. */
const LOADS_PER_FRAME = 3;

/**
 * The web between photographs the model reads as alike.
 *
 * Faint, and drawn only where both ends are in the front of the cloud: every
 * edge everywhere is a fog that hides the thing it describes, and an edge whose
 * far end is behind three hundred photographs explains nothing. Under the
 * pointer the same relationships come up bright, which is when a line is
 * actually being read.
 */
const WEB_ALPHA = 0.16;
const WEB_HOVER_ALPHA = 0.85;

/**
 * How far apart two photographs may be, in the cloud's own units, before the
 * ambient web stops joining them.
 *
 * Some of a photograph's nearest kin land a long way off once 768 dimensions
 * are squeezed into three — that is the projection's fault, and it is worth
 * knowing, but as a permanent line across the whole view it is a stray thread.
 * So the quiet web shows local texture and the long relationships appear under
 * the pointer, where they are being read rather than merely seen.
 */
const WEB_MAX_SPAN = 0.42;

/**
 * How far the rest of the cloud recedes while a photograph is under the
 * pointer.
 *
 * A focus pull rather than a highlight: making one photograph brighter inside a
 * dense cloud barely reads, and fading it *out* with distance would hide the
 * thing being pointed at. Washing everything else back towards the page's own
 * background leaves the photograph and its kin standing in front of it, which is
 * what a lens does and what the eye already understands.
 */
const FOCUS_WASH = 0.66;

/** Below this many pointer positions, a ring is a click that wobbled. */
const MIN_LASSO_POINTS = 6;

/** How many of a selection's tags are worth naming. */
const SELECTION_TAGS = 3;

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

const radiusOf = (point: Placed, withThumbnail: boolean, thumbnail: number): number =>
  (withThumbnail ? thumbnail / 2 : DOT_RADIUS + 3) * point.scale;

export const EmbeddingSpace: React.FC<EmbeddingSpaceProps> = ({ className, height = 520 }) => {
  // The wash has to be the page's own ground, and the reader can change it
  // without reloading.
  const theme = useActiveTheme();
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [atlas, setAtlas] = React.useState<EmbeddingSpaceAtlas | null>(null);
  const [clusters, setClusters] = React.useState<EmbeddingSpaceCluster[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState<Placed | null>(null);
  const [drifting, setDrifting] = React.useState(true);
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<EmbeddingSpaceEntry[]>([]);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const cameraRef = React.useRef<Camera>({ ...INITIAL_CAMERA });
  const placedRef = React.useRef<Placed[]>([]);
  const thumbnailsRef = React.useRef(new Map<string, HTMLImageElement>());
  const sheetsRef = React.useRef<HTMLImageElement[]>([]);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null);
  const selectingRef = React.useRef(false);
  const lassoRef = React.useRef<ScreenPosition[]>([]);
  const selectedRef = React.useRef<Set<number>>(new Set());
  const driftingRef = React.useRef(true);

  driftingRef.current = drifting;
  selectingRef.current = selecting;

  React.useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSpace()
      .then((space) => {
        if (cancelled) return;
        setEntries(space.points);
        setAtlas(space.atlas);
        setClusters(space.clusters);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The sheets, fetched once. Every photograph in the cloud is a cell of one.
  React.useEffect(() => {
    if (!atlas) return;

    sheetsRef.current = atlas.files.map((file) => {
      const sheet = new Image();
      sheet.decoding = "async";
      sheet.src = file;
      return sheet;
    });
  }, [atlas]);

  // One pass: turn the cloud, project it, draw the far ones first.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entries || entries.length === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The ground the cloud is drawn on, read back from the stage rather than
    // from a token: `--c-bg` is `light-dark(...)`, which a canvas cannot parse,
    // and an unparsable `fillStyle` is silently ignored — the wash came out in
    // whatever colour had been used last, which was a photograph's.
    const stage = canvas.parentElement;
    const stageBackground = stage ? getComputedStyle(stage).backgroundColor : "";
    const wash =
      stageBackground && stageBackground !== "rgba(0, 0, 0, 0)" ? stageBackground : "#111";

    let frame = 0;
    let previous = 0;

    const draw = (time: number) => {
      const elapsed = previous === 0 ? 0 : Math.min(0.05, (time - previous) / 1000);
      previous = time;

      // Not while a ring is being drawn: a cloud that turns under the pointer
      // catches whatever drifted into the loop rather than what was aimed at.
      if (driftingRef.current && !reduced && !draggingRef.current && !selectingRef.current) {
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

      // On a phone the canvas is a third of the area it is on a laptop, and a
      // thumbnail that stays 22px there closes the cloud into a mosaic again.
      // Everything drawn scales with the room there is to draw it in.
      const room = Math.min(1, Math.min(width, viewHeight) / 460);
      const thumbnail = THUMBNAIL_SIZE * (0.62 + room * 0.38);

      const camera = cameraRef.current;
      const placed: Placed[] = [];
      entries.forEach((entry, index) => {
        const projected = projectPoint(entry, camera, viewport);
        if (projected) placed.push({ ...projected, entry, index });
      });

      const ordered = backToFront(placed);
      placedRef.current = ordered;

      // The nearest handful become photographs; the rest stay as their own
      // dominant colour, which is what keeps fifteen hundred of them readable.
      const nearest = new Set(
        [...ordered]
          .sort((a, b) => a.depth - b.depth)
          .slice(
            0,
            atlas ? Math.round(ATLAS_THUMBNAIL_BUDGET * (0.35 + room * 0.65)) : THUMBNAIL_BUDGET,
          )
          .map((point) => point.index),
      );

      const perRow = atlas ? Math.floor(atlas.sheet / atlas.cell) : 0;

      // The web first, so every photograph sits on top of its own lines.
      const onScreen = new Map(ordered.map((point) => [point.index, point]));
      context.globalAlpha = 1;
      context.strokeStyle = "rgba(255, 255, 255, 1)";
      context.lineWidth = 0.6;
      context.beginPath();
      for (const point of ordered) {
        if (!nearest.has(point.index)) continue;
        for (const neighbour of point.entry.near ?? []) {
          // Once per pair, and only between two photographs a reader can see.
          if (neighbour <= point.index || !nearest.has(neighbour)) continue;
          const other = onScreen.get(neighbour);
          if (!other) continue;
          const span = Math.hypot(
            point.entry.x - other.entry.x,
            point.entry.y - other.entry.y,
            point.entry.z - other.entry.z,
          );
          if (span > WEB_MAX_SPAN) continue;
          context.moveTo(point.x, point.y);
          context.lineTo(other.x, other.y);
        }
      }
      context.globalAlpha = WEB_ALPHA;
      context.stroke();

      let started = 0;
      for (const point of ordered) {
        const wantsThumbnail = nearest.has(point.index);
        const image = thumbnailsRef.current.get(point.entry.src);

        if (!atlas && wantsThumbnail && !image && started < LOADS_PER_FRAME) {
          started += 1;
          const loading = new Image();
          loading.decoding = "async";
          loading.src = point.entry.src;
          thumbnailsRef.current.set(point.entry.src, loading);
        }

        // Further away is fainter, and the far field is *much* fainter than a
        // linear fade would make it: a thousand translucent dots behind each
        // other stack into a haze, and the haze is what buries the cloud's
        // shape. Squaring the falloff keeps the front legible and lets the back
        // recede into the ground instead of milking it up.
        const fade = Math.min(1, 1.7 / point.depth);
        context.globalAlpha = Math.max(0.08, fade * fade);

        const cell =
          atlas && wantsThumbnail && point.entry.slot !== undefined
            ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
            : undefined;

        if (cell?.complete && cell.naturalWidth > 0 && atlas && point.entry.slot !== undefined) {
          const within = point.entry.slot % atlas.perSheet;
          const size = thumbnail * point.scale;
          context.drawImage(
            cell,
            (within % perRow) * atlas.cell,
            Math.floor(within / perRow) * atlas.cell,
            atlas.cell,
            atlas.cell,
            point.x - size / 2,
            point.y - size / 2,
            size,
            size,
          );
          // A hairline of the ground between frames, or a dense pose reads as
          // one mosaic rather than as many photographs.
          context.strokeStyle = "rgba(0, 0, 0, 0.55)";
          context.lineWidth = 0.75;
          context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
        } else if (wantsThumbnail && image?.complete && image.naturalWidth > 0) {
          drawSquare(context, image, point.x, point.y, thumbnail * point.scale);
        } else {
          context.beginPath();
          context.arc(point.x, point.y, DOT_RADIUS * point.scale, 0, Math.PI * 2);
          context.fillStyle = point.entry.swatch ?? "#8899aa";
          context.fill();
        }
      }

      // What each clump turned out to be about, written where it is. Drawn
      // after the photographs so the words are legible, and dropped entirely
      // while the reader is looking at one photograph — a legend is for reading
      // the whole, and this is the moment they stopped.
      // Every clump is named where there is room for eight names; a phone gets
      // the biggest few, which is a legend rather than a wall of words.
      const labels = [...clusters]
        .sort((a, b) => b.count - a.count)
        .slice(0, room < 0.8 ? 4 : clusters.length)
        .map((cluster) => ({ cluster, at: projectPoint(cluster, camera, viewport) }))
        .filter((entry): entry is { cluster: EmbeddingSpaceCluster; at: ProjectedPoint } =>
          Boolean(entry.at),
        );

      // Whatever the pointer is over is worth a photograph even when it is deep
      // in the cloud: that is what hovering is for. Not while a ring is being
      // drawn, though — then the pointer is describing a group, not asking
      // about one photograph.
      const pointer = selectingRef.current ? null : pointerRef.current;
      const under = pointer
        ? pickPoint(ordered, pointer, (point) =>
            radiusOf(point, nearest.has(point.index), thumbnail),
          )
        : null;

      // A selection puts the same lens on a group: everything outside the ring
      // goes back into the page and what was caught stays where it was.
      if (selectedRef.current.size > 0) {
        context.globalAlpha = FOCUS_WASH;
        context.fillStyle = wash;
        context.fillRect(0, 0, width, viewHeight);

        context.globalAlpha = 1;
        for (const point of ordered) {
          if (!selectedRef.current.has(point.index)) continue;
          const size = thumbnail * 1.2 * Math.max(0.7, point.scale);
          const sheet =
            atlas && point.entry.slot !== undefined
              ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
              : undefined;

          if (
            sheet?.complete &&
            sheet.naturalWidth > 0 &&
            atlas &&
            point.entry.slot !== undefined
          ) {
            const within = point.entry.slot % atlas.perSheet;
            context.drawImage(
              sheet,
              (within % perRow) * atlas.cell,
              Math.floor(within / perRow) * atlas.cell,
              atlas.cell,
              atlas.cell,
              point.x - size / 2,
              point.y - size / 2,
              size,
              size,
            );
          } else {
            context.fillStyle = point.entry.swatch ?? "#8899aa";
            context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
          }
        }
      }

      // The ring itself, while it is being drawn.
      if (lassoRef.current.length > 1) {
        context.globalAlpha = 1;
        context.strokeStyle = "rgba(255, 255, 255, 0.9)";
        context.lineWidth = 1.5;
        context.setLineDash([6, 4]);
        context.beginPath();
        lassoRef.current.forEach((position, index) => {
          if (index === 0) context.moveTo(position.x, position.y);
          else context.lineTo(position.x, position.y);
        });
        context.closePath();
        context.stroke();
        context.setLineDash([]);
      }

      if (!under && selectedRef.current.size === 0) {
        context.textAlign = "center";
        context.textBaseline = "middle";
        // Names already written, so a smaller clump gives way rather than
        // printing itself over a bigger one. Sorted by size above, so what
        // survives a collision is the one worth reading.
        const written: { x: number; y: number; width: number; height: number }[] = [];

        for (const { cluster, at } of labels) {
          const size = Math.max(11, Math.min(20, 15 * at.scale * (0.75 + room * 0.25)));
          // A literal stack: a canvas font string is not CSS and silently
          // rejects `var(...)`, which leaves every label at the 10px default.
          context.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          context.letterSpacing = "0.06em";
          context.globalAlpha = Math.max(0.45, Math.min(1, 1.5 / at.depth));

          const text = cluster.label.replaceAll("_", " ");
          const textWidth = context.measureText(text).width;
          // Held inside the frame: a name clipped in half by the edge is worse
          // than a name a few pixels off the clump it belongs to.
          const margin = textWidth / 2 + 12;
          const at2 = {
            x: Math.max(margin, Math.min(width - margin, at.x)),
            y: Math.max(size, Math.min(viewHeight - size, at.y)),
          };
          // A plate behind the words, or a label over a bright photograph is
          // unreadable exactly where the cloud is densest.
          const plate = {
            x: at2.x - textWidth / 2 - 7,
            y: at2.y - size * 0.75,
            width: textWidth + 14,
            height: size * 1.5,
          };
          const collides = written.some(
            (other) =>
              plate.x < other.x + other.width &&
              plate.x + plate.width > other.x &&
              plate.y < other.y + other.height &&
              plate.y + plate.height > other.y,
          );
          if (collides) continue;
          written.push(plate);

          context.fillStyle = "rgba(0, 0, 0, 0.62)";
          context.beginPath();
          context.roundRect(plate.x, plate.y, plate.width, plate.height, size * 0.75);
          context.fill();

          context.fillStyle = "rgba(255, 255, 255, 0.94)";
          context.fillText(text, at2.x, at2.y);
        }
        context.letterSpacing = "0px";
      }

      if (under) {
        // Everything else goes back into the page, and what matters is drawn
        // again on top of the wash.
        context.globalAlpha = FOCUS_WASH;
        context.fillStyle = wash;
        context.fillRect(0, 0, width, viewHeight);

        const kin = (under.entry.near ?? [])
          .map((neighbour) => onScreen.get(neighbour))
          .filter((point): point is Placed => Boolean(point));

        // The lines first, so each one ends at the edge of the photograph it
        // joins rather than crossing it.
        context.globalAlpha = WEB_HOVER_ALPHA;
        context.strokeStyle = "rgba(255, 255, 255, 1)";
        context.lineWidth = 1.1;
        context.beginPath();
        for (const point of kin) {
          context.moveTo(under.x, under.y);
          context.lineTo(point.x, point.y);
        }
        context.stroke();

        const drawFramed = (point: Placed, size: number, border: number) => {
          const sheet =
            atlas && point.entry.slot !== undefined
              ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
              : undefined;
          const own = thumbnailsRef.current.get(point.entry.src);

          if (
            sheet?.complete &&
            sheet.naturalWidth > 0 &&
            atlas &&
            point.entry.slot !== undefined
          ) {
            const within = point.entry.slot % atlas.perSheet;
            context.drawImage(
              sheet,
              (within % perRow) * atlas.cell,
              Math.floor(within / perRow) * atlas.cell,
              atlas.cell,
              atlas.cell,
              point.x - size / 2,
              point.y - size / 2,
              size,
              size,
            );
          } else if (own?.complete && own.naturalWidth > 0) {
            drawSquare(context, own, point.x, point.y, size);
          } else {
            context.fillStyle = point.entry.swatch ?? "#8899aa";
            context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
          }

          context.strokeStyle = "rgba(255, 255, 255, 0.92)";
          context.lineWidth = border;
          context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
        };

        // The kin, in the same frame the photograph itself gets, one size down.
        context.globalAlpha = 1;
        for (const point of kin) {
          drawFramed(point, thumbnail * 1.7 * Math.max(0.7, point.scale), 1);
        }

        // And the photograph under the pointer, largest and last.
        let image = thumbnailsRef.current.get(under.entry.src);
        if (!image) {
          image = new Image();
          image.decoding = "async";
          image.src = under.entry.src;
          thumbnailsRef.current.set(under.entry.src, image);
        }

        const size = thumbnail * 3 * Math.max(0.8, under.scale);
        context.save();
        context.shadowColor = "rgba(0, 0, 0, 0.5)";
        context.shadowBlur = 20;
        if (image.complete && image.naturalWidth > 0) {
          drawSquare(context, image, under.x, under.y, size);
        } else {
          drawFramed(under, size, 0);
        }
        context.restore();
        context.strokeStyle = "rgba(255, 255, 255, 0.95)";
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
  }, [atlas, clusters, entries, theme]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);

    // Modal on purpose: a drag means one thing at a time. Outside selecting it
    // always turns the cloud, and inside it always draws a ring, so nobody has
    // to hold a key down to find out which they are doing.
    if (selectingRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      lassoRef.current = [{ x: event.clientX - bounds.left, y: event.clientY - bounds.top }];
      return;
    }

    draggingRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

    if (lassoRef.current.length > 0) {
      lassoRef.current.push(pointerRef.current);
      return;
    }

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

  /** What the ring caught, in the pose it was drawn around. */
  const closeLasso = () => {
    const ring = lassoRef.current;
    lassoRef.current = [];
    if (ring.length < MIN_LASSO_POINTS) return;

    const caught = placedRef.current.filter((point) => isInsidePolygon(point, ring));
    selectedRef.current = new Set(caught.map((point) => point.index));
    setSelected(caught.map((point) => point.entry));
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (lassoRef.current.length > 0) closeLasso();
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clearSelection = () => {
    selectedRef.current = new Set();
    setSelected([]);
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

  // What the selection turned out to be about, asked the same way the cluster
  // labels are: the tags that are commoner in here than in the collection.
  const overallTags = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (entry.tag) overallTags.set(entry.tag, (overallTags.get(entry.tag) ?? 0) + 1);
  }

  const selectionTags: string[] = [];
  const remaining = selected.map((entry) => (entry.tag ? [entry.tag] : []));
  const taken = new Set<string>();
  while (selectionTags.length < SELECTION_TAGS) {
    const tag = distinctiveTag(
      remaining.map((tags) => tags.filter((value) => !taken.has(value))),
      overallTags,
      2,
    );
    if (!tag) break;
    taken.add(tag);
    selectionTags.push(tag);
  }

  // Somewhere to go from a selection: the photographs it is mostly of, and more
  // like the one nearest the middle of it.
  const medoid =
    selected.length > 0 ? (selected[Math.floor(selected.length / 2)] as EmbeddingSpaceEntry) : null;
  const medoidPath = medoid ? indexedPathFromSrc(medoid.src) : null;

  return (
    <figure className={[styles.space, className].filter(Boolean).join(" ")}>
      <div className={styles.stage} style={{ blockSize: `${height}px` }}>
        <canvas
          ref={canvasRef}
          className={[styles.canvas, selecting ? styles.selectingCanvas : ""]
            .filter(Boolean)
            .join(" ")}
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
            if (hovered && !selecting) globalThis.location.assign(hovered.entry.href);
          }}
        />

        {/* Over the cloud rather than under it, the way the map's controls sit:
            the picture is the subject and the chrome should cost it no room. */}
        <div className={styles.tools}>
          <OverlayButton
            size="small"
            aria-pressed={selecting}
            className={selecting ? styles.toolActive : ""}
            onClick={() => {
              setSelecting((current) => !current);
              if (selecting) clearSelection();
            }}
          >
            {selecting ? "Done" : "Select"}
          </OverlayButton>
          <OverlayButton
            size="small"
            aria-pressed={!drifting}
            className={drifting ? "" : styles.toolActive}
            onClick={() => setDrifting((current) => !current)}
          >
            {drifting ? "Pause" : "Turn"}
          </OverlayButton>
        </div>

        {count === 0 ? <p className={styles.status}>Arranging the collection…</p> : null}

        {hovered && !selecting ? (
          <figcaption className={styles.caption}>
            <span>{hovered.entry.album ?? hovered.entry.label}</span>
            {hovered.entry.tag ? (
              <span className={styles.captionTag}>{hovered.entry.tag.replaceAll("_", " ")}</span>
            ) : null}
          </figcaption>
        ) : null}
      </div>

      {selected.length > 0 ? (
        <div className={styles.selection}>
          <p className={styles.selectionSummary}>
            <strong>{selected.length.toLocaleString("en")}</strong> photographs
            {selectionTags.length > 0 ? (
              <>
                {" · mostly "}
                <span className={styles.selectionTags}>
                  {selectionTags.map((tag) => tag.replaceAll("_", " ")).join(", ")}
                </span>
              </>
            ) : null}
          </p>
          <div className={styles.actions}>
            {selectionTags[0] ? (
              <AppLink
                className={pillStyles.base + " " + pillStyles.surface}
                href={buildSearchHref({ query: [selectionTags[0]] })}
              >
                {`Search “${selectionTags[0].replaceAll("_", " ")}”`}
              </AppLink>
            ) : null}
            {medoidPath ? (
              <AppLink
                className={pillStyles.base + " " + pillStyles.surface}
                href={buildSimilaritySearchHref(medoidPath)}
              >
                Find more like these
              </AppLink>
            ) : null}
            <button
              type="button"
              className={[pillStyles.base, pillStyles.ghost].join(" ")}
              onClick={clearSelection}
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <Caption as="p" size="sm" className={styles.hint}>
          {selecting
            ? "Draw a ring around a group of photographs."
            : "Drag to turn it, scroll to move closer, click a photograph to open it."}
        </Caption>
      )}

      {/* A canvas has no children, so the photographs in it are unreachable
          without this: the same compensation the map makes for its GPU pins. */}
      <ul className={styles.hiddenList}>
        {(entries ?? []).map((entry) => (
          <li key={entry.href}>
            <AppLink href={entry.href}>{entry.label}</AppLink>
          </li>
        ))}
      </ul>
    </figure>
  );
};

export default EmbeddingSpace;
