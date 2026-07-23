// Shared plumbing for talking to embedding.worker.ts. Text and image encoding
// MUST go through this single worker entry — see the comment at the top of
// embedding.worker.ts for the Turbopack cross-wiring bug that separate worker
// files triggered.

export type EmbeddingWorkerRequestPayload =
  | { type: "warmup" }
  | { type: "encode"; text: string }
  | { type: "encode-image"; blob: Blob };

type EmbeddingWorkerResponse =
  | { boot: true }
  | { id: number; ok: true; vector?: number[] }
  | { id: number; ok: false; error: string }
  | {
      id: number;
      progress: number;
      stage: string;
      details?: {
        loaded: number;
        total: number;
        file?: string;
      };
    };

const isBootMessage = (response: EmbeddingWorkerResponse): response is { boot: true } =>
  "boot" in response && response.boot === true;

export type ProgressHandler = (
  progress: number,
  stage: string,
  details?: {
    loaded: number;
    total: number;
    file?: string;
  },
) => void;

/**
 * Raised when the worker can no longer be reached — most often because its
 * script or a chunk it lazily imports 404'd after a redeploy, so the worker
 * never emits a single progress event or reply. Distinct from a normal encode
 * failure so the UI can offer a reload instead of a generic "unavailable".
 */
export class EmbeddingWorkerUnavailableError extends Error {
  constructor(message = "The embedding worker is unavailable — the site may have been updated.") {
    super(message);
    this.name = "EmbeddingWorkerUnavailableError";
  }
}

export const isEmbeddingWorkerUnavailable = (error: unknown): boolean =>
  error instanceof EmbeddingWorkerUnavailableError ||
  (error instanceof Error && error.name === "EmbeddingWorkerUnavailableError");

// A boot timeout is RECOVERABLE (a slow network, not a missing script): the
// next request spawns a fresh worker. It must not borrow the permanent
// unavailable classification, whose reload advice would restart the very
// download that was making progress.
export class EmbeddingWorkerSlowStartError extends Error {
  constructor(
    message = "The search engine is taking a while to load — check the connection and try again.",
  ) {
    super(message);
    this.name = "EmbeddingWorkerSlowStartError";
  }
}

export const isEmbeddingWorkerSlowStart = (error: unknown): boolean =>
  error instanceof EmbeddingWorkerSlowStartError ||
  (error instanceof Error && error.name === "EmbeddingWorkerSlowStartError");

// Boot window: time allowed from `new Worker()` until the worker posts its
// top-level boot ack. This must cover downloading and parsing the worker chunk
// itself (~1MB with transformers.js — 20s+ on slow 3G, longer on old-iPad CPUs),
// so it is deliberately generous. Crucially a boot timeout is NOT permanent
// death: a slow network deserves a fresh attempt on the next request.
const BOOT_TIMEOUT_MS = 40000;

// Once the worker has acknowledged boot, a live model download emits its first
// progress event within milliseconds. The per-request first-signal timer is
// armed only AFTER the boot ack, and only until the FIRST signal for that
// request. It exists to catch a worker that booted but then went silent forever
// — e.g. a lazily-imported nested chunk 404'd — leaving the bar stuck at zero.
// It never fires while the worker is merely busy: it declares death only if the
// WHOLE worker has been silent for the window (see lastMessageAt), otherwise it
// re-arms so a >12s synchronous WASM inference for another request is not
// mistaken for a dead worker.
const FIRST_SIGNAL_TIMEOUT_MS = 12000;

type PendingEntry = {
  resolve: (value: number[] | void) => void;
  reject: (reason?: unknown) => void;
  onProgress?: ProgressHandler;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

let worker: Worker | null = null;
// Permanent death: set only for deterministic failures that respawning cannot
// fix — a never-booted entry-script 404 (the same baked-in URL re-404s), or
// post-boot silence past the first-signal window (a nested chunk 404). A boot
// TIMEOUT does not set this, so a slow network can retry.
let workerDead = false;
// Whether the current worker has posted its boot ack. Gates per-request timers.
let workerBooted = false;
// Wall-clock of the most recent message from the worker (boot ack, progress, or
// reply). Lets a per-request timer distinguish "this request stalled" from "the
// worker is alive and busy on another request".
let lastMessageAt = 0;
let bootTimeoutId: ReturnType<typeof setTimeout> | null = null;
let messageId = 0;
const pending = new Map<number, PendingEntry>();

const clearBootTimer = (): void => {
  if (bootTimeoutId !== null) {
    clearTimeout(bootTimeoutId);
    bootTimeoutId = null;
  }
};

const clearPendingTimer = (entry: PendingEntry): void => {
  if (entry.timeoutId !== null) {
    clearTimeout(entry.timeoutId);
    entry.timeoutId = null;
  }
};

// A per-request first-signal timer. On firing it declares the worker dead ONLY
// if the worker as a whole has been silent for the full window; if the worker
// has spoken more recently (e.g. progress for another in-flight request), it is
// busy, not dead — re-arm for just the remaining silence and re-check later.
const armFirstSignalTimer = (entry: PendingEntry, delay: number): void => {
  entry.timeoutId = setTimeout(() => {
    const silentFor = Date.now() - lastMessageAt;
    if (silentFor < FIRST_SIGNAL_TIMEOUT_MS) {
      armFirstSignalTimer(entry, FIRST_SIGNAL_TIMEOUT_MS - silentFor);
      return;
    }
    markWorkerDead();
  }, delay);
};

const rejectAllPending = (error: Error): void => {
  const entries = Array.from(pending.values());
  pending.clear();
  for (let idx = 0; idx < entries.length; idx += 1) {
    const entry = entries[idx]!;
    clearPendingTimer(entry);
    entry.reject(error);
  }
};

// Permanent teardown: reject everything with the unavailable error and prevent
// any future worker from being spun up this session.
const markWorkerDead = (): void => {
  workerDead = true;
  workerBooted = false;
  clearBootTimer();
  rejectAllPending(new EmbeddingWorkerUnavailableError());
  worker?.terminate();
  worker = null;
};

// Non-permanent teardown: reject pending, tear the worker down, but leave the
// door open for a fresh worker on the next request (used for a boot timeout,
// where a slow network — not a missing script — is the likely cause).
const resetWorker = (error: Error): void => {
  workerBooted = false;
  clearBootTimer();
  rejectAllPending(error);
  worker?.terminate();
  worker = null;
};

const ensureWorker = (): Worker => {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Web workers are unavailable in this environment.");
  }

  if (worker) {
    return worker;
  }

  workerBooted = false;
  lastMessageAt = Date.now();

  // One worker-level boot timer, armed at construction. If the worker never
  // acknowledges boot within a generous window the chunk likely never arrived;
  // reject and retire it, but do NOT mark it permanently dead.
  bootTimeoutId = setTimeout(() => {
    resetWorker(new EmbeddingWorkerSlowStartError());
  }, BOOT_TIMEOUT_MS);

  const created = new Worker(new URL("./embedding.worker.ts", import.meta.url));
  worker = created;
  created.addEventListener("message", (event: MessageEvent<EmbeddingWorkerResponse>) => {
    // A message task queued by a worker that has since been retired (boot
    // timeout, post-boot reset) can still dispatch after termination. It must
    // never touch the module state of a REPLACEMENT worker — a stale boot ack
    // would cancel the new worker's boot guard and arm its first-signal timers
    // prematurely, converting a recoverable slow start into permanent death.
    if (worker !== created) {
      return;
    }
    const response = event.data;

    // Every message — including the boot ack — proves the worker is alive right
    // now, so it also feeds the busy-vs-dead heuristic in the request timers.
    lastMessageAt = Date.now();

    // The boot ack (posted at the worker's module top level, no request id)
    // disarms the boot timer and lets per-request first-signal timers begin.
    // Requests received before boot were parked without a timer; arm them now.
    if (isBootMessage(response)) {
      workerBooted = true;
      clearBootTimer();
      for (const entry of pending.values()) {
        if (entry.timeoutId === null) {
          armFirstSignalTimer(entry, FIRST_SIGNAL_TIMEOUT_MS);
        }
      }
      return;
    }

    const handlers = pending.get(response.id);
    if (!handlers) {
      return;
    }

    // The first signal for this request disarms its dead-worker timer.
    clearPendingTimer(handlers);

    if ("progress" in response) {
      handlers.onProgress?.(response.progress, response.stage, response.details);
      return;
    }

    pending.delete(response.id);
    if (response.ok) {
      handlers.resolve(response.vector);
      return;
    }

    handlers.reject(new Error(response.error));
  });

  created.addEventListener("error", (event) => {
    // Same instance guard as the message listener: a retired worker's error
    // must not kill or reset its replacement.
    if (worker !== created) {
      return;
    }
    const error =
      event.error instanceof Error ? event.error : new Error("Embedding worker failed.");

    // An error before the worker ever acknowledged boot is the loudest
    // stale-deploy case: the entry script itself 404'd. Respawning re-fetches
    // the same baked-in URL and 404s again, so classify it as unavailable (the
    // reload copy) AND permanently dead.
    if (!workerBooted) {
      markWorkerDead();
      return;
    }

    // A post-boot error (the worker ran, then a later chunk failed): terminate
    // and drop the reference so the NEXT request spins up a fresh worker instead
    // of posting into a broken one that never replies.
    resetWorker(error);
  });

  return worker;
};

export const sendEmbeddingWorkerRequest = async (
  request: EmbeddingWorkerRequestPayload,
  onProgress?: ProgressHandler,
): Promise<number[] | void> => {
  if (workerDead) {
    throw new EmbeddingWorkerUnavailableError();
  }

  const activeWorker = ensureWorker();
  const id = messageId;
  messageId += 1;

  return await new Promise<number[] | void>((resolve, reject) => {
    const entry: PendingEntry = { resolve, reject, onProgress, timeoutId: null };
    pending.set(id, entry);
    // The first-signal timer arms only once the worker has acknowledged boot;
    // until then the boot timer alone guards liveness, so a slow chunk download
    // is never mistaken for a request that stalled. Requests sent after boot arm
    // immediately; those sent before are armed when the boot ack arrives.
    if (workerBooted) {
      armFirstSignalTimer(entry, FIRST_SIGNAL_TIMEOUT_MS);
    }
    activeWorker.postMessage({ ...request, id });
  });
};
