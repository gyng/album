// Pure helpers for the slideshow photo cross-fade. The slideshow renders a
// keyed STACK of layers (like a now-playing widget): the newest layer fades in
// once decoded while older layers fade out, each a stable keyed element so an
// advance mid-fade reverses smoothly instead of jumping. The React wiring (rAF
// reveal, decode tracking, transitionend removal) lives in pages/slideshow.

export type SlideCell = { path: string; src: string };

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
};

// Build a snapshot of the slide on screen. Drops cells with no src (e.g. async
// remix companions that haven't resolved). Returns null if nothing to show.
export const buildSlideSnapshot = (
  cells: ReadonlyArray<SlideCell | null | undefined>,
): SlideSnapshot | null => {
  const valid = cells.filter(
    (cell): cell is SlideCell => Boolean(cell && cell.src),
  );
  if (valid.length === 0) return null;
  return { remix: valid.length > 1, cells: valid };
};

// Stable identity for a slide: its cell srcs joined. Changes on a normal
// advance AND when a single photo gains async remix companions, so both push a
// fresh layer and cross-fade.
export const slideKeyOf = (snapshot: SlideSnapshot | null): string | null =>
  snapshot ? snapshot.cells.map((cell) => cell.src).join("|") : null;

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
  let backdrop: CrossfadeLayer | null = null;
  for (let i = layers.length - 2; i >= 0; i--) {
    if (layers[i].loaded) {
      backdrop = layers[i];
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
    return layers.map((layer) =>
      layer.key === key ? { ...layer, slide } : layer,
    );
  }
  return cap([...layers, { key, slide, loaded: false }]);
};

// Reveal the layer with `key` (loaded) and start fading out every other layer —
// the cross-fade.
export const revealLayers = (
  layers: CrossfadeLayer[],
  key: string,
): CrossfadeLayer[] =>
  layers.map((layer) => ({ ...layer, loaded: layer.key === key }));

// Remove a layer that has finished fading out (called from its transitionend).
export const removeLayer = (
  layers: CrossfadeLayer[],
  key: string,
): CrossfadeLayer[] => layers.filter((layer) => layer.key !== key);
