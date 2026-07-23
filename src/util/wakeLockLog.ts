// Persistent, capped event log for the slideshow's screen wake lock. The point
// is the morning-after read: an overnight kiosk incident (the OS drops the lock,
// the hook fights it, gives up, then decays and retries) leaves a trail here
// that survives a relaunch, so a field report is debuggable without a live
// debugger attached. Pure and storage-injectable so the cap/FIFO/tolerant-parse
// rules are unit-tested without a DOM; the shell passes real localStorage.

export type WakeLogEventType =
  | "acquired" // lock re-acquired after a loss
  | "lost" // system released a held lock
  | "reacquire-failed" // an internal re-acquire attempt was rejected
  | "cap-reached" // gave up the re-acquire fight (hit the retry cap)
  | "cap-decayed"; // decayed the cap after a quiet gap and retried

export type WakeLogEntry = {
  at: number; // epoch milliseconds
  type: WakeLogEventType;
};

export const WAKE_LOG_STORAGE_KEY = "slideshow-wake-log";
// Keep the tail small: enough to reconstruct a night's incident, bounded so a
// long-running kiosk never grows the entry unboundedly.
export const WAKE_LOG_MAX_ENTRIES = 50;

const KNOWN_TYPES = new Set<WakeLogEventType>([
  "acquired",
  "lost",
  "reacquire-failed",
  "cap-reached",
  "cap-decayed",
]);

const isWakeLogEntry = (value: unknown): value is WakeLogEntry => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === "number" &&
    Number.isFinite(entry.at) &&
    typeof entry.type === "string" &&
    KNOWN_TYPES.has(entry.type as WakeLogEventType)
  );
};

// Resolve localStorage defensively — accessing `window.localStorage` throws in
// some privacy modes, and `window` is absent outside a browser.
const defaultStorage = (): Storage | null => {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readWakeLog = (storage: Storage | null = defaultStorage()): WakeLogEntry[] => {
  if (!storage) {
    return [];
  }
  let raw: string | null;
  try {
    raw = storage.getItem(WAKE_LOG_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isWakeLogEntry).slice(-WAKE_LOG_MAX_ENTRIES);
  } catch {
    return [];
  }
};

// Append one event, FIFO-capped. Returns the new log so the caller can render
// without a re-read. Storage write failures (private mode, quota) are swallowed
// — the log is strictly best-effort and must never break the slideshow.
export const appendWakeEvent = (
  type: WakeLogEventType,
  at: number = Date.now(),
  storage: Storage | null = defaultStorage(),
): WakeLogEntry[] => {
  const next = [...readWakeLog(storage), { at, type }].slice(-WAKE_LOG_MAX_ENTRIES);
  if (storage) {
    try {
      storage.setItem(WAKE_LOG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort only.
    }
  }
  return next;
};

// British-English label for the diagnostics "Wake history" disclosure.
export const describeWakeEvent = (type: WakeLogEventType): string => {
  switch (type) {
    case "acquired":
      return "Screen lock re-acquired";
    case "lost":
      return "Screen lock lost";
    case "reacquire-failed":
      return "Re-acquire attempt failed";
    case "cap-reached":
      return "Gave up retrying";
    case "cap-decayed":
      return "Retrying after a quiet spell";
  }
};
