/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { encodeSearchText, warmupTextEmbeddingModel } from "./textEmbeddings";
import { EmbeddingWorkerUnavailableError } from "./embeddingWorkerClient";
import { SEARCH_UNAVAILABLE_MESSAGE, useTextVector } from "./useTextVector";

jest.mock("./textEmbeddings", () => ({
  encodeSearchText: jest.fn(),
  warmupTextEmbeddingModel: jest.fn(),
}));

const encode = jest.mocked(encodeSearchText);
const warmup = jest.mocked(warmupTextEmbeddingModel);
const resolved = () => Promise.resolve();

describe("useTextVector", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    warmup.mockResolvedValue();
    encode.mockResolvedValue([0.1, 0.2]);
  });

  it("keeps keyword and similar searches model-free", () => {
    const view = renderHook(
      ({ isSimilarMode, searchMode }) =>
        useTextVector({ isSimilarMode, searchMode, needsTextVector: false, trimmedQuery: "cats" }),
      { initialProps: { isSimilarMode: false, searchMode: "keyword" as const } },
    );
    expect(warmup).not.toHaveBeenCalled();
    view.rerender({ isSimilarMode: true, searchMode: "semantic" });
    expect(warmup).not.toHaveBeenCalled();
    expect(view.result.current.textVector).toBeNull();
  });

  it("reports warmup progress and readiness", async () => {
    let report!: Parameters<typeof warmup>[0];
    warmup.mockImplementation(async (onProgress) => {
      report = onProgress;
    });
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: false,
        trimmedQuery: "",
      }),
    );

    await act(async () => {
      report(40, "Downloading", { loaded: 4, total: 10, file: "model.onnx" });
      await resolved();
    });
    expect(result.current.textModelProgress).toBe(100);
    expect(result.current.textModelStage).toBe("Search model ready");
  });

  it("uses empty progress details when the worker omits them", async () => {
    let report!: Parameters<typeof warmup>[0];
    let finish!: () => void;
    warmup.mockImplementation(
      (onProgress) =>
        new Promise<void>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "hybrid",
        needsTextVector: false,
        trimmedQuery: "",
      }),
    );
    act(() => {
      report(12, "Starting");
    });
    expect(result.current.textModelProgressDetails).toEqual({ loaded: 0, total: 0 });
    await act(async () => finish());
  });

  it("recovers from a warmup failure", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    warmup.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: false,
        trimmedQuery: "",
      }),
    );
    await act(resolved);
    expect(result.current.textModelProgress).toBe(100);
    expect(warning).toHaveBeenCalledWith("Failed to warm semantic search model", expect.any(Error));
    warning.mockRestore();
  });

  it("encodes a query and publishes vector progress", async () => {
    let report!: Parameters<typeof encode>[1];
    let finish!: (vector: number[]) => void;
    encode.mockImplementation(
      (_query, onProgress) =>
        new Promise<number[]>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: true,
        trimmedQuery: "night cats",
      }),
    );
    expect(result.current.isTextVectorLoading).toBe(true);
    act(() => {
      report?.(60, "Encoding", { loaded: 3, total: 5 });
    });
    expect(result.current.textModelStage).toBe("Encoding");
    await act(async () => finish([0.3, 0.4]));
    expect(result.current).toEqual(
      expect.objectContaining({
        textVector: [0.3, 0.4],
        textVectorQuery: "night cats",
        isTextVectorLoading: false,
        textVectorError: null,
      }),
    );
  });

  it("reports an encoding failure", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    encode.mockRejectedValue(new Error("encode failed"));
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: true,
        trimmedQuery: "cats",
      }),
    );
    await act(resolved);
    expect(result.current.textVectorError).toBe("Semantic search is unavailable right now.");
    expect(result.current.isTextVectorLoading).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("surfaces a reload prompt when the worker is unavailable after a redeploy", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    encode.mockRejectedValue(new EmbeddingWorkerUnavailableError());
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: true,
        trimmedQuery: "cats",
      }),
    );
    await act(resolved);
    expect(result.current.textVectorError).toBe(SEARCH_UNAVAILABLE_MESSAGE);
    error.mockRestore();
  });

  it("surfaces the reload prompt when warmup itself hits a dead worker", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    warmup.mockRejectedValue(new EmbeddingWorkerUnavailableError());
    const { result } = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: false,
        trimmedQuery: "",
      }),
    );
    await act(resolved);
    expect(result.current.textVectorError).toBe(SEARCH_UNAVAILABLE_MESSAGE);
    expect(result.current.textModelProgress).toBe(100);
    warning.mockRestore();
  });

  it.each(["resolve", "reject"])("ignores a stale query that later %ss", async (outcome) => {
    let settle!: (value?: any) => void;
    const pending = new Promise<number[]>((resolve, reject) => {
      settle = outcome === "resolve" ? resolve : reject;
    });
    encode.mockReturnValue(pending);
    const view = renderHook(() =>
      useTextVector({
        isSimilarMode: false,
        searchMode: "semantic",
        needsTextVector: true,
        trimmedQuery: "old",
      }),
    );
    view.unmount();
    await act(async () => {
      settle(outcome === "resolve" ? [1] : new Error("late"));
      try {
        await pending;
      } catch {}
      await resolved();
    });
  });
});
