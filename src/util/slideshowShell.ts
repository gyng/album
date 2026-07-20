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
