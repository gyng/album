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
  // Play a clip's video in place of its poster frame. null when absent.
  clips: boolean | null;
  // Start clips muted. null when absent.
  muted: boolean | null;
  // Loop a clip for as long as its slide lasts, instead of playing it once.
  // null when absent.
  loop: boolean | null;
  // Clip playback volume, 0..1 (an out-of-range or unparseable value is null,
  // i.e. absent — leave the persisted volume alone). null when absent.
  volume: number | null;
  // A free-text topic to seed the semantic similar-mode flow from. null when
  // the param is absent or blank.
  topic: string | null;
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

const isTruthy = (value: string | null): boolean => TRUTHY.includes((value ?? "").toLowerCase());

// A volume is a normalised 0..1, not an integer, so `parseNum` (which truncates
// to an int) cannot be used here. Anything outside the range, or unparseable,
// is treated as absent rather than clamped: a caller that meant 0.25 should not
// get 1 because it typed "25".
const parseVolume = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) return null;
  return volume;
};

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
    alignmentParam === "left" || alignmentParam === "center" || alignmentParam === "right"
      ? alignmentParam
      : null;

  const delaySeconds = parseNum(params.get("delay"));
  const delayMs = delaySeconds !== null && delaySeconds > 0 ? delaySeconds * 1000 : null;

  const shuffleRaw = parseNum(params.get("shuffle"));
  const shuffleHistory =
    nextMode === "similar" && shuffleRaw !== null && shuffleRaw > 0 ? shuffleRaw : null;

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
    clips: parseBool(params.get("clips")),
    muted: parseBool(params.get("muted")),
    loop: parseBool(params.get("loop")),
    volume: parseVolume(params.get("volume")),
    topic: params.get("topic")?.trim() || null,
  };
};

// updateSlideshowUrl: rewrite the live URL in place — set mode and delay (as
// SECONDS), drop the one-shot photo/seed params, and PRESERVE every other
// param (filter, clock, …) the user may have set. Returns the new href.
//
// `topic` is tri-state: omit it (undefined) to preserve any existing topic
// param — the common case, since the frequent mode/delay writes must not drop
// an active topic; pass a string to set it (seeding); pass null to delete it
// (dismissing).
export const applySlideshowUrlState = (
  currentHref: string,
  opts: { mode: SlideshowMode; delayMs: number; topic?: string | null },
): string => {
  const url = new URL(currentHref);
  url.searchParams.set("mode", opts.mode);
  url.searchParams.set("delay", String(opts.delayMs / 1000));
  url.searchParams.delete("photo");
  url.searchParams.delete("seed");
  if (opts.topic !== undefined) {
    if (opts.topic) {
      url.searchParams.set("topic", opts.topic);
    } else {
      url.searchParams.delete("topic");
    }
  }
  return url.toString();
};

// getCurrentPhotoLink: a persistent-shell permalink to a specific photo (no
// delay; optional album filter). Its optional clip settings are written only
// when given, so a caller that has none to say leaves the link silent and the
// recipient's own persisted settings stand.
export const buildSlideshowPermalink = (opts: {
  origin: string;
  mode: SlideshowMode;
  photoPath: string;
  filter?: string;
  topic?: string;
  clips?: boolean;
  muted?: boolean;
  loop?: boolean;
  volume?: number;
}): string => {
  const url = new URL("/slideshow/shell", opts.origin);
  url.searchParams.set("mode", opts.mode);
  if (opts.filter) {
    url.searchParams.set("filter", opts.filter);
  }
  if (opts.topic) {
    url.searchParams.set("topic", opts.topic);
  }
  if (opts.clips !== undefined) {
    url.searchParams.set("clips", opts.clips ? "1" : "0");
  }
  if (opts.muted !== undefined) {
    url.searchParams.set("muted", opts.muted ? "1" : "0");
  }
  if (opts.loop !== undefined) {
    url.searchParams.set("loop", opts.loop ? "1" : "0");
  }
  if (opts.volume !== undefined) {
    url.searchParams.set("volume", String(opts.volume));
  }
  url.searchParams.set("photo", opts.photoPath);
  return url.toString();
};
