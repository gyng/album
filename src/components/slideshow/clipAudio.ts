// Sound for a clip slide: the volume ramp across a cross-fade, whether the
// browser lets a page set a volume at all, and the length shown on the chip.

type VolumeTarget = { volume: number };

const RAMP_STEP_MS = 25;

/**
 * Move an element's volume to `to` over `durationMs`, then call `onDone`.
 *
 * On a timer rather than animation frames: a hidden or throttled frame stops
 * delivering frames, and an outgoing clip waiting on one would play on under
 * the next slide. Returns a cancel that leaves the volume where it got to.
 */
export const rampMediaVolume = (
  element: VolumeTarget,
  to: number,
  durationMs: number,
  onDone?: () => void,
): (() => void) => {
  const from = element.volume;
  if (durationMs <= 0 || Math.abs(from - to) < 0.001) {
    element.volume = to;
    onDone?.();
    return () => {};
  }
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    element.volume = Math.min(1, Math.max(0, from + (to - from) * progress));
    if (progress >= 1) {
      clearInterval(timer);
      element.volume = to;
      onDone?.();
    }
  }, RAMP_STEP_MS);
  return () => clearInterval(timer);
};

/**
 * Whether a page-set volume takes effect. On iOS and iPadOS
 * `HTMLMediaElement.volume` accepts a write and goes on reporting 1 — the
 * hardware buttons own it — so a slider there moves and changes nothing.
 */
export const canSetMediaVolume = (
  createElement: () => VolumeTarget = () => document.createElement("video"),
): boolean => {
  try {
    const probe = createElement();
    probe.volume = 0.5;
    return Math.abs(probe.volume - 0.5) < 0.01;
  } catch {
    return true;
  }
};

export const formatClipDuration = (seconds: number | undefined): string | null => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0.5) return null;
  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
};
