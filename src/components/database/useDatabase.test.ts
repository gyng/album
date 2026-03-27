jest.mock("@sqlite.org/sqlite-wasm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { databaseLoaderInternals } from "./useDatabase";

describe("fetchWithProgress", () => {
  const originalFetch = global.fetch;
  const originalResponse = global.Response;
  const originalReadableStream = global.ReadableStream;

  class MockReadableStream {
    private queue: Uint8Array[] = [];
    private waiters: Array<
      (result: { done: boolean; value?: Uint8Array }) => void
    > = [];
    private closed = false;

    constructor({
      start,
    }: {
      start: (controller: {
        enqueue: (chunk: Uint8Array) => void;
        close: () => void;
      }) => void;
    }) {
      start({
        enqueue: (chunk) => {
          const waiter = this.waiters.shift();
          if (waiter) {
            waiter({ done: false, value: chunk });
            return;
          }

          this.queue.push(chunk);
        },
        close: () => {
          this.closed = true;
          while (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            waiter?.({ done: true });
          }
        },
      });
    }

    getReader() {
      return {
        read: async () => {
          if (this.queue.length > 0) {
            return { done: false, value: this.queue.shift() };
          }

          if (this.closed) {
            return { done: true, value: undefined };
          }

          return await new Promise<{ done: boolean; value?: Uint8Array }>(
            (resolve) => {
              this.waiters.push(resolve);
            },
          );
        },
      };
    }
  }

  class MockResponse {
    body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null;
    headers: { get: (name: string) => string | null };
    ok: boolean;
    status: number;
    statusText: string;

    constructor(
      body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null,
      init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
    ) {
      this.body = body;
      this.status = init.status ?? 200;
      this.statusText = init.statusText ?? "OK";
      this.ok = this.status >= 200 && this.status < 300;

      const headerMap = new Map(
        Object.entries(init.headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      this.headers = {
        get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      };
    }

    async arrayBuffer() {
      if (!this.body) {
        return new ArrayBuffer(0);
      }

      const reader = this.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        chunks.push(value);
        total += value.byteLength;
      }

      const combined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return combined.buffer;
    }
  }

  afterEach(() => {
    global.fetch = originalFetch;
    global.Response = originalResponse;
    global.ReadableStream = originalReadableStream;
    jest.restoreAllMocks();
  });

  it("loads the database even when content-length is unavailable", async () => {
    const response = {
      ok: true,
      body: {},
      headers: {
        get: jest.fn().mockReturnValue(null),
      },
      arrayBuffer: jest.fn(),
    } as any;
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as typeof fetch;
    const onProgress = jest.fn();

    const result = await databaseLoaderInternals.fetchWithProgress(
      "/search.sqlite",
      onProgress,
    );

    expect(fetchMock).toHaveBeenCalledWith("/search.sqlite");
    expect(onProgress).toHaveBeenCalledWith(0, { loaded: 0, total: 0 });
    expect(result).toBe(response);
  });

  it("reports loaded and total bytes when content-length is available", async () => {
    global.ReadableStream = MockReadableStream as unknown as typeof ReadableStream;
    global.Response = MockResponse as unknown as typeof Response;

    const chunks = [
      new Uint8Array([97, 98, 99]),
      new Uint8Array([100, 101, 102, 103]),
    ];
    const response = {
      ok: true,
      body: {
        getReader() {
          let index = 0;
          return {
            read: async () => {
              if (index >= chunks.length) {
                return { done: true, value: undefined };
              }

              const value = chunks[index];
              index += 1;
              return { done: false, value };
            },
          };
        },
      },
      headers: {
        get: jest.fn((name: string) =>
          name.toLowerCase() === "content-length" ? "7" : null,
        ),
      },
      status: 200,
      statusText: "OK",
    } as any;

    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as typeof fetch;
    const onProgress = jest.fn();

    const result = await databaseLoaderInternals.fetchWithProgress(
      "/search.sqlite",
      onProgress,
    );

    await result.arrayBuffer();

    expect(fetchMock).toHaveBeenCalledWith("/search.sqlite");
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.any(Number), {
      loaded: 3,
      total: 7,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, 100, {
      loaded: 7,
      total: 7,
    });
  });
});