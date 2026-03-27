describe("textEmbeddings", () => {
  const originalWorker = global.Worker;

  class MockWorker {
    postMessage = jest.fn();
    addEventListener = jest.fn(
      (type: string, listener: (event: { data?: unknown; error?: unknown }) => void) => {
        const current = this.listeners.get(type) ?? [];
        current.push(listener);
        this.listeners.set(type, current);
      },
    );
    listeners = new Map<
      string,
      Array<(event: { data?: unknown; error?: unknown }) => void>
    >();

    emitMessage(data: unknown) {
      const listeners = this.listeners.get("message") ?? [];
      for (const listener of listeners) {
        listener({ data });
      }
    }

    emitError(error: unknown) {
      const listeners = this.listeners.get("error") ?? [];
      for (const listener of listeners) {
        listener({ error });
      }
    }
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();

    if (originalWorker) {
      global.Worker = originalWorker;
    } else {
      // @ts-expect-error cleanup for environments without Worker
      delete global.Worker;
    }
  });

  it("forwards progress details and resolves encoded vectors", async () => {
    const worker = new MockWorker();
    const workerConstructor = jest.fn(() => worker as unknown as Worker);
    global.Worker = workerConstructor as unknown as typeof Worker;

    const { encodeSearchText } = await import("./textEmbeddings");
    const onProgress = jest.fn();

    const resultPromise = encodeSearchText("harbor", onProgress);

    expect(workerConstructor).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: "encode",
      text: "harbor",
    });

    worker.emitMessage({
      id: 0,
      progress: 50,
      stage: "Loading text model",
      details: {
        loaded: 2048,
        total: 4096,
        file: "text_model.onnx",
      },
    });

    expect(onProgress).toHaveBeenCalledWith(50, "Loading text model", {
      loaded: 2048,
      total: 4096,
      file: "text_model.onnx",
    });

    worker.emitMessage({ id: 0, ok: true, vector: [1, 0, 0] });

    await expect(resultPromise).resolves.toEqual([1, 0, 0]);
  });

  it("reuses the same worker across warmup and encode requests", async () => {
    const worker = new MockWorker();
    const workerConstructor = jest.fn(() => worker as unknown as Worker);
    global.Worker = workerConstructor as unknown as typeof Worker;

    const { warmupTextEmbeddingModel, encodeSearchText } = await import(
      "./textEmbeddings"
    );

    const warmupPromise = warmupTextEmbeddingModel();
    worker.emitMessage({ id: 0, ok: true });
    await expect(warmupPromise).resolves.toBeUndefined();

    const encodePromise = encodeSearchText("night");
    worker.emitMessage({ id: 1, ok: true, vector: [0, 1, 0] });
    await expect(encodePromise).resolves.toEqual([0, 1, 0]);

    expect(workerConstructor).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      id: 0,
      type: "warmup",
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      id: 1,
      type: "encode",
      text: "night",
    });
  });

  it("rejects pending requests when the worker errors", async () => {
    const worker = new MockWorker();
    global.Worker = jest.fn(() => worker as unknown as Worker) as unknown as typeof Worker;

    const { encodeSearchText } = await import("./textEmbeddings");

    const resultPromise = encodeSearchText("harbor");
    worker.emitError(new Error("worker exploded"));

    await expect(resultPromise).rejects.toThrow("worker exploded");
  });

  it("throws when the worker returns no embedding for an encode request", async () => {
    const worker = new MockWorker();
    global.Worker = jest.fn(() => worker as unknown as Worker) as unknown as typeof Worker;

    const { encodeSearchText } = await import("./textEmbeddings");

    const resultPromise = encodeSearchText("harbor");
    worker.emitMessage({ id: 0, ok: true });

    await expect(resultPromise).rejects.toThrow(
      "Text embedding worker returned no embedding.",
    );
  });
});