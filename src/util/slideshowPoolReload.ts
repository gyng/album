import { RandomPhotoRow } from "../components/search/api";
import { SlideshowMode } from "./slideshowUrl";

// After the photo pool (re)loads — on first database ready, a filter change, or
// an in-place kiosk DB refresh — history is reset, so SOMETHING must re-commit a
// slide. Otherwise the derived current photo goes null, the page drops to the
// "Preparing slideshow…" boot screen, and the cadence timer (gated on
// hasCurrentPhoto) never re-arms — a permanent freeze until human input.
//
// This pure helper decides that action for the case where there is no
// initial-URL seed and the pool is non-empty; the caller performs the resulting
// commit/advance. The regression it guards against: a similar-mode kiosk that
// had a slide showing when the 10-minute DB poll refreshed the database.
export type PoolReloadAction = { kind: "advance" } | { kind: "recommit"; photo: RandomPhotoRow };

export const decidePoolReloadAction = (input: {
  mode: SlideshowMode;
  hadCurrentPhoto: boolean;
  previousSeedPath: string | null;
  pool: RandomPhotoRow[];
}): PoolReloadAction => {
  // Random/weighted always draw the next slide from their shuffled queue; a cold
  // start (nothing was on screen) advances to the very first slide.
  if (input.mode === "random" || input.mode === "weighted" || !input.hadCurrentPhoto) {
    return { kind: "advance" };
  }

  // Similar mode with a slide already on screen (an in-place DB refresh): keep
  // the trail alive by re-committing the current photo if it survives the new
  // pool, otherwise advance to a fresh seed.
  const surviving = input.previousSeedPath
    ? (input.pool.find((photo) => photo.path === input.previousSeedPath) ?? null)
    : null;
  return surviving ? { kind: "recommit", photo: surviving } : { kind: "advance" };
};
