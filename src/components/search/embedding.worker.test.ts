const mockTokenizerFromPretrained = jest.fn();
const mockTextModelFromPretrained = jest.fn();
const mockProcessorFromPretrained = jest.fn();
const mockVisionModelFromPretrained = jest.fn();
const mockRawImageFromBlob = jest.fn();
const mockEnv: { allowLocalModels?: boolean } = {};

jest.mock("@huggingface/transformers", () => ({
  AutoTokenizer: {
    from_pretrained: (...args: unknown[]) => mockTokenizerFromPretrained(...args),
  },
  SiglipTextModel: {
    from_pretrained: (...args: unknown[]) => mockTextModelFromPretrained(...args),
  },
  AutoProcessor: {
    from_pretrained: (...args: unknown[]) => mockProcessorFromPretrained(...args),
  },
  SiglipVisionModel: {
    from_pretrained: (...args: unknown[]) => mockVisionModelFromPretrained(...args),
  },
  RawImage: {
    fromBlob: (...args: unknown[]) => mockRawImageFromBlob(...args),
  },
  env: mockEnv,
}));

type WorkerHandler = (event: { data: Record<string, unknown> }) => Promise<void>;

const tokenizer = jest.fn();
const textModel = jest.fn();
const processor = jest.fn();
const visionModel = jest.fn();

const loadWorker = (navigator?: unknown) => {
  jest.resetModules();
  let handler: WorkerHandler | null = null;
  const postMessage = jest.fn();
  const workerScope = {
    navigator,
    postMessage,
    addEventListener: jest.fn((_type: string, callback: WorkerHandler) => {
      handler = callback;
    }),
  };
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    writable: true,
    value: workerScope,
  });
  require("./embedding.worker");
  if (!handler) {
    throw new Error("Worker message handler was not registered");
  }
  return { handler: handler as WorkerHandler, postMessage };
};

const progress = (
  status: string,
  value = 50,
): { status: string; progress?: number; loaded?: number; total?: number; file?: string } =>
  status === "progress"
    ? { status, progress: value, loaded: 5, total: 10, file: "model.onnx" }
    : { status };

describe("embedding worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.allowLocalModels = true;
    tokenizer.mockReturnValue({ input_ids: [1] });
    textModel.mockResolvedValue({ pooler_output: { data: new Float32Array([3, 4]) } });
    processor.mockResolvedValue({ pixel_values: [1] });
    visionModel.mockResolvedValue({ pooler_output: { data: new Float32Array([0, 2]) } });
    mockRawImageFromBlob.mockResolvedValue({ width: 10, height: 10 });
    mockTokenizerFromPretrained.mockImplementation(async (_id, options) => {
      options.progress_callback(progress("ready"));
      options.progress_callback(progress("progress", 50));
      return tokenizer;
    });
    mockTextModelFromPretrained.mockImplementation(async (_id, options) => {
      options.progress_callback(progress("progress", 25));
      return textModel;
    });
    mockProcessorFromPretrained.mockImplementation(async (_id, options) => {
      options.progress_callback(progress("progress", 40));
      return processor;
    });
    mockVisionModelFromPretrained.mockImplementation(async (_id, options) => {
      options.progress_callback(progress("progress", 75));
      return visionModel;
    });
  });

  it("warms and caches the text runtime on WASM while reporting progress", async () => {
    const { handler, postMessage } = loadWorker();
    await handler({ data: { id: 1, type: "warmup" } });
    await handler({ data: { id: 2, type: "warmup" } });

    expect(mockEnv.allowLocalModels).toBe(false);
    expect(mockTokenizerFromPretrained).toHaveBeenCalledTimes(1);
    expect(mockTextModelFromPretrained).toHaveBeenCalledWith(
      "Xenova/siglip-base-patch16-224",
      expect.objectContaining({ device: "wasm", dtype: "q4" }),
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, progress: 20, stage: "Loading tokenizer (model.onnx)" }),
    );
    expect(postMessage).toHaveBeenCalledWith({ id: 1, ok: true });
    expect(postMessage).toHaveBeenCalledWith({ id: 2, ok: true });
  });

  it("normalises lower-cased text embeddings and preserves a zero vector", async () => {
    const first = loadWorker({});
    await first.handler({ data: { id: 3, type: "encode", text: "HarBor" } });
    expect(tokenizer).toHaveBeenCalledWith("harbor", {
      padding: "max_length",
      truncation: true,
      max_length: 64,
    });
    expect(first.postMessage).toHaveBeenLastCalledWith({ id: 3, ok: true, vector: [0.6, 0.8] });

    textModel.mockResolvedValue({ pooler_output: { data: new Float32Array([0, 0]) } });
    const second = loadWorker({});
    await second.handler({ data: { id: 4, type: "encode", text: "still" } });
    expect(second.postMessage).toHaveBeenLastCalledWith({ id: 4, ok: true, vector: [0, 0] });

    textModel.mockResolvedValue({ pooler_output: { data: [3, undefined, 4] } });
    const sparse = loadWorker({});
    await sparse.handler({ data: { id: 41, type: "encode", text: "sparse" } });
    expect(sparse.postMessage).toHaveBeenLastCalledWith({
      id: 41,
      ok: true,
      vector: [0.6, 0, 0.8],
    });
  });

  it("encodes images in the same vector space with vision-only progress", async () => {
    const blob = new Blob(["image"]);
    const { handler, postMessage } = loadWorker({});
    await handler({ data: { id: 5, type: "encode-image", blob } });
    await handler({ data: { id: 51, type: "encode-image", blob } });

    expect(mockRawImageFromBlob).toHaveBeenCalledWith(blob);
    expect(processor).toHaveBeenCalledWith({ width: 10, height: 10 });
    expect(visionModel).toHaveBeenCalledWith({ pixel_values: [1] });
    expect(postMessage).toHaveBeenCalledWith({ id: 5, ok: true, vector: [0, 1] });
    expect(mockProcessorFromPretrained).toHaveBeenCalledTimes(1);
    expect(
      postMessage.mock.calls
        .filter(([message]) => "progress" in message)
        .every(([message]) => String(message.stage).toLowerCase().includes("image")),
    ).toBe(true);
  });

  it("uses WebGPU when available and falls back to WASM after a model-load failure", async () => {
    const requestAdapter = jest.fn().mockResolvedValue({ name: "adapter" });
    mockTextModelFromPretrained
      .mockRejectedValueOnce(new Error("adapter vanished"))
      .mockResolvedValueOnce(textModel);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { handler } = loadWorker({ gpu: { requestAdapter } });
    await handler({ data: { id: 6, type: "warmup" } });

    expect(mockTextModelFromPretrained.mock.calls.map(([, options]) => options.device)).toEqual([
      "webgpu",
      "wasm",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "WebGPU text model load failed, retrying on WASM backend",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it.each([
    ["no adapter", jest.fn().mockResolvedValue(null)],
    ["probe failure", jest.fn().mockRejectedValue(new Error("probe failed"))],
  ])("uses WASM after %s", async (_label, requestAdapter) => {
    const { handler } = loadWorker({ gpu: { requestAdapter } });
    await handler({ data: { id: 7, type: "warmup" } });
    expect(mockTextModelFromPretrained).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ device: "wasm" }),
    );
  });

  it("resets a failed text runtime so the next request can retry", async () => {
    mockTokenizerFromPretrained
      .mockRejectedValueOnce(new Error("download interrupted"))
      .mockResolvedValueOnce(tokenizer);
    const { handler, postMessage } = loadWorker({});
    await handler({ data: { id: 8, type: "warmup" } });
    await handler({ data: { id: 9, type: "warmup" } });
    expect(mockTokenizerFromPretrained).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith({
      id: 8,
      ok: false,
      error: "download interrupted",
    });
    expect(postMessage).toHaveBeenCalledWith({ id: 9, ok: true });
  });

  it("propagates a WASM model-load failure before allowing a retry", async () => {
    mockTextModelFromPretrained
      .mockRejectedValueOnce(new Error("WASM model failed"))
      .mockResolvedValueOnce(textModel);
    const { handler, postMessage } = loadWorker({});
    await handler({ data: { id: 91, type: "warmup" } });
    await handler({ data: { id: 92, type: "warmup" } });
    expect(postMessage).toHaveBeenCalledWith({ id: 91, ok: false, error: "WASM model failed" });
    expect(postMessage).toHaveBeenCalledWith({ id: 92, ok: true });
  });

  it("resets a failed vision runtime so the next request can retry", async () => {
    mockProcessorFromPretrained
      .mockRejectedValueOnce(new Error("vision interrupted"))
      .mockResolvedValueOnce(processor);
    const { handler, postMessage } = loadWorker({});
    const blob = new Blob(["image"]);
    await handler({ data: { id: 10, type: "encode-image", blob } });
    await handler({ data: { id: 11, type: "encode-image", blob } });
    expect(mockProcessorFromPretrained).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith({ id: 10, ok: false, error: "vision interrupted" });
    expect(postMessage).toHaveBeenCalledWith({ id: 11, ok: true, vector: [0, 1] });
  });

  it("reports empty tower outputs, unknown requests, and non-Error failures", async () => {
    textModel.mockResolvedValueOnce({ pooler_output: null });
    const text = loadWorker({});
    await text.handler({ data: { id: 12, type: "encode", text: "empty" } });
    expect(text.postMessage).toHaveBeenLastCalledWith({
      id: 12,
      ok: false,
      error: "SigLIP text embedding output was empty.",
    });

    visionModel.mockResolvedValueOnce({ pooler_output: {} });
    const vision = loadWorker({});
    await vision.handler({ data: { id: 13, type: "encode-image", blob: new Blob() } });
    expect(vision.postMessage).toHaveBeenLastCalledWith({
      id: 13,
      ok: false,
      error: "SigLIP image embedding output was empty.",
    });

    const unknown = loadWorker({});
    await unknown.handler({ data: { id: 14, type: "mystery" } });
    expect(unknown.postMessage).toHaveBeenLastCalledWith({
      id: 14,
      ok: false,
      error: "Unknown embedding worker request.",
    });

    mockTokenizerFromPretrained.mockRejectedValueOnce("plain failure");
    const failed = loadWorker({});
    await failed.handler({ data: { id: undefined, type: "warmup" } });
    expect(failed.postMessage).toHaveBeenLastCalledWith({
      id: undefined,
      ok: false,
      error: "Embedding failed.",
    });
  });
});
