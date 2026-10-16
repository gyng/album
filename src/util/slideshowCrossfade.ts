// Pure helpers for the slideshow photo cross-fade. The slideshow renders a
// keyed STACK of layers (like a now-playing widget): the newest layer fades in
// once decoded while older layers fade out, each a stable keyed element so an
// advance mid-fade reverses smoothly instead of jumping. The React wiring (rAF
// reveal, decode tracking, transitionend removal) lives in pages/slideshow.

export type SlideCell = {
  path: string;
  src: string;
  /**
   * "video" when this cell is a clip that should play, in place of the still
   * its `src` names. Absent for every photograph — and for a clip whose
   * playback is switched off, whose slide is its poster frame exactly as it was
   * before clips could play at all.
   */
  mediaKind?: "video";
};

export type SlideSnapshot = {
  // Whether the slide is a remix grid (more than one cell).
  remix: boolean;
  // Cells in render order, seed first. Always at least one. `path` keys the
  // remix-grid reveal hook; `src` is what the <img> loads.
  cells: SlideCell[];
};

export type CrossfadeLayer = {
  // Stable identity (the slideKey) — keeps the DOM element across the layer's
  // life so its opacity transition is continuous through in→out reversals.
  key: string;
  slide: SlideSnapshot;
  // true → at/animating-to full opacity (held or fading in); false → fading out
  // or not yet revealed.
  loaded: boolean;
  // A completed swipe stays displaced until this layer is removed. Its exit
  // can finish before the opacity fade, and a new gesture must not centre it.
  exitX?: number;
};

// Build a snapshot of the slide on screen. Drops cells with no src (e.g. async
// remix companions that haven't resolved). Returns null if nothing to show.
export const buildSlideSnapshot = (
  cells: ReadonlyArray<SlideCell | null | undefined>,
): SlideSnapshot | null => {
  const valid = cells.filter((cell): cell is SlideCell => Boolean(cell && cell.src));
  if (valid.length === 0) return null;
  return { remix: valid.length > 1, cells: valid };
};

// One cell's part of a slide's identity. A playing clip is not the same slide
// as its poster still even though both name the same URL, so the clip marker
// rides along in the key: toggling clip playback cross-fades instead of reusing
// an element of the wrong kind.
const cellKeyOf = (cell: SlideCell): string =>
  cell.mediaKind === "video" ? `${cell.src}#video` : cell.src;

// Stable identity for a slide: its cell keys joined. Changes on a normal
// advance, when a single photo gains async remix companions, and when a cell
// swaps between a still and a clip — so all three push a fresh layer.
export const slideKeyOf = (snapshot: SlideSnapshot | null): string | null =>
  snapshot ? snapshot.cells.map(cellKeyOf).join("|") : null;

// Whether the incoming (top) slide has fully decoded and may be revealed. A
// single slide gates on its one image; a remix grid gates on EVERY cell so the
// grid appears all at once rather than popping in cell by cell.
export const isIncomingReady = (input: {
  isRemix: boolean;
  imageLoaded: boolean;
  remixGridReady: boolean;
}): boolean => (input.isRemix ? input.remixGridReady : input.imageLoaded);

// Keep the stack bounded: the top layer plus the most recent still-visible
// layer beneath it (the backdrop being cross-faded over). Drops never-shown
// intermediates so rapid advances neither pile up nor strand a blank backdrop.
const cap = (layers: CrossfadeLayer[]): CrossfadeLayer[] => {
  if (layers.length <= 2) return layers;
  const top = layers[layers.length - 1];
  if (top === undefined) return layers;
  let backdrop: CrossfadeLayer | null = null;
  for (let i = layers.length - 2; i >= 0; i--) {
    const layer = layers[i];
    if (layer?.loaded) {
      backdrop = layer;
      break;
    }
  }
  return backdrop ? [backdrop, top] : [top];
};

// Push the new current slide as the top layer (hidden, fading in next). If the
// top already has this key, just refresh its snapshot (companions resolved).
export const pushLayer = (
  layers: CrossfadeLayer[],
  key: string,
  slide: SlideSnapshot,
): CrossfadeLayer[] => {
  const top = layers[layers.length - 1];
  if (top && top.key === key) {
    return layers.map((layer) => (layer.key === key ? { ...layer, slide } : layer));
  }
  // Backtracking must move the existing keyed DOM layer, not mount a second
  // copy of it. Keep its reveal state so returning before decode never blanks
  // the photograph that was already visible. Do not carry its old exitX:
  // returning to this photograph makes it the centred current slide again.
  const existing = layers.find((layer) => layer.key === key);
  return cap([
    ...layers.filter((layer) => layer.key !== key),
    { key, slide, loaded: existing?.loaded ?? false },
  ]);
};

// Reveal the layer with `key` (loaded) and start fading out every other layer —
// the cross-fade.
export const revealLayers = (layers: CrossfadeLayer[], key: string): CrossfadeLayer[] =>
  layers.map((layer) => ({ ...layer, loaded: layer.key === key }));

// Remove a layer that has finished fading out (called from its transitionend).
export const removeLayer = (layers: CrossfadeLayer[], key: string): CrossfadeLayer[] =>
  layers.filter((layer) => layer.key !== key);
