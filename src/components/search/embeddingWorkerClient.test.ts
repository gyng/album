/**
 * @jest-environment jsdom
 */

type Listener = (event: any) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Listener>();
  postMessage = jest.fn();
  terminate = jest.fn();

  constructor(public url: URL) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  emit(type: string, event: any) {
    this.listeners.get(type)?.(event);
  }
}

const loadClient = () => {
  jest.resetModules();
  return require("./embeddingWorkerClient") as typeof import("./embeddingWorkerClient");
};

describe("embeddingWorkerClient", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: FakeWorker,
    });
  });

  it("rejects requests when workers are unavailable", async () => {
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: undefined });
    const { sendEmbeddingWorkerRequest } = loadClient();
    await expect(sendEmbeddingWorkerRequest({ type: "warmup" })).rejects.toThrow(
      "Web workers are unavailable",
    );
  });

  it("reuses one worker and routes progress and successful replies by id", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const onProgress = jest.fn();
    const first = sendEmbeddingWorkerRequest({ type: "encode", text: "night cats" }, onProgress);
    const second = sendEmbeddingWorkerRequest({ type: "warmup" });
    const worker = FakeWorker.instances[0];

    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.postMessage.mock.calls).toEqual([
      [{ type: "encode", text: "night cats", id: 0 }],
      [{ type: "warmup", id: 1 }],
    ]);
    worker.emit("message", { data: { id: 99, ok: true, vector: [99] } });
    worker.emit("message", {
      data: {
        id: 0,
        progress: 25,
        stage: "Downloading",
        details: { loaded: 1, total: 4, file: "model.onnx" },
      },
    });
    worker.emit("message", { data: { id: 1, progress: 50, stage: "Loading" } });
    expect(onProgress).toHaveBeenCalledWith(25, "Downloading", {
      loaded: 1,
      total: 4,
      file: "model.onnx",
    });

    worker.emit("message", { data: { id: 0, ok: true, vector: [1, 2] } });
    worker.emit("message", { data: { id: 1, ok: true } });
    await expect(first).resolves.toEqual([1, 2]);
    await expect(second).resolves.toBeUndefined();
  });

  it("rejects a failed request", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const request = sendEmbeddingWorkerRequest({ type: "warmup" });
    FakeWorker.instances[0].emit("message", {
      data: { id: 0, ok: false, error: "Model could not load" },
    });
    await expect(request).rejects.toThrow("Model could not load");
  });

  it("rejects every pending request when the worker crashes and recovers next time", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const first = sendEmbeddingWorkerRequest({ type: "warmup" });
    const second = sendEmbeddingWorkerRequest({ type: "encode", text: "rain" });
    const failedWorker = FakeWorker.instances[0];
    const crash = new Error("worker crashed");
    failedWorker.emit("error", { error: crash });

    await expect(first).rejects.toBe(crash);
    await expect(second).rejects.toBe(crash);
    expect(failedWorker.terminate).toHaveBeenCalled();

    const recovered = sendEmbeddingWorkerRequest({ type: "warmup" });
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].emit("message", { data: { id: 2, ok: true } });
    await expect(recovered).resolves.toBeUndefined();
  });

  it("uses a stable fallback error for worker events without an Error", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const request = sendEmbeddingWorkerRequest({ type: "warmup" });
    FakeWorker.instances[0].emit("error", { error: "failed" });
    await expect(request).rejects.toThrow("Embedding worker failed.");
  });
});
