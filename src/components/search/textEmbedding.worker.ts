import {
  AutoTokenizer,
  SiglipTextModel,
  env,
} from "@huggingface/transformers";

type TextEmbeddingWorkerRequest =
  | { id: number; type: "encode"; text: string }
  | { id: number; type: "warmup" };

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

const MODEL_ID = "Xenova/siglip-base-patch16-224";
const MAX_TEXT_LENGTH = 64;

let runtimePromise: Promise<{
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof SiglipTextModel.from_pretrained>>;
}> | null = null;

const getDevice = (): "webgpu" | "wasm" => {
  const scope = self as typeof self & {
    navigator?: Navigator & { gpu?: unknown };
  };

  return scope.navigator?.gpu ? "webgpu" : "wasm";
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

const loadRuntime = async (requestId?: number) => {
  if (typeof requestId === "number") {
    loadingRequestIds.add(requestId);
  }

  if (!runtimePromise) {
    env.allowLocalModels = false;

    runtimePromise = (async () => {
      postLoadProgress(5, "Starting model load");
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
        progress_callback: (info: TransformersProgressInfo) => {
          reportProgress(5, 30, "Loading tokenizer", info);
        },
      });
      postLoadProgress(35, "Tokenizer ready");
      const model = await SiglipTextModel.from_pretrained(MODEL_ID, {
        device: getDevice(),
        dtype: "q4",
        progress_callback: (info: TransformersProgressInfo) => {
          reportProgress(35, 60, "Loading text model", info);
        },
      });
      postLoadProgress(95, "Search model ready");
      return { tokenizer, model };
    })();
  }

  try {
    const runtime = await runtimePromise;
    postLoadProgress(100, "Search model ready");
    return runtime;
  } finally {
    if (typeof requestId === "number") {
      loadingRequestIds.delete(requestId);
    }

    if (loadingRequestIds.size === 0) {
      loadingRequestIds.clear();
    }
  }
};

const encodeText = async (
  text: string,
  requestId: number,
): Promise<number[]> => {
  const { tokenizer, model } = await loadRuntime(requestId);
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

self.addEventListener(
  "message",
  async (event: MessageEvent<TextEmbeddingWorkerRequest>) => {
    const data = event.data;
    const requestId = data.id;

    try {
      if (data.type === "warmup") {
        await loadRuntime(requestId);
        self.postMessage({ id: requestId, ok: true });
        return;
      }

      if (data.type === "encode") {
        const vector = await encodeText(data.text, requestId);
        self.postMessage({ id: requestId, ok: true, vector });
        return;
      }

      self.postMessage({
        id: requestId,
        ok: false,
        error: "Unknown text embedding worker request.",
      });
    } catch (error) {
      self.postMessage({
        id: requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Text embedding failed.",
      });
    }
  },
);