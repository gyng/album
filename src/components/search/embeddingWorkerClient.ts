// Shared plumbing for talking to embedding.worker.ts. Text and image encoding
// MUST go through this single worker entry — see the comment at the top of
// embedding.worker.ts for the Turbopack cross-wiring bug that separate worker
// files triggered.

export type EmbeddingWorkerRequestPayload =
  | { type: "warmup" }
  | { type: "encode"; text: string }
  | { type: "encode-image"; blob: Blob };

type EmbeddingWorkerResponse =
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

export type ProgressHandler = (
  progress: number,
  stage: string,
  details?: {
    loaded: number;
    total: number;
    file?: string;
  },
) => void;

let worker: Worker | null = null;
let messageId = 0;
const pending = new Map<
  number,
  {
    resolve: (value: number[] | void) => void;
    reject: (reason?: unknown) => void;
    onProgress?: ProgressHandler;
  }
>();

const ensureWorker = (): Worker => {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Web workers are unavailable in this environment.");
  }

  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("./embedding.worker.ts", import.meta.url));
  worker.addEventListener("message", (event: MessageEvent<EmbeddingWorkerResponse>) => {
    const response = event.data;
    const handlers = pending.get(response.id);
    if (!handlers) {
      return;
    }

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

  worker.addEventListener("error", (event) => {
    const error =
      event.error instanceof Error ? event.error : new Error("Embedding worker failed.");
    const handlersList = Array.from(pending.values());
    for (let idx = 0; idx < handlersList.length; idx += 1) {
      const handlers = handlersList[idx];
      handlers.reject(error);
    }
    pending.clear();

    // The worker is dead (e.g. a chunk 404 after a redeploy). Terminate it and
    // drop the module-level reference so the next request spins up a fresh
    // worker instead of posting into a broken one that never replies.
    worker?.terminate();
    worker = null;
  });

  return worker;
};

export const sendEmbeddingWorkerRequest = async (
  request: EmbeddingWorkerRequestPayload,
  onProgress?: ProgressHandler,
): Promise<number[] | void> => {
  const activeWorker = ensureWorker();
  const id = messageId;
  messageId += 1;

  return await new Promise<number[] | void>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    activeWorker.postMessage({ ...request, id });
  });
};
