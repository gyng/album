type TextEmbeddingWorkerRequest =
  | { id: number; type: "encode"; text: string }
  | { id: number; type: "warmup" };

type TextEmbeddingWorkerRequestPayload =
  | { type: "encode"; text: string }
  | { type: "warmup" };

type TextEmbeddingWorkerResponse =
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

type ProgressHandler = (
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

  worker = new Worker(new URL("./textEmbedding.worker.ts", import.meta.url));
  worker.addEventListener(
    "message",
    (event: MessageEvent<TextEmbeddingWorkerResponse>) => {
      const response = event.data;
      const handlers = pending.get(response.id);
      if (!handlers) {
        return;
      }

      if ("progress" in response) {
        handlers.onProgress?.(
          response.progress,
          response.stage,
          response.details,
        );
        return;
      }

      pending.delete(response.id);
      if (response.ok) {
        handlers.resolve(response.vector);
        return;
      }

      handlers.reject(new Error(response.error));
    },
  );

  worker.addEventListener("error", (event) => {
    const error =
      event.error instanceof Error
        ? event.error
        : new Error("Text embedding worker failed.");
    const handlersList = Array.from(pending.values());
    for (let idx = 0; idx < handlersList.length; idx += 1) {
      const handlers = handlersList[idx];
      if (!handlers) {
        continue;
      }
      handlers.reject(error);
    }
    pending.clear();
  });

  return worker;
};

const sendRequest = async (
  request: TextEmbeddingWorkerRequestPayload,
  onProgress?: ProgressHandler,
): Promise<number[] | void> => {
  const activeWorker = ensureWorker();
  const id = messageId;
  messageId += 1;

  return await new Promise<number[] | void>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    activeWorker.postMessage({ ...request, id } as TextEmbeddingWorkerRequest);
  });
};

export const warmupTextEmbeddingModel = async (
  onProgress?: ProgressHandler,
): Promise<void> => {
  await sendRequest({ type: "warmup" }, onProgress);
};

export const encodeSearchText = async (
  text: string,
  onProgress?: ProgressHandler,
): Promise<number[]> => {
  const result = await sendRequest({ type: "encode", text }, onProgress);
  if (!result) {
    throw new Error("Text embedding worker returned no embedding.");
  }

  return result;
};