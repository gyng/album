import React from "react";
import { AppLink } from "./platform";
import { OverlayButton, overlayButtonStyles, pillStyles } from "./ui";
import { useActiveTheme } from "./useActiveTheme";
import {
  backToFront,
  type Camera,
  distinctiveTag,
  flatViewScale,
  pickPoint,
  placeFlat,
  projectPoint,
  type ProjectedPoint,
  withinFrame,
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
  /**
   * Height of the viewer, in pixels. Left unset the stylesheet decides, which
   * gives a desktop most of the window and a phone a sensible fraction of it —
   * a cloud wants room, and how much room there is is a CSS question.
   */
  height?: number;
};

const INITIAL_CAMERA: Camera = { yaw: 0.7, pitch: 0.22, distance: 3.8 };

/** Radians per second while nobody is holding it. Slow enough to read. */
const DRIFT = 0.11;

/**
 * How near and how far the eye may get.
 *
 * Wide, because both ends are worth having: close enough to be inside the
 * cloud with a handful of photographs around you, far enough that the whole
 * thing is a speck of its own colours.
 */
const MIN_DISTANCE = 0.85;
const MAX_DISTANCE = 16;
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

/** Movement past this, in pixels, makes a press a turn rather than a click. */
const DRAG_SLOP = 5;

/** How many of a selection's tags are worth naming. */
const SELECTION_TAGS = 3;

/** How many of a photograph's own tags are shown while a reader is on it. */
const CAPTION_TAGS = 3;

/**
 * Left alone, the cloud shows itself: every few seconds it brings one
 * photograph up out of the drift, with its kin beside it, and lets them go
 * again. The same lens the pointer uses, moved by the clock instead — so a
 * reader who does nothing still learns what the thing is for.
 */
const SHOWCASE_PERIOD = 5600;
const SHOWCASE_FADE = 1100;

/**
 * The clumps have eight names between them, and the collection has hundreds of
 * words in it. So while nobody is touching the cloud, a few of the ones nothing
 * is naming drift up beside the photographs they belong to and fade away
 * again — the vocabulary of the archive, shown a little at a time.
 */
const DRIFTING_TAGS = 3;
const DRIFTING_TAG_PERIOD = 7200;
const DRIFTING_TAG_FADE = 1300;

type Placed = ProjectedPoint & { entry: EmbeddingSpaceEntry; index: number };

/**
 * Eases a value towards a target, framerate-independently.
 *
 * Everything in the cloud that appears — a thumbnail taking over from its dot,
 * the focus coming up under the pointer — moves through this rather than
 * switching, because a cloud that is always drifting cannot also be always
 * snapping.
 */
const ease = (from: number, to: number, elapsed: number, seconds: number): number =>
  from + (to - from) * (1 - Math.exp(-elapsed / Math.max(0.001, seconds)));

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

export const EmbeddingSpace: React.FC<EmbeddingSpaceProps> = ({ className, height }) => {
  // The wash has to be the page's own ground, and the reader can change it
  // without reloading.
  const theme = useActiveTheme();
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [atlas, setAtlas] = React.useState<EmbeddingSpaceAtlas | null>(null);
  const [axisScale, setAxisScale] = React.useState({ x: 1, y: 1, z: 1 });
  const [clusters, setClusters] = React.useState<EmbeddingSpaceCluster[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState<Placed | null>(null);
  const [drifting, setDrifting] = React.useState(true);
  /** Which named clump the reader has chosen, if any. */
  const [chosen, setChosen] = React.useState<number | null>(null);
  /** Whichever photograph the cloud is showing off, while nobody is looking at it. */
  const [showcased, setShowcased] = React.useState<EmbeddingSpaceEntry | null>(null);
  /** The words currently drifting, mirrored into React only when one is replaced. */
  const [driftingTags, setDriftingTags] = React.useState<string[]>([]);
  /**
   * Flat, the cloud is the first two components and nothing else — the same
   * arrangement seen from directly in front, where a reader can compare
   * distances rather than watch them foreshorten. Turning is meaningless there,
   * so a drag pans instead.
   */
  const [flat, setFlat] = React.useState(false);
  /** How far in the eye is, as a multiple of where it starts. */
  const [zoom, setZoom] = React.useState(1);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const cameraRef = React.useRef<Camera>({ ...INITIAL_CAMERA });
  const placedRef = React.useRef<Placed[]>([]);
  const thumbnailsRef = React.useRef(new Map<string, HTMLImageElement>());
  /**
   * The full-size picture for a photograph, started on first use.
   *
   * A handful are ever wanted at once — one under the pointer or in the
   * showcase, and its three kin — so this never becomes the request storm the
   * contact sheet exists to prevent.
   */
  /**
   * The sheet's cells are 48px, which is right for a cloud and soft the moment
   * one photograph is brought up to three times that. Whatever is active —
   * pointed at, shown off, or kin to either — is fetched at the size the rest
   * of the site publishes and drawn from that instead, once it arrives.
   */
  const fullResolution = React.useCallback((src: string): HTMLImageElement => {
    const held = thumbnailsRef.current.get(src);
    if (held) return held;

    const image = new Image();
    image.decoding = "async";
    image.src = src;
    thumbnailsRef.current.set(src, image);
    return image;
  }, []);
  const sheetsRef = React.useRef<HTMLImageElement[]>([]);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null);
  /** How far the pointer travelled while held down, so a turn is not a click. */
  const travelledRef = React.useRef(0);
  /** A finger has no hover, so what it last tapped has to be remembered. */
  const pointerTypeRef = React.useRef<string>("mouse");
  const tappedRef = React.useRef<string | null>(null);
  /** Hit testing against the pose actually on screen, as the draw loop last left it. */
  const pickRef = React.useRef<((at: { x: number; y: number }) => Placed | null) | null>(null);
  const flatRef = React.useRef(false);
  /** Screen-space offset, for panning a flat view that has been zoomed into. */
  const panRef = React.useRef({ x: 0, y: 0 });
  const chosenRef = React.useRef<number | null>(null);
  /** The name elements, positioned from the draw loop. */
  const labelRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const showcaseRef = React.useRef<{ index: number; start: number } | null>(null);
  /** How far the pointer's focus has come up, 0 to 1, so it fades rather than snaps. */
  const focusRef = React.useRef(0);
  const lastUnderRef = React.useRef<Placed | null>(null);
  /** Per photograph: how much of a photograph it currently is, rather than a dot. */
  const photonessRef = React.useRef<Float32Array | null>(null);
  const lastNamedRef = React.useRef<EmbeddingSpaceEntry | null>(null);
  /** The chip naming what is being looked at, moved to sit under it. */
  const captionRef = React.useRef<HTMLElement | null>(null);
  /** The words drifting through the cloud: which photograph each belongs to, and since when. */
  const driftingRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const driftingTagsRef = React.useRef<({ index: number; tag: string; start: number } | null)[]>(
    Array.from({ length: DRIFTING_TAGS }, () => null),
  );
  const driftingRef = React.useRef(true);

  driftingRef.current = drifting;
  chosenRef.current = chosen;
  flatRef.current = flat;

  React.useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSpace()
      .then((space) => {
        if (cancelled) return;
        setEntries(space.points);
        setAtlas(space.atlas);
        setClusters(space.clusters);
        setAxisScale(space.axisScale);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Scrolling over the cloud moves the eye in and out.
   *
   * Attached by hand because React's `onWheel` is registered passively, so it
   * cannot take the gesture from the page. It only takes it while there is room
   * to move: at either limit the wheel goes back to scrolling, which is what
   * keeps a canvas half a screen tall from being a hole a reader falls into.
   */
  React.useEffect(() => {
    // On the stage rather than the canvas: the names and the caption sit over
    // it, and a wheel over one of those would otherwise scroll the page out
    // from under the reader mid-zoom.
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      // Proportional rather than fixed: a step that moves the eye a tenth of
      // where it already is takes the same number of turns to cross the range
      // from either end, where a fixed step crawls when near and leaps when far.
      const next = Math.max(
        MIN_DISTANCE,
        Math.min(MAX_DISTANCE, camera.distance * Math.exp(event.deltaY * 0.0012)),
      );
      if (next === camera.distance) return;

      camera.distance = next;
      event.preventDefault();
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
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
      // It turns on its own until somebody engages with it. A name that keeps
      // moving is a name you have to chase to click, and a photograph under the
      // pointer should stay under the pointer.
      const engaged = pointerRef.current !== null || draggingRef.current !== null;
      if (driftingRef.current && !reduced && !engaged && !flatRef.current) {
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
      const isFlat = flatRef.current;
      const camera = cameraRef.current;

      // Flat has no depth for the eye's distance to act on, so the drag and the
      // wheel are applied to the screen instead. Everything placed in the flat
      // view goes through here — a name that took its own route from the same
      // projection stayed where the photographs had been.
      const inView = (projected: ProjectedPoint | null): ProjectedPoint | null =>
        projected && isFlat
          ? placeFlat(
              projected,
              viewport,
              panRef.current,
              flatViewScale(camera, INITIAL_CAMERA.distance),
            )
          : projected;

      // On a phone the canvas is a third of the area it is on a laptop, and a
      // thumbnail that stays 22px there closes the cloud into a mosaic again.
      // Everything drawn scales with the room there is to draw it in.
      const room = Math.min(1, Math.min(width, viewHeight) / 460);
      const thumbnail = THUMBNAIL_SIZE * (0.62 + room * 0.38);

      const placed: Placed[] = [];
      entries.forEach((entry, index) => {
        // Flat is the same projection with the depth axis dropped — which is
        // exactly the two-component projection, since the first two directions
        // are the same whether three are solved for or two. The stretch that
        // makes the cloud turnable is undone here, because a scatter plot of
        // two components should show the proportions they actually have.
        const projected = inView(
          projectPoint(
            isFlat ? { x: entry.x * axisScale.x, y: entry.y * axisScale.y, z: 0 } : entry,
            camera,
            viewport,
          ),
        );
        if (projected) {
          placed.push({ ...projected, entry, index });
        }
      });

      const ordered = backToFront(placed);
      placedRef.current = ordered;

      // The cloud's own front and back this frame. Fading against these rather
      // than against absolute distance is what makes the depth read the same at
      // every zoom: tied to raw distance the whole cloud dimmed as it was
      // pushed away, and tied to the camera alone it flattened as it was, since
      // the spread between nearest and furthest shrinks with the perspective.
      const backDepth = ordered[0]?.depth ?? 1;
      const frontDepth = ordered.at(-1)?.depth ?? 0;
      const depthSpan = Math.max(0.0001, backDepth - frontDepth);

      // The nearest handful become photographs; the rest stay as their own
      // dominant colour, which is what keeps fifteen hundred of them readable.
      //
      // Flat, the budget is spent on what is in the frame: closing in on a
      // handful of dots brought no photographs up, because the same fixed share
      // of the whole collection was showing itself and most of it was off
      // screen. Spending it where the reader is looking turns nearly every dot
      // in view into its photograph without drawing one more of them. The
      // turning view keeps the whole cloud in play, since it has no pan and
      // depth is what decides there.
      const nearest = new Set(
        (isFlat ? withinFrame(ordered, viewport, thumbnail) : [...ordered])
          // Depth decides which are photographs in the turning view. Flat, there
          // is no depth to decide with, and picking by distance from the middle
          // made a photographic core inside a halo of dots — so the detail is
          // spread instead, by a stable golden-ratio shuffle that has no
          // relationship to where anything sits.
          .sort((a, b) =>
            isFlat ? ((a.index * 0.618033) % 1) - ((b.index * 0.618033) % 1) : a.depth - b.depth,
          )
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

      // How much of a photograph each point is right now. A point that has just
      // come near enough grows into its thumbnail instead of appearing as one.
      if (photonessRef.current?.length !== entries.length) {
        photonessRef.current = new Float32Array(entries.length);
      }
      const photoness = photonessRef.current;

      let started = 0;
      for (const point of ordered) {
        const wantsThumbnail = nearest.has(point.index);
        const grown = ease(
          photoness[point.index] ?? 0,
          wantsThumbnail ? 1 : 0,
          elapsed,
          wantsThumbnail ? 0.28 : 0.45,
        );
        photoness[point.index] = grown;
        const image = thumbnailsRef.current.get(point.entry.src);

        if (!atlas && wantsThumbnail && !image && started < LOADS_PER_FRAME) {
          started += 1;
          const loading = new Image();
          loading.decoding = "async";
          loading.src = point.entry.src;
          thumbnailsRef.current.set(point.entry.src, loading);
        }

        // 0 at the front of the cloud, 1 at the back, whatever the zoom. The
        // curve is steep because the far field has to be much fainter than a
        // linear fade makes it: a thousand translucent photographs behind each
        // other stack into a haze, and the haze is what buries the shape.
        const behind = (point.depth - frontDepth) / depthSpan;
        const depthAlpha = Math.max(0.08, 1 - 0.92 * behind ** 1.3);

        // Resolved from how much of a photograph it currently is rather than
        // from whether it still wants to be one: taking the sheet away at the
        // moment a point leaves the near set left the fade-out with nothing to
        // draw, so it vanished instead of going.
        const cell =
          atlas && grown > 0.02 && point.entry.slot !== undefined
            ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
            : undefined;

        const hasCell =
          Boolean(cell?.complete) &&
          (cell?.naturalWidth ?? 0) > 0 &&
          Boolean(atlas) &&
          point.entry.slot !== undefined;

        // The dot beneath, fading out as the photograph fades in, so nothing
        // ever arrives or leaves abruptly.
        if (grown < 0.98) {
          context.globalAlpha = depthAlpha * (1 - grown);
          context.beginPath();
          context.arc(point.x, point.y, DOT_RADIUS * point.scale, 0, Math.PI * 2);
          context.fillStyle = point.entry.swatch ?? "#8899aa";
          context.fill();
        }

        if (grown > 0.02) {
          context.globalAlpha = depthAlpha * grown;
          const size = thumbnail * point.scale * (0.7 + grown * 0.3);

          if (hasCell && atlas && cell && point.entry.slot !== undefined) {
            const within = point.entry.slot % atlas.perSheet;
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
            context.strokeStyle = `rgba(0, 0, 0, ${0.55 * grown})`;
            context.lineWidth = 0.75;
            context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
          } else if (image?.complete && image.naturalWidth > 0) {
            drawSquare(context, image, point.x, point.y, size);
          }
        }
      }

      // What each clump turned out to be about, written where it is. Drawn
      // after the photographs so the words are legible, and dropped entirely
      // while the reader is looking at one photograph — a legend is for reading
      // the whole, and this is the moment they stopped.
      // Every clump is named where there is room for eight names; a phone gets
      // the biggest few, which is a legend rather than a wall of words.
      const labels = clusters
        .map((cluster, index) => ({ ...cluster, index }))
        .sort((a, b) => b.count - a.count)
        .slice(0, room < 0.8 ? 4 : clusters.length)
        .map((cluster) => ({
          cluster,
          at: inView(
            projectPoint(
              isFlat ? { x: cluster.x * axisScale.x, y: cluster.y * axisScale.y, z: 0 } : cluster,
              camera,
              viewport,
            ),
          ),
        }))
        .filter(
          (
            entry,
          ): entry is { cluster: EmbeddingSpaceCluster & { index: number }; at: ProjectedPoint } =>
            Boolean(entry.at),
        );

      // Whatever the pointer is over is worth a photograph even when it is deep
      // in the cloud: that is what hovering is for.
      const pointer = pointerRef.current;
      pickRef.current = (at) =>
        pickPoint(ordered, at, (point) => radiusOf(point, nearest.has(point.index), thumbnail));
      const under = pointer ? pickRef.current(pointer) : null;

      // A chosen clump puts the same lens on a group: everything else goes back
      // into the page and the group stays where it is.
      if (chosenRef.current !== null) {
        context.globalAlpha = FOCUS_WASH;
        context.fillStyle = wash;
        context.fillRect(0, 0, width, viewHeight);

        context.globalAlpha = 1;
        for (const point of ordered) {
          if (point.entry.cluster !== chosenRef.current) continue;
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

      // Left alone, the cloud shows itself: one photograph at a time comes up
      // out of the drift with its kin beside it, and goes again. The same lens
      // the pointer uses, moved by the clock.
      const idle =
        !engaged && driftingRef.current && !reduced && chosenRef.current === null && !under;
      let showcaseStrength = 0;

      if (!idle) {
        showcaseRef.current = null;
      } else {
        const current = showcaseRef.current;
        if (!current || time - current.start > SHOWCASE_PERIOD) {
          // Only from what is in front and inside the frame: showing off a
          // photograph nobody can see is not showing off.
          const candidates = ordered.filter(
            (point) =>
              nearest.has(point.index) &&
              point.x > thumbnail &&
              point.x < width - thumbnail &&
              point.y > thumbnail &&
              point.y < viewHeight - thumbnail,
          );
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          showcaseRef.current = pick ? { index: pick.index, start: time } : null;
        }
      }

      const showing = showcaseRef.current;
      const star = showing ? onScreen.get(showing.index) : undefined;
      if (showing && star) {
        const age = time - showing.start;
        showcaseStrength = Math.max(
          0,
          Math.min(1, Math.min(age, SHOWCASE_PERIOD - age) / SHOWCASE_FADE),
        );

        const drawFramed = (point: Placed, size: number, border: number, alpha: number) => {
          const sheet =
            atlas && point.entry.slot !== undefined
              ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
              : undefined;
          context.globalAlpha = alpha;

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

          if (border > 0) {
            context.strokeStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
            context.lineWidth = border;
            context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
          }
        };

        // Softer than the pointer's focus: this is the cloud murmuring, not a
        // reader asking.
        context.globalAlpha = FOCUS_WASH * 0.72 * showcaseStrength;
        context.fillStyle = wash;
        context.fillRect(0, 0, width, viewHeight);

        const kin = (star.entry.near ?? [])
          .map((neighbour) => onScreen.get(neighbour))
          .filter((point): point is Placed => Boolean(point));

        context.globalAlpha = 0.7 * showcaseStrength;
        context.strokeStyle = "rgba(255, 255, 255, 1)";
        context.lineWidth = 1;
        context.beginPath();
        for (const point of kin) {
          context.moveTo(star.x, star.y);
          context.lineTo(point.x, point.y);
        }
        context.stroke();

        for (const point of kin) {
          drawFramed(
            point,
            thumbnail * 1.5 * Math.max(0.7, point.scale),
            1,
            0.8 * showcaseStrength,
          );
        }
        drawFramed(star, thumbnail * 2.6 * Math.max(0.8, star.scale), 1.5, showcaseStrength);
      }

      // Words from the collection that nothing else is naming, drifting beside
      // the photographs they belong to.
      const clumpNames = new Set(clusters.map((cluster) => cluster.label));
      let tagsChanged = false;

      driftingTagsRef.current.forEach((current, slot) => {
        if (!idle) {
          driftingTagsRef.current[slot] = null;
          if (current) tagsChanged = true;
          return;
        }

        if (current && time - current.start <= DRIFTING_TAG_PERIOD) return;

        // Staggered by slot, so three words never arrive together.
        const taken = new Set([
          ...clumpNames,
          ...driftingTagsRef.current.flatMap((entry) => (entry ? [entry.tag] : [])),
        ]);
        const candidates = ordered.filter(
          (point) =>
            (point.entry.tags ?? []).some((tag) => !taken.has(tag)) &&
            nearest.has(point.index) &&
            point.x > thumbnail * 2 &&
            point.x < width - thumbnail * 2 &&
            point.y > thumbnail &&
            point.y < viewHeight - thumbnail,
        );
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const word = (pick?.entry.tags ?? []).find((tag) => !taken.has(tag));
        driftingTagsRef.current[slot] = word
          ? {
              index: pick?.index ?? 0,
              tag: word,
              start: time + slot * (DRIFTING_TAG_PERIOD / DRIFTING_TAGS),
            }
          : null;
        tagsChanged = true;
      });

      if (tagsChanged) {
        setDriftingTags(driftingTagsRef.current.map((entry) => entry?.tag ?? ""));
      }

      driftingTagsRef.current.forEach((current, slot) => {
        const element = driftingRefs.current[slot];
        if (!element) return;

        const point = current ? onScreen.get(current.index) : undefined;
        if (!current || !point) {
          element.style.opacity = "0";
          return;
        }

        const age = time - current.start;
        const strength = Math.max(
          0,
          Math.min(1, Math.min(age, DRIFTING_TAG_PERIOD - age) / DRIFTING_TAG_FADE),
        );

        element.style.transform = `translate(${Math.round(point.x + thumbnail * 0.8)}px, ${Math.round(
          point.y - element.offsetHeight / 2,
        )}px)`;
        element.style.opacity = String(strength * 0.85 * (1 - focusRef.current));
      });

      // The names are real buttons over the canvas rather than text painted
      // into it: a name is a control — it can be clicked, tabbed to and read
      // aloud — and a canvas can offer none of that. They are positioned from
      // here, by writing transforms straight onto the elements, because a React
      // render sixty times a second to move eight labels is not a trade worth
      // making.
      const placedLabels: { x: number; y: number; width: number; height: number }[] = [];

      // Every name is put away first. A label this frame never reaches — one
      // whose clump is behind the camera, or one a small frame has no room for
      // — would otherwise keep whatever it was left with, which is fully opaque
      // in the corner it was born in.
      // The one exception is the name that currently has focus. This loop owns
      // these two properties, and an inline style beats any selector, so CSS
      // could only insist with `!important` — leaving the keyboard's view of the
      // cloud dependent on a specificity fight. Whoever writes the style is who
      // should honour the focus.
      const focusedName = document.activeElement;
      for (const element of labelRefs.current) {
        if (element) {
          const hasFocus = element === focusedName;
          element.style.opacity = hasFocus ? "1" : "0";
          element.style.pointerEvents = hasFocus ? "auto" : "none";
        }
      }

      labels.forEach(({ cluster, at }, index) => {
        const element = labelRefs.current[cluster.index];
        if (!element) return;

        const half = element.offsetWidth / 2;
        const box = {
          x: Math.max(0, Math.min(width - element.offsetWidth, at.x - half)),
          y: Math.max(
            0,
            Math.min(viewHeight - element.offsetHeight, at.y - element.offsetHeight / 2),
          ),
          width: element.offsetWidth,
          height: element.offsetHeight,
        };

        // Biggest clump first, and a smaller name gives way rather than
        // printing itself over one already placed.
        const collides = placedLabels.some(
          (other) =>
            box.x < other.x + other.width &&
            box.x + box.width > other.x &&
            box.y < other.y + other.height &&
            box.y + box.height > other.y,
        );
        const shown = !collides && index < (room < 0.8 ? 4 : labels.length);
        if (shown) placedLabels.push(box);

        const hasFocus = element === focusedName;
        element.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
        element.style.opacity = hasFocus
          ? "1"
          : shown
            ? String(
                Math.max(0.55, Math.min(1, 1.5 / at.depth)) *
                  (1 - 0.75 * showcaseStrength) *
                  (1 - focusRef.current),
              )
            : "0";
        element.style.pointerEvents =
          hasFocus || (shown && focusRef.current < 0.5) ? "auto" : "none";
      });

      // The focus comes up and goes down rather than switching: `under` decides
      // where it is going, and this decides how far along it is.
      if (under) lastUnderRef.current = under;
      focusRef.current = ease(focusRef.current, under ? 1 : 0, elapsed, 0.13);
      const focus = focusRef.current;
      const focused = under ?? (focus > 0.01 ? lastUnderRef.current : null);

      if (focused) {
        const under = focused;
        // Everything else goes back into the page, and what matters is drawn
        // again on top of the wash.
        context.globalAlpha = FOCUS_WASH * focus;
        context.fillStyle = wash;
        context.fillRect(0, 0, width, viewHeight);

        const kin = (under.entry.near ?? [])
          .map((neighbour) => onScreen.get(neighbour))
          .filter((point): point is Placed => Boolean(point));

        // The lines first, so each one ends at the edge of the photograph it
        // joins rather than crossing it.
        context.globalAlpha = WEB_HOVER_ALPHA * focus;
        context.strokeStyle = "rgba(255, 255, 255, 1)";
        context.lineWidth = 1.1;
        context.beginPath();
        for (const point of kin) {
          context.moveTo(under.x, under.y);
          context.lineTo(point.x, point.y);
        }
        context.stroke();

        const drawFramedLocal = (point: Placed, size: number, border: number) => {
          const sheet =
            atlas && point.entry.slot !== undefined
              ? sheetsRef.current[Math.floor(point.entry.slot / atlas.perSheet)]
              : undefined;
          // Asked for at full size the moment it matters; the sheet's cell holds
          // the place until it arrives.
          const own = fullResolution(point.entry.src);

          if (own.complete && own.naturalWidth > 0) {
            drawSquare(context, own, point.x, point.y, size);
          } else if (
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

          context.strokeStyle = `rgba(255, 255, 255, ${0.92 * focus})`;
          context.lineWidth = border;
          context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
        };

        // The kin, in the same frame the photograph itself gets, one size down.
        context.globalAlpha = focus;
        for (const point of kin) {
          drawFramedLocal(point, thumbnail * 1.7 * Math.max(0.7, point.scale), 1);
        }

        // And the photograph under the pointer, largest and last.
        const image = fullResolution(under.entry.src);

        // Growing a little as it comes up, so it arrives rather than appears.
        const size = thumbnail * (2.4 + 0.6 * focus) * Math.max(0.8, under.scale);
        context.save();
        context.globalAlpha = focus;
        context.shadowColor = `rgba(0, 0, 0, ${0.5 * focus})`;
        context.shadowBlur = 20;
        if (image.complete && image.naturalWidth > 0) {
          drawSquare(context, image, under.x, under.y, size);
        } else {
          drawFramedLocal(under, size, 0);
        }
        context.restore();
        context.strokeStyle = `rgba(255, 255, 255, ${0.95 * focus})`;
        context.lineWidth = 1.5;
        context.strokeRect(under.x - size / 2, under.y - size / 2, size, size);
      }

      // The words belong to one photograph, so they follow it rather than
      // sitting in a corner the reader has to look away to read.
      const named = focused ?? (showcaseStrength > 0.25 ? star : null);
      const caption = captionRef.current;
      if (caption && named) {
        const size = thumbnail * (focused ? 2.4 + 0.6 * focus : 2.6) * Math.max(0.8, named.scale);
        const half = caption.offsetWidth / 2;
        caption.style.transform = `translate(${Math.round(
          Math.max(0, Math.min(width - caption.offsetWidth, named.x - half)),
        )}px, ${Math.round(
          Math.max(
            0,
            Math.min(
              viewHeight - caption.offsetHeight,
              named.y + size / 2 + Number(THUMBNAIL_SIZE) * 0.35,
            ),
          ),
        )}px)`;
      }

      setZoom((current) => {
        const next = Math.round((INITIAL_CAMERA.distance / camera.distance) * 10) / 10;
        return next === current ? current : next;
      });

      setShowcased((current) => {
        const next = showcaseStrength > 0.25 ? (star?.entry ?? null) : null;
        return current?.href === next?.href ? current : next;
      });

      // React state only when the answer changes: this runs sixty times a
      // second, and the label below the cloud is the only thing that needs it.
      setHovered((current) => (current?.index === under?.index ? current : under));

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [atlas, axisScale, clusters, entries, fullResolution, theme]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    // A finger arrives without ever having moved, so the position has to be
    // taken here or a tap is a gesture with no place.
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    pointerTypeRef.current = event.pointerType;
    draggingRef.current = { x: event.clientX, y: event.clientY };
    travelledRef.current = 0;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

    const dragging = draggingRef.current;
    if (!dragging) return;

    const camera = cameraRef.current;
    travelledRef.current += Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y);

    if (flatRef.current) {
      // Nothing to turn: a flat view is dragged around instead. Divided by the
      // magnification the drawing applies, since the pan is held unmagnified —
      // which is what keeps the cloud moving exactly with the pointer however
      // far in the reader has zoomed.
      const scale = flatViewScale(camera, INITIAL_CAMERA.distance);
      panRef.current = {
        x: panRef.current.x + (event.clientX - dragging.x) / scale,
        y: panRef.current.y + (event.clientY - dragging.y) / scale,
      };
    } else {
      camera.yaw += (event.clientX - dragging.x) * 0.006;
      camera.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, camera.pitch + (event.clientY - dragging.y) * 0.004),
      );
    }

    draggingRef.current = { x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>, pressed = false) => {
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pressed && isTouch()) resolvePress();
  };

  /** True where the pointer cannot hover, so looking and opening are two taps. */
  const isTouch = () => pointerTypeRef.current !== "mouse";

  /**
   * What a press meant, once it turns out not to have been a turn.
   *
   * Called from `pointerup` on a touch screen and from `click` with a mouse:
   * a tap does not reliably produce a click, and a click is the only thing a
   * keyboard or an assistive pointer produces.
   */
  const resolvePress = () => {
    if (travelledRef.current > DRAG_SLOP) return;

    // Asked of the pose on screen rather than of React's last render, because
    // a press resolves before the next frame has run.
    const at = pointerRef.current;
    const hit = at ? (pickRef.current?.(at) ?? null) : null;

    if (!hit) {
      // Pressing the empty ground puts the cloud back to turning.
      if (isTouch()) {
        pointerRef.current = null;
        tappedRef.current = null;
      }
      return;
    }

    // A finger gets to look before it opens: the first tap brings the
    // photograph and its kin up, the second one opens it.
    if (!isTouch() || tappedRef.current === hit.entry.href) {
      globalThis.location.assign(hit.entry.href);
      return;
    }

    tappedRef.current = hit.entry.href;
  };

  if (failed) {
    return null;
  }

  const count = entries?.length ?? 0;
  // Whatever is being pointed at, or — when nobody is — whatever the cloud is
  // showing off by itself.
  const named = hovered?.entry ?? showcased;
  // Kept while the chip fades out, or the words would vanish before it does.
  if (named) lastNamedRef.current = named;
  const lastNamed = named ?? lastNamedRef.current;
  const selected =
    chosen === null ? [] : (entries ?? []).filter((entry) => entry.cluster === chosen);
  const chosenLabel = chosen === null ? null : (clusters[chosen]?.label ?? null);

  // What the selection turned out to be about, asked the same way the cluster
  // labels are: the tags that are commoner in here than in the collection.
  const overallTags = new Map<string, number>();
  for (const entry of entries ?? []) {
    for (const tag of entry.tags ?? []) {
      overallTags.set(tag, (overallTags.get(tag) ?? 0) + 1);
    }
  }

  const selectionTags: string[] = [];
  const remaining = selected.map((entry) => entry.tags ?? []);
  // The clump's own name is what the reader just clicked; repeating it back as
  // "also autumn" says nothing.
  const taken = new Set<string>(chosenLabel ? [chosenLabel] : []);
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
      <div
        ref={stageRef}
        className={styles.stage}
        {...(height === undefined ? {} : { style: { blockSize: `${height}px` } })}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`${count} photographs arranged by what they are of. Drag to turn the cloud.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endDrag(event, true)}
          onPointerCancel={endDrag}
          onPointerLeave={(event) => {
            // A finger's pointer is destroyed the moment it lifts, and clearing
            // the position then would take the tapped photograph away with it.
            if (!isTouch()) pointerRef.current = null;
            endDrag(event);
          }}
          onClick={() => {
            if (!isTouch()) resolvePress();
          }}
        />

        {/* Over the cloud rather than under it, the way the map's controls sit:
            the picture is the subject and the chrome should cost it no room. */}
        <div className={styles.tools}>
          <OverlayButton
            aria-pressed={flat}
            className={flat ? styles.toolActive : ""}
            onClick={() => {
              setFlat((current) => {
                // Flat means straight on: a view left half-turned would be an
                // oblique scatter plot, which is neither of the two things this
                // control offers.
                if (!current) {
                  cameraRef.current.yaw = 0;
                  cameraRef.current.pitch = 0;
                } else {
                  cameraRef.current.yaw = INITIAL_CAMERA.yaw;
                  cameraRef.current.pitch = INITIAL_CAMERA.pitch;
                }
                panRef.current = { x: 0, y: 0 };
                return !current;
              });
            }}
          >
            {flat ? "3D" : "2D"}
          </OverlayButton>
          <OverlayButton
            aria-pressed={!drifting}
            className={drifting ? "" : styles.toolActive}
            onClick={() => setDrifting((current) => !current)}
          >
            {drifting ? "Pause" : "Turn"}
          </OverlayButton>
        </div>

        {clusters.map((cluster, index) => (
          <button
            key={cluster.label}
            type="button"
            ref={(element) => {
              labelRefs.current[index] = element;
            }}
            // The same glass button the media overlays use, positioned over the
            // cloud: a name is a control, and it should look like the app's.
            className={[
              overlayButtonStyles.base,
              styles.clusterName,
              chosen === index ? styles.clusterNameChosen : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={chosen === index}
            onClick={() => setChosen((current) => (current === index ? null : index))}
          >
            {cluster.label.replaceAll("_", " ")}
            <span className={styles.clusterCount}>{cluster.count}</span>
          </button>
        ))}

        {Array.from({ length: DRIFTING_TAGS }, (_, slot) => (
          <span
            key={slot}
            ref={(element) => {
              driftingRefs.current[slot] = element;
            }}
            className={styles.driftingTag}
            aria-hidden="true"
          >
            {(driftingTags[slot] ?? "").replaceAll("_", " ")}
          </span>
        ))}

        {/* What the wheel has done, in one number: a cloud with no edges and no
            grid gives a reader nothing else to judge it by. */}
        <p className={styles.zoom} aria-live="off">
          ×{zoom.toFixed(1)}
        </p>

        {count === 0 ? <p className={styles.status}>Arranging the collection…</p> : null}

        {/* Always mounted, so it fades rather than appears. */}
        <figcaption
          ref={captionRef}
          className={[
            styles.caption,
            named ? styles.captionShown : "",
            hovered ? "" : styles.captionQuiet,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden={named ? undefined : true}
        >
          <span>{lastNamed?.album ?? lastNamed?.label ?? ""}</span>
          {(lastNamed?.tags ?? []).slice(0, CAPTION_TAGS).map((tag) => (
            <span key={tag} className={styles.captionTag}>
              {tag.replaceAll("_", " ")}
            </span>
          ))}
        </figcaption>
      </div>

      {selected.length > 0 ? (
        <div className={styles.selection}>
          <p className={styles.selectionSummary}>
            <strong>{selected.length.toLocaleString("en")}</strong> photographs in{" "}
            <span className={styles.selectionTags}>
              {(chosenLabel ?? "this clump").replaceAll("_", " ")}
            </span>
            {selectionTags.length > 0 ? (
              <>
                {" · also "}
                {selectionTags.map((tag) => tag.replaceAll("_", " ")).join(", ")}
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
              onClick={() => setChosen(null)}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

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
