// Persistent, capped diagnostics timeline for the slideshow shell. The point is
// the morning-after read: an unattended kiosk that misbehaves overnight (the OS
// drops the wake lock and the hook fights it, a deploy reboots the runtime
// frame, the network flaps, the tab is backgrounded, or the whole JS loop is
// frozen while the device sleeps) leaves one chronological trail here that
// survives a relaunch, so a field report is debuggable without a live debugger
// attached.
//
// This generalises the older wake-only log into a single event stream with a
// small set of categories the shell already observes — `wake`, `code`,
// `network`, `visibility`, and heartbeat `gap` events. There is ONE storage
// key, ONE cap, and the same tolerant-parse / silent-failure semantics: the log
// is strictly best-effort and must never break the slideshow.
//
// Pure and storage-injectable so the cap/FIFO/tolerant-parse rules are
// unit-tested without a DOM; the shell passes real localStorage.

export type WakeEventType =
  | "acquired" // lock re-acquired after a loss
  | "lost" // system released a held lock
  | "reacquire-failed" // an internal re-acquire attempt was rejected
  | "cap-reached" // gave up the re-acquire fight (hit the retry cap)
  | "cap-decayed"; // decayed the cap after a quiet gap and retried

export type CodeEventType =
  | "reload" // a runtime reload was actually executed toward a target build
  | "retry-cap-reached" // the runtime reload retry budget was exhausted
  | "version-skew"; // the running frame reported a build behind the target

export type NetworkEventType = "online" | "offline";

export type VisibilityEventType = "visible" | "hidden";

export type GapEventType = "gap"; // the JS loop was frozen/asleep between beats

// `count`/`lastAt` appear when consecutive identical events coalesce into one
// entry: `at` keeps the ONSET time (the forensic anchor), `lastAt` the most
// recent repeat. Without coalescing, a night of once-a-minute failures would
// evict the whole capped log and destroy the onset evidence by morning.
type Coalesced = { count?: number; lastAt?: number };

export type ShellLogEntry =
  | ({ at: number; category: "wake"; type: WakeEventType } & Coalesced)
  | ({ at: number; category: "code"; type: CodeEventType; version?: string } & Coalesced)
  | ({ at: number; category: "network"; type: NetworkEventType } & Coalesced)
  | ({ at: number; category: "visibility"; type: VisibilityEventType } & Coalesced)
  | { at: number; category: "gap"; type: GapEventType; durationMs: number };

// The input to a record call: an entry minus its timestamp (the log stamps it).
export type ShellLogInput =
  | { category: "wake"; type: WakeEventType }
  | { category: "code"; type: CodeEventType; version?: string }
  | { category: "network"; type: NetworkEventType }
  | { category: "visibility"; type: VisibilityEventType }
  | { category: "gap"; type: GapEventType; durationMs: number };

export const SHELL_LOG_STORAGE_KEY = "slideshow-event-log";
// Keep the tail small: enough to reconstruct a night's incident across several
// categories, bounded so a long-running kiosk never grows the entry unboundedly.
export const SHELL_LOG_MAX_ENTRIES = 80;

// A single rolling key overwritten every beat — NOT part of the event log, so a
// days-long kiosk writes O(1) storage per minute rather than an ever-growing
// trail. Read on mount / resume to detect a frozen gap.
export const HEARTBEAT_STORAGE_KEY = "slideshow-heartbeat";
export const HEARTBEAT_INTERVAL_MS = 60000;
// A gap wider than this since the last beat means the JS loop was not running in
// between — the device slept or the tab was frozen — as opposed to running but
// with the wake lock refused. That distinction is the key forensic ambiguity.
export const HEARTBEAT_GAP_THRESHOLD_MS = 90000;

const KNOWN_TYPES: Record<ShellLogEntry["category"], ReadonlySet<string>> = {
  wake: new Set<WakeEventType>([
    "acquired",
    "lost",
    "reacquire-failed",
    "cap-reached",
    "cap-decayed",
  ]),
  code: new Set<CodeEventType>(["reload", "retry-cap-reached", "version-skew"]),
  network: new Set<NetworkEventType>(["online", "offline"]),
  visibility: new Set<VisibilityEventType>(["visible", "hidden"]),
  gap: new Set<GapEventType>(["gap"]),
};

const isShellLogEntry = (value: unknown): value is ShellLogEntry => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) {
    return false;
  }
  if (typeof entry.category !== "string" || !(entry.category in KNOWN_TYPES)) {
    return false;
  }
  const category = entry.category as ShellLogEntry["category"];
  if (typeof entry.type !== "string" || !KNOWN_TYPES[category].has(entry.type)) {
    return false;
  }
  // A gap entry is only meaningful with a finite duration.
  if (
    category === "gap" &&
    (typeof entry.durationMs !== "number" || !Number.isFinite(entry.durationMs))
  ) {
    return false;
  }
  return true;
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

export const readShellLog = (storage: Storage | null = defaultStorage()): ShellLogEntry[] => {
  if (!storage) {
    return [];
  }
  let raw: string | null;
  try {
    raw = storage.getItem(SHELL_LOG_STORAGE_KEY);
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
    return parsed.filter(isShellLogEntry).slice(-SHELL_LOG_MAX_ENTRIES);
  } catch {
    return [];
  }
};

// Append one event, FIFO-capped. Reads-modifies-writes through storage so no
// caller holds the log array between events. Returns the new (already sliced)
// log so the caller can render the tail without a re-read. Storage failures
// (private mode, quota) are swallowed — best-effort only.
export const appendShellEvent = (
  input: ShellLogInput,
  at: number = Date.now(),
  storage: Storage | null = defaultStorage(),
): ShellLogEntry[] => {
  const entry = { at, ...input } as ShellLogEntry;
  const existing = readShellLog(storage);
  const matches = (candidate: ShellLogEntry): boolean =>
    input.category !== "gap" &&
    candidate.category === input.category &&
    candidate.type === input.type &&
    (candidate.category !== "code" ||
      (candidate as { version?: string }).version === (input as { version?: string }).version);
  // Coalesce a repeat of the newest entry (same category, type, and version)
  // rather than appending — gap entries always stand alone so each freeze
  // keeps its own duration. The wake retry CYCLE (failed attempts, cap, decay,
  // repeat) additionally coalesces through its own siblings: a pure-rejection
  // night otherwise appends one alternating triple per decay cycle and evicts
  // the onset evidence after ~6 hours; looking back through cycle-type entries
  // keeps a whole night at one entry per cycle type.
  const isWakeCycleType = (candidate: ShellLogEntry): boolean =>
    candidate.category === "wake" &&
    (candidate.type === "reacquire-failed" ||
      candidate.type === "cap-reached" ||
      candidate.type === "cap-decayed");
  let mergeIndex = -1;
  for (let i = existing.length - 1; i >= 0 && i >= existing.length - 3; i--) {
    const candidate = existing[i];
    // invariant: i stays within existing bounds, so candidate is defined
    if (candidate === undefined) continue;
    if (matches(candidate)) {
      mergeIndex = i;
      break;
    }
    // Only reach past the newest entry when both the new input and the entry
    // being skipped belong to the retry cycle.
    if (!(entry.category === "wake" && isWakeCycleType(entry) && isWakeCycleType(candidate))) {
      break;
    }
  }
  const next =
    mergeIndex >= 0
      ? existing.map((candidate, i) =>
          i === mergeIndex
            ? ({
                ...candidate,
                count: ((candidate as Coalesced).count ?? 1) + 1,
                lastAt: at,
              } as ShellLogEntry)
            : candidate,
        )
      : [...existing, entry].slice(-SHELL_LOG_MAX_ENTRIES);
  if (storage) {
    try {
      storage.setItem(SHELL_LOG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort only.
    }
  }
  return next;
};

// --- Heartbeat --------------------------------------------------------------

export const readHeartbeat = (storage: Storage | null = defaultStorage()): number | null => {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(HEARTBEAT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

export const writeHeartbeat = (
  at: number = Date.now(),
  storage: Storage | null = defaultStorage(),
): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(HEARTBEAT_STORAGE_KEY, String(at));
  } catch {
    // Best-effort only.
  }
};

// Given the last persisted beat and the current time, return the gap duration in
// ms if it exceeds the freeze threshold (so the caller records a "not running"
// event), or null otherwise — including the first-ever launch with no prior beat.
export const detectHeartbeatGap = (previous: number | null, now: number): number | null => {
  if (previous === null || !Number.isFinite(previous)) {
    return null;
  }
  const gap = now - previous;
  return gap > HEARTBEAT_GAP_THRESHOLD_MS ? gap : null;
};

// --- Status snapshot --------------------------------------------------------

// The shell's live state lives in its own React tree, which the full-page
// diagnostics view cannot see (it replaces the shell document rather than
// running beside it). The shell therefore mirrors a small snapshot into storage
// whenever the state changes, so the report page can show what the kiosk
// believed a moment ago — stamped with `at`, so a stale snapshot reads as stale
// rather than as current truth.
export const SHELL_STATUS_STORAGE_KEY = "slideshow-shell-status";

export type ShellStatusSnapshot = {
  at: number;
  sessionStart: number;
  shellVersion: string;
  runtimeVersion: string;
  codeStatus: string;
  online: boolean;
  wake: { supported: boolean; active: boolean; losses: number };
};

const isShellStatusSnapshot = (value: unknown): value is ShellStatusSnapshot => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = value as Record<string, unknown>;
  const wake = status.wake as Record<string, unknown> | undefined;
  return (
    typeof status.at === "number" &&
    Number.isFinite(status.at) &&
    typeof status.sessionStart === "number" &&
    typeof status.shellVersion === "string" &&
    typeof status.runtimeVersion === "string" &&
    typeof status.codeStatus === "string" &&
    typeof status.online === "boolean" &&
    typeof wake === "object" &&
    wake !== null &&
    typeof wake.supported === "boolean" &&
    typeof wake.active === "boolean" &&
    typeof wake.losses === "number"
  );
};

export const readShellStatus = (
  storage: Storage | null = defaultStorage(),
): ShellStatusSnapshot | null => {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(SHELL_STATUS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isShellStatusSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeShellStatus = (
  status: ShellStatusSnapshot,
  storage: Storage | null = defaultStorage(),
): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SHELL_STATUS_STORAGE_KEY, JSON.stringify(status));
  } catch {
    // Best-effort only.
  }
};

// --- Describe / serialise ---------------------------------------------------

const shortVersion = (version: string): string => version.slice(0, 8);

// Plain en-GB duration phrasing for a heartbeat gap, e.g. "2 hours 14 minutes".
export const formatGapDuration = (ms: number): string => {
  const safeMs = Math.max(0, ms);
  if (safeMs < 60000) {
    const seconds = Math.max(1, Math.round(safeMs / 1000));
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const totalMinutes = Math.round(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" ") : `${totalMinutes} minutes`;
};

// British-English short label for one timeline entry, per category.
export const describeShellEvent = (entry: ShellLogEntry): string => {
  const count = entry.category === "gap" ? undefined : entry.count;
  const base = describeShellEventBase(entry);
  return count !== undefined && count > 1 ? `${base} (×${count})` : base;
};

const describeShellEventBase = (entry: ShellLogEntry): string => {
  switch (entry.category) {
    case "wake":
      switch (entry.type) {
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
    case "code":
      switch (entry.type) {
        case "reload":
          return entry.version
            ? `Reloaded code to ${shortVersion(entry.version)}`
            : "Reloaded code";
        case "retry-cap-reached":
          return "Update retries exhausted";
        case "version-skew":
          return entry.version
            ? `Version skew (running ${shortVersion(entry.version)})`
            : "Version skew detected";
      }
    case "network":
      return entry.type === "online" ? "Came online" : "Went offline";
    case "visibility":
      return entry.type === "visible" ? "Returned to view" : "Hidden from view";
    case "gap":
      return `Page was not running for ${formatGapDuration(entry.durationMs)}`;
  }
  // Unreachable for well-formed entries; keeps the switch total for the compiler.
  return "Unknown event";
};

// Short category tag for grouping in the copied report.
const categoryLabel = (category: ShellLogEntry["category"]): string => {
  switch (category) {
    case "wake":
      return "wake";
    case "code":
      return "code";
    case "network":
      return "network";
    case "visibility":
      return "view";
    case "gap":
      return "gap";
  }
};

export type DiagnosticsReport = {
  now: number;
  sessionStart: number;
  buildVersion: string;
  runtimeVersion: string;
  codeStatus: string;
  wake: { supported: boolean; active: boolean; losses: number };
  online: boolean;
  device: {
    userAgent: string;
    standalone: boolean;
    screen: { width: number; height: number };
    devicePixelRatio: number;
  };
  log: ShellLogEntry[];
};

// Build the on-demand copy payload as a single readable text block. Pure: all
// device/runtime context is passed in, gathered transiently by the click
// handler, so nothing is retained between copies.
export const serialiseDiagnostics = (report: DiagnosticsReport): string => {
  const iso = (at: number) => new Date(at).toISOString();
  const wakeState = report.wake.supported ? (report.wake.active ? "active" : "off") : "unsupported";
  const lines = [
    `Slideshow diagnostics — ${iso(report.now)}`,
    `Session started: ${iso(report.sessionStart)}`,
    `Shell build: ${report.buildVersion}`,
    `Runtime build: ${report.runtimeVersion}`,
    `Code status: ${report.codeStatus}`,
    `Wake lock: ${wakeState} (losses: ${report.wake.losses})`,
    `Network: ${report.online ? "online" : "offline"}`,
    `User agent: ${report.device.userAgent}`,
    `Standalone: ${report.device.standalone ? "yes" : "no"}`,
    `Screen: ${report.device.screen.width}×${report.device.screen.height} @${report.device.devicePixelRatio}x`,
    "",
    `Event history (${report.log.length}):`,
    ...(report.log.length > 0
      ? report.log.map((entry) => {
          const lastAt = entry.category === "gap" ? undefined : entry.lastAt;
          // A coalesced entry spans onset..lastAt; the span end is the datum a
          // morning-after read needs to know when the episode stopped.
          const span = lastAt !== undefined && lastAt !== entry.at ? ` until ${iso(lastAt)}` : "";
          return `${iso(entry.at)}${span}  [${categoryLabel(entry.category)}] ${describeShellEvent(entry)}`;
        })
      : ["(no events recorded)"]),
  ];
  return lines.join("\n");
};
