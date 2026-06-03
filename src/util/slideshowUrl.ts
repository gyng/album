export type SlideshowMode = "random" | "weighted" | "similar";

export type DetailsAlignment = "left" | "center" | "right";

// Parsed view of the slideshow's URL config. Every optional setting is
// `value | null`, where null means "param absent — leave the current state
// untouched", matching the page's `!== null` apply guards.
export type ParsedSlideshowParams = {
  filter: string | null;
  // The explicitly-requested mode (drives setSlideshowMode) — null when the
  // mode param is absent or invalid.
  mode: SlideshowMode | null;
  // The resolved mode (explicit, else the caller's fallback). The random-seed
  // and shuffle-history params are gated on THIS, not on the explicit mode,
  // so they still apply when the mode is left at its persisted default.
  nextMode: SlideshowMode;
  initialPhotoPath: string | null;
  randomSimilar: boolean;
  clock: boolean | null;
  details: boolean | null;
  map: boolean | null;
  cover: boolean | null;
  timeAware: boolean | null;
  remix: boolean | null;
  alignCadence: boolean | null;
  alignment: DetailsAlignment | null;
  delayMs: number | null;
  shuffleHistory: number | null;
};

const TRUTHY = ["1", "true", "yes", "on"];

const parseBool = (value: string | null): boolean | null => {
  if (value === null) return null;
  return TRUTHY.includes(value.toLowerCase());
};

const parseNum = (value: string | null): number | null => {
  if (value === null) return null;
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? null : num;
};

const isMode = (value: string | null): value is SlideshowMode =>
  value === "random" || value === "weighted" || value === "similar";

const isTruthy = (value: string | null): boolean =>
  TRUTHY.includes((value ?? "").toLowerCase());

export const parseSlideshowSearchParams = (
  search: string,
  fallbackMode: SlideshowMode,
): ParsedSlideshowParams => {
  const params = new URLSearchParams(search);

  const mode = isMode(params.get("mode")) ? (params.get("mode") as SlideshowMode) : null;
  const nextMode = mode ?? fallbackMode;

  const initialPhotoPath = params.get("photo") ?? params.get("seed");

  const alignmentParam = params.get("align");
  const alignment: DetailsAlignment | null =
    alignmentParam === "left" ||
    alignmentParam === "center" ||
    alignmentParam === "right"
      ? alignmentParam
      : null;

  const delaySeconds = parseNum(params.get("delay"));
  const delayMs =
    delaySeconds !== null && delaySeconds > 0 ? delaySeconds * 1000 : null;

  const shuffleRaw = parseNum(params.get("shuffle"));
  const shuffleHistory =
    nextMode === "similar" && shuffleRaw !== null && shuffleRaw > 0
      ? shuffleRaw
      : null;

  return {
    filter: params.get("filter") || null,
    mode,
    nextMode,
    initialPhotoPath,
    randomSimilar: nextMode === "similar" && isTruthy(params.get("random")),
    clock: parseBool(params.get("clock")),
    details: parseBool(params.get("details")),
    map: parseBool(params.get("map")),
    cover: parseBool(params.get("cover")),
    timeAware: parseBool(params.get("time")),
    remix: parseBool(params.get("remix")),
    alignCadence: parseBool(params.get("align_cadence")),
    alignment,
    delayMs,
    shuffleHistory,
  };
};

// updateSlideshowUrl: rewrite the live URL in place — set mode and delay (as
// SECONDS), drop the one-shot photo/seed params, and PRESERVE every other
// param (filter, clock, …) the user may have set. Returns the new href.
export const applySlideshowUrlState = (
  currentHref: string,
  opts: { mode: SlideshowMode; delayMs: number },
): string => {
  const url = new URL(currentHref);
  url.searchParams.set("mode", opts.mode);
  url.searchParams.set("delay", String(opts.delayMs / 1000));
  url.searchParams.delete("photo");
  url.searchParams.delete("seed");
  return url.toString();
};

// getCurrentPhotoLink: a fresh /slideshow permalink to a specific photo (no
// delay; optional album filter).
export const buildSlideshowPermalink = (opts: {
  origin: string;
  mode: SlideshowMode;
  photoPath: string;
  filter?: string;
}): string => {
  const url = new URL("/slideshow", opts.origin);
  url.searchParams.set("mode", opts.mode);
  if (opts.filter) {
    url.searchParams.set("filter", opts.filter);
  }
  url.searchParams.set("photo", opts.photoPath);
  return url.toString();
};
