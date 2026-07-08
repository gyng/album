import {
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  SiglipTextModel,
  SiglipVisionModel,
  env,
} from "@huggingface/transformers";

// One worker entry serves BOTH the text and the vision encoder. It must stay a
// single file: with two near-identical sibling worker entries, Turbopack
// cross-wired the `new Worker(new URL(...))` bindings in the production build —
// each client constructed the other's worker (verified live: an image request
// got "Unknown text embedding worker request." back, in both directions).
// Each model still lazy-loads on first use, so a text-only session never pays
// for the vision tower and vice versa.

type EmbeddingWorkerRequest =
  | { id: number; type: "warmup" }
  | { id: number; type: "encode"; text: string }
  | { id: number; type: "encode-image"; blob: Blob };

type WorkerProgressDetails = {
  loaded: number;
  total: number;
  file?: string;
};

type TransformersProgressInfo =
  | {
      status: "progress";
      file: string;
      progress: number;
      loaded: number;
      total: number;
    }
  | {
      status: "download" | "done" | "initiate" | "ready";
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    };

const loadingRequestIds = new Set<number>();

// Both towers must stay in the SigLIP v1 space — image and text query vectors
// are ranked against the DB's `google/siglip-base-patch16-224` embeddings.
const MODEL_ID = "Xenova/siglip-base-patch16-224";
const MAX_TEXT_LENGTH = 64;

let textRuntimePromise: Promise<{
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof SiglipTextModel.from_pretrained>>;
}> | null = null;

let visionRuntimePromise: Promise<{
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof SiglipVisionModel.from_pretrained>>;
}> | null = null;

type WebGpuNavigator = Navigator & {
  gpu?: { requestAdapter?: () => Promise<unknown | null> };
};

// Prefer WebGPU when a usable adapter is actually available; some environments
// (Linux Chrome without GPU flags, VMs, blocklisted GPUs) expose navigator.gpu
// but fail to hand out an adapter, which would otherwise crash the model load
// with "Failed to get GPU adapter" and no fallback.
const getDevice = async (): Promise<"webgpu" | "wasm"> => {
  const scope = self as typeof self & { navigator?: WebGpuNavigator };
  const gpu = scope.navigator?.gpu;

  if (!gpu?.requestAdapter) {
    return "wasm";
  }

  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
};

const normalizeVector = (values: Float32Array | number[]): number[] => {
  let norm = 0;
  for (let idx = 0; idx < values.length; idx += 1) {
    const value = values[idx] ?? 0;
    norm += value * value;
  }

  if (norm === 0) {
    return Array.from(values);
  }

  const magnitude = Math.sqrt(norm);
  return Array.from(values, (value) => value / magnitude);
};

const postLoadProgress = (
  progress: number,
  stage: string,
  details?: WorkerProgressDetails,
): void => {
  const requestIds = Array.from(loadingRequestIds);
  for (let idx = 0; idx < requestIds.length; idx += 1) {
    const requestId = requestIds[idx];
    if (typeof requestId !== "number") {
      continue;
    }

    self.postMessage({ id: requestId, progress, stage, details });
  }
};

const reportProgress = (
  phaseStart: number,
  phaseSpan: number,
  phaseLabel: string,
  info: TransformersProgressInfo,
) => {
  if (info.status !== "progress") {
    return;
  }

  const overallProgress = phaseStart + (info.progress / 100) * phaseSpan;
  postLoadProgress(overallProgress, `${phaseLabel} (${info.file})`, {
    loaded: info.loaded,
    total: info.total,
    file: info.file,
  });
};

// A WebGPU adapter can still vanish between probe and model init — fall back
// to the WASM backend rather than killing search for the session.
const loadModelWithFallback = async <T>(
  loadModel: (device: "webgpu" | "wasm") => Promise<T>,
  label: string,
): Promise<T> => {
  const device = await getDevice();
  try {
    return await loadModel(device);
  } catch (error) {
    if (device === "webgpu") {
      console.warn(`WebGPU ${label} load failed, retrying on WASM backend`, error);
      return await loadModel("wasm");
    }
    throw error;
  }
};

const trackLoading = async <T>(
  requestId: number | undefined,
  load: () => Promise<T>,
): Promise<T> => {
  if (typeof requestId === "number") {
    loadingRequestIds.add(requestId);
  }

  try {
    return await load();
  } finally {
    if (typeof requestId === "number") {
      loadingRequestIds.delete(requestId);
    }
  }
};

const loadTextRuntime = async (requestId?: number) =>
  trackLoading(requestId, async () => {
    if (!textRuntimePromise) {
      env.allowLocalModels = false;

      textRuntimePromise = (async () => {
        postLoadProgress(5, "Starting model load");
        const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
          progress_callback: (info: TransformersProgressInfo) => {
            reportProgress(5, 30, "Loading tokenizer", info);
          },
        });
        postLoadProgress(35, "Tokenizer ready");

        const model = await loadModelWithFallback(
          (device) =>
            SiglipTextModel.from_pretrained(MODEL_ID, {
              device,
              dtype: "q4",
              progress_callback: (info: TransformersProgressInfo) => {
                reportProgress(35, 60, "Loading text model", info);
              },
            }),
          "text model",
        );

        postLoadProgress(95, "Search model ready");
        return { tokenizer, model };
      })();
    }

    try {
      const runtime = await textRuntimePromise;
      postLoadProgress(100, "Search model ready");
      return runtime;
    } catch (error) {
      // Reset so a later attempt can retry — otherwise a single transient
      // download/init failure permanently kills semantic search for the session.
      textRuntimePromise = null;
      throw error;
    }
  });

const loadVisionRuntime = async (requestId?: number) =>
  trackLoading(requestId, async () => {
    if (!visionRuntimePromise) {
      env.allowLocalModels = false;

      visionRuntimePromise = (async () => {
        postLoadProgress(5, "Starting image model load");
        const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: (info: TransformersProgressInfo) => {
            reportProgress(5, 10, "Loading image processor", info);
          },
        });
        postLoadProgress(15, "Image processor ready");

        const model = await loadModelWithFallback(
          (device) =>
            SiglipVisionModel.from_pretrained(MODEL_ID, {
              device,
              // q4 verified against the DB embeddings: 5/5 sample photos
              // re-embedded in-browser ranked themselves #1 of 1495.
              dtype: "q4",
              progress_callback: (info: TransformersProgressInfo) => {
                reportProgress(15, 80, "Loading image model", info);
              },
            }),
          "image model",
        );

        postLoadProgress(95, "Image search model ready");
        return { processor, model };
      })();
    }

    try {
      const runtime = await visionRuntimePromise;
      postLoadProgress(100, "Image search model ready");
      return runtime;
    } catch (error) {
      visionRuntimePromise = null;
      throw error;
    }
  });

const encodeText = async (
  text: string,
  requestId: number,
): Promise<number[]> => {
  const { tokenizer, model } = await loadTextRuntime(requestId);
  const modelInputs = tokenizer(text.toLowerCase(), {
    padding: "max_length",
    truncation: true,
    max_length: MAX_TEXT_LENGTH,
  });
  const outputs = await model(modelInputs);
  const embedding = outputs.pooler_output;

  if (!embedding?.data) {
    throw new Error("SigLIP text embedding output was empty.");
  }

  return normalizeVector(embedding.data as Float32Array);
};

const encodeImage = async (blob: Blob, requestId: number): Promise<number[]> => {
  const { processor, model } = await loadVisionRuntime(requestId);
  const image = await RawImage.fromBlob(blob);
  const modelInputs = await processor(image);
  const outputs = await model(modelInputs);
  const embedding = outputs.pooler_output;

  if (!embedding?.data) {
    throw new Error("SigLIP image embedding output was empty.");
  }

  return normalizeVector(embedding.data as Float32Array);
};

self.addEventListener(
  "message",
  async (event: MessageEvent<EmbeddingWorkerRequest>) => {
    const data = event.data;
    const requestId = data.id;

    try {
      if (data.type === "warmup") {
        await loadTextRuntime(requestId);
        self.postMessage({ id: requestId, ok: true });
        return;
      }

      if (data.type === "encode") {
        const vector = await encodeText(data.text, requestId);
        self.postMessage({ id: requestId, ok: true, vector });
        return;
      }

      if (data.type === "encode-image") {
        const vector = await encodeImage(data.blob, requestId);
        self.postMessage({ id: requestId, ok: true, vector });
        return;
      }

      self.postMessage({
        id: requestId,
        ok: false,
        error: "Unknown embedding worker request.",
      });
    } catch (error) {
      self.postMessage({
        id: requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Embedding failed.",
      });
    }
  },
);
