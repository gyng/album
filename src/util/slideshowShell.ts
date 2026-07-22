export const SLIDESHOW_RUNTIME_STATE_MESSAGE = "snapshots:slideshow-ready";
export const SLIDESHOW_EXIT_MESSAGE = "snapshots:slideshow-exit";
export const SLIDESHOW_NAVIGATE_MESSAGE = "snapshots:slideshow-navigate";
export const SLIDESHOW_WAKE_REQUEST_MESSAGE = "snapshots:slideshow-wake-request";
export const SLIDESHOW_SHELL_STATE_MESSAGE = "snapshots:slideshow-shell-state";

export type SlideshowShellWakeState = {
  isSupported: boolean;
  isActive: boolean;
};

export type SlideshowRuntimeStateMessage = {
  type: typeof SLIDESHOW_RUNTIME_STATE_MESSAGE;
  buildVersion: string;
  search?: string;
};

export type SlideshowRuntimeMessage =
  | SlideshowRuntimeStateMessage
  | { type: typeof SLIDESHOW_EXIT_MESSAGE }
  | { type: typeof SLIDESHOW_NAVIGATE_MESSAGE; href: string }
  | { type: typeof SLIDESHOW_WAKE_REQUEST_MESSAGE };

export type SlideshowShellStateMessage = SlideshowShellWakeState & {
  type: typeof SLIDESHOW_SHELL_STATE_MESSAGE;
};

export const isSlideshowRuntimeMessage = (value: unknown): value is SlideshowRuntimeMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SlideshowRuntimeMessage>;
  if (message.type === SLIDESHOW_EXIT_MESSAGE || message.type === SLIDESHOW_WAKE_REQUEST_MESSAGE) {
    return true;
  }
  if (message.type === SLIDESHOW_NAVIGATE_MESSAGE) {
    return (
      "href" in message &&
      typeof message.href === "string" &&
      message.href.startsWith("/") &&
      !message.href.startsWith("//") &&
      !message.href.includes("\\")
    );
  }
  return (
    message.type === SLIDESHOW_RUNTIME_STATE_MESSAGE &&
    "buildVersion" in message &&
    typeof message.buildVersion === "string" &&
    message.buildVersion.trim().length > 0 &&
    (!("search" in message) ||
      typeof message.search === "undefined" ||
      (typeof message.search === "string" &&
        (message.search === "" ||
          (message.search.startsWith("?") && !message.search.includes("#")))))
  );
};

export const isSlideshowShellStateMessage = (
  value: unknown,
): value is SlideshowShellStateMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SlideshowShellStateMessage>;
  return (
    message.type === SLIDESHOW_SHELL_STATE_MESSAGE &&
    typeof message.isSupported === "boolean" &&
    typeof message.isActive === "boolean"
  );
};

export const buildSlideshowRuntimeUrl = (search: string, buildVersion?: string): string => {
  const params = new URLSearchParams(search);
  params.delete("shellVersion");
  params.set("shell", "1");
  if (buildVersion) params.set("shellVersion", buildVersion);
  const query = params.toString();
  return `/slideshow${query ? `?${query}` : ""}`;
};

// A click the browser natively opens in a new tab/window (or is not a plain
// primary-button click). Link handlers that call preventDefault must early-out
// on these so cmd/ctrl/shift/alt-click and middle-click "open in new tab" keep
// working instead of being forced into a same-tab navigation.
export const isModifiedClick = (event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

// Caps how many times the shell will reboot the runtime frame toward a single
// target build before giving up. A version the served bundle can never satisfy
// (CDN skew, or the service worker serving a stale cached /slideshow document)
// otherwise reboots the slideshow on every poll forever.
export const MAX_RUNTIME_RELOAD_ATTEMPTS = 3;
// Base backoff between retries toward the same target; each retry doubles it.
export const RUNTIME_RELOAD_BASE_DELAY_MS = 15000;

export type RuntimeReloadTracker = {
  targetVersion: string;
  // Number of reloads that have actually *executed* toward `targetVersion` — not
  // the number that have merely been planned. The budget is spent by real
  // reloads only, so a kiosk that wakes repeatedly during one backoff window
  // (poll + visibilitychange + online + manual button all call the planner)
  // cannot exhaust the budget without a single frame ever reloading.
  attempts: number;
};

export type RuntimeReloadPlan = {
  shouldReload: boolean;
  delayMs: number;
};

// Decide whether to (re)mount the runtime frame toward `targetVersion`, given
// the reloads already *executed* against it. A changed target resets the budget
// and reloads immediately; retries toward the same target back off with an
// escalating delay; once the executed budget is exhausted it holds (no reload)
// until the target version itself changes. This is a pure read-only decision:
// it never advances the attempt count. The count advances only when a reload
// actually runs — see `recordRuntimeReload`.
export const planRuntimeReload = (
  targetVersion: string,
  previous: RuntimeReloadTracker | null,
): RuntimeReloadPlan => {
  const attempts = previous?.targetVersion === targetVersion ? previous.attempts : 0;
  if (attempts >= MAX_RUNTIME_RELOAD_ATTEMPTS) {
    return { shouldReload: false, delayMs: 0 };
  }
  return {
    shouldReload: true,
    delayMs: attempts === 0 ? 0 : RUNTIME_RELOAD_BASE_DELAY_MS * 2 ** (attempts - 1),
  };
};

// Record that a reload toward `targetVersion` actually executed, advancing the
// attempt count by one (and resetting it when the target changed). Callers must
// invoke this only from the path where the frame is genuinely remounted (the
// immediate-reload branch or the backoff timer callback), never when a reload is
// merely planned or re-planned.
export const recordRuntimeReload = (
  targetVersion: string,
  previous: RuntimeReloadTracker | null,
): RuntimeReloadTracker => {
  const attempts = previous?.targetVersion === targetVersion ? previous.attempts : 0;
  return { targetVersion, attempts: attempts + 1 };
};
