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
    // The worker's top-level boot ack carries no request id; it must be consumed
    // as a liveness signal and never leak into the id-keyed pending map.
    worker.emit("message", { data: { boot: true } });
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
    const worker = FakeWorker.instances[0];
    worker.emit("message", { data: { boot: true } });
    worker.emit("message", {
      data: { id: 0, ok: false, error: "Model could not load" },
    });
    await expect(request).rejects.toThrow("Model could not load");
  });

  // Changed semantics: an error is only "recover next time" once the worker has
  // proven it can boot. A worker that errors AFTER a successful boot ack (a later
  // chunk failed, a transient crash) may respawn — this test now emits the boot
  // ack first to exercise that path. The never-booted error is a distinct,
  // permanent case covered below.
  it("recovers next time when a booted worker crashes", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const first = sendEmbeddingWorkerRequest({ type: "warmup" });
    const second = sendEmbeddingWorkerRequest({ type: "encode", text: "rain" });
    const failedWorker = FakeWorker.instances[0];
    failedWorker.emit("message", { data: { boot: true } });
    const crash = new Error("worker crashed");
    failedWorker.emit("error", { error: crash });

    await expect(first).rejects.toBe(crash);
    await expect(second).rejects.toBe(crash);
    expect(failedWorker.terminate).toHaveBeenCalled();

    const recovered = sendEmbeddingWorkerRequest({ type: "warmup" });
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].emit("message", { data: { boot: true } });
    FakeWorker.instances[1].emit("message", { data: { id: 2, ok: true } });
    await expect(recovered).resolves.toBeUndefined();
  });

  it("classifies a never-booted worker error as unavailable and stays permanently dead", async () => {
    const { sendEmbeddingWorkerRequest, isEmbeddingWorkerUnavailable } = loadClient();
    const request = sendEmbeddingWorkerRequest({ type: "warmup" });
    request.catch(() => {});
    // The worker's entry script 404'd: it fires "error" without ever posting a
    // boot ack. Respawning re-fetches the same baked-in URL and 404s again.
    FakeWorker.instances[0].emit("error", {
      error: new Error("Importing a module script failed."),
    });

    await request.catch((err) => {
      expect(isEmbeddingWorkerUnavailable(err)).toBe(true);
    });
    await expect(request).rejects.toBeInstanceOf(Error);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();

    const instancesBefore = FakeWorker.instances.length;
    const next = sendEmbeddingWorkerRequest({ type: "warmup" });
    await next.catch((err) => {
      expect(isEmbeddingWorkerUnavailable(err)).toBe(true);
    });
    await expect(next).rejects.toBeInstanceOf(Error);
    // No fresh worker against the same 404-ing entry URL.
    expect(FakeWorker.instances).toHaveLength(instancesBefore);
  });

  // A post-boot error without an Error object keeps the stable fallback message
  // (the never-booted path would instead surface the unavailable classification).
  it("uses a stable fallback error for worker events without an Error", async () => {
    const { sendEmbeddingWorkerRequest } = loadClient();
    const request = sendEmbeddingWorkerRequest({ type: "warmup" });
    const worker = FakeWorker.instances[0];
    worker.emit("message", { data: { boot: true } });
    worker.emit("error", { error: "failed" });
    await expect(request).rejects.toThrow("Embedding worker failed.");
  });

  describe("boot and first-signal timeouts", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Finding 1: a boot timeout counts the ~1MB worker-chunk download. Killing a
    // worker permanently for a slow network reproduces the failure on reload, so
    // a boot timeout rejects + retires the worker but a later request may retry.
    it("treats a boot timeout as recoverable, not permanent death", async () => {
      const {
        sendEmbeddingWorkerRequest,
        isEmbeddingWorkerUnavailable,
        isEmbeddingWorkerSlowStart,
      } = loadClient();
      const first = sendEmbeddingWorkerRequest({ type: "warmup" });
      first.catch(() => {});

      // 12s (the per-request window) passes with no boot ack: nothing fires,
      // because per-request timers only arm after boot.
      jest.advanceTimersByTime(12000);
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();

      // The 40s boot window elapses: reject as a SLOW START — not the
      // permanent unavailable class, whose reload advice would restart the
      // very download that was in progress — and retire the worker.
      jest.advanceTimersByTime(28000);
      await first.catch((err) => {
        expect(isEmbeddingWorkerSlowStart(err)).toBe(true);
        expect(isEmbeddingWorkerUnavailable(err)).toBe(false);
      });
      await expect(first).rejects.toBeInstanceOf(Error);
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();

      // A slow network deserves a retry: the next request spins a fresh worker.
      const second = sendEmbeddingWorkerRequest({ type: "warmup" });
      expect(FakeWorker.instances).toHaveLength(2);
      FakeWorker.instances[1].emit("message", { data: { boot: true } });
      FakeWorker.instances[1].emit("message", { data: { id: 1, ok: true } });
      await expect(second).resolves.toBeUndefined();
    });

    // Boot-ack arming: the per-request first-signal timer must not run before the
    // worker has acknowledged boot, or it re-introduces the killed-during-download
    // bug the boot window exists to prevent.
    it("arms per-request first-signal timers only after the boot ack", async () => {
      const { sendEmbeddingWorkerRequest, isEmbeddingWorkerUnavailable } = loadClient();
      const request = sendEmbeddingWorkerRequest({ type: "warmup" });
      request.catch(() => {});
      const worker = FakeWorker.instances[0];

      // Before boot, the 12s window must be inert.
      jest.advanceTimersByTime(12000);
      expect(worker.terminate).not.toHaveBeenCalled();

      // After boot the timer arms; post-boot silence past the window kills it.
      worker.emit("message", { data: { boot: true } });
      jest.advanceTimersByTime(12000);
      await request.catch((err) => {
        expect(isEmbeddingWorkerUnavailable(err)).toBe(true);
      });
      expect(worker.terminate).toHaveBeenCalled();
    });

    // The silent nested-import-404 case: worker booted, then a lazily-imported
    // chunk 404'd, so it never signals again. This IS permanent death.
    it("marks the worker permanently dead on post-boot silence", async () => {
      const { sendEmbeddingWorkerRequest, isEmbeddingWorkerUnavailable } = loadClient();
      const first = sendEmbeddingWorkerRequest({ type: "warmup" });
      first.catch(() => {});
      FakeWorker.instances[0].emit("message", { data: { boot: true } });
      jest.advanceTimersByTime(12000);
      await first.catch(() => {});
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();

      const instancesBefore = FakeWorker.instances.length;
      const second = sendEmbeddingWorkerRequest({ type: "encode", text: "cats" });
      await second.catch((err) => {
        expect(isEmbeddingWorkerUnavailable(err)).toBe(true);
      });
      await expect(second).rejects.toBeInstanceOf(Error);
      // No fresh worker against the same stale (404-ing) chunk URL.
      expect(FakeWorker.instances).toHaveLength(instancesBefore);
    });

    it("keeps a request alive once it has emitted a first progress signal", async () => {
      const { sendEmbeddingWorkerRequest } = loadClient();
      const request = sendEmbeddingWorkerRequest({ type: "warmup" });
      const worker = FakeWorker.instances[0];
      worker.emit("message", { data: { boot: true } });

      jest.advanceTimersByTime(6000);
      worker.emit("message", { data: { id: 0, progress: 5, stage: "Starting model load" } });
      // Even long after the window, a request that has signalled is not culled.
      jest.advanceTimersByTime(60000);
      worker.emit("message", { data: { id: 0, ok: true } });

      await expect(request).resolves.toBeUndefined();
      expect(worker.terminate).not.toHaveBeenCalled();
    });

    // Finding 3: request A can wait >12s while the worker is legitimately BUSY on
    // request B (long synchronous WASM inference emitting progress). A's timer
    // must not declare death while the worker is provably alive.
    it("does not kill a busy worker still signalling for another request", async () => {
      const { sendEmbeddingWorkerRequest } = loadClient();
      const requestA = sendEmbeddingWorkerRequest({ type: "encode", text: "a" });
      const requestB = sendEmbeddingWorkerRequest({ type: "encode", text: "b" });
      const worker = FakeWorker.instances[0];
      worker.emit("message", { data: { boot: true } });

      // A never signals; B keeps the worker demonstrably alive across the window.
      jest.advanceTimersByTime(8000);
      worker.emit("message", { data: { id: 1, progress: 20, stage: "Loading" } });
      jest.advanceTimersByTime(8000); // 16s total — past A's 12s window
      worker.emit("message", { data: { id: 1, progress: 60, stage: "Loading" } });
      jest.advanceTimersByTime(8000); // 24s total
      worker.emit("message", { data: { id: 1, progress: 90, stage: "Loading" } });

      expect(worker.terminate).not.toHaveBeenCalled();

      worker.emit("message", { data: { id: 0, ok: true, vector: [1] } });
      worker.emit("message", { data: { id: 1, ok: true, vector: [2] } });
      await expect(requestA).resolves.toEqual([1]);
      await expect(requestB).resolves.toEqual([2]);
      expect(worker.terminate).not.toHaveBeenCalled();
    });
  });
});
