/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { encodeSearchImage } from "./imageEmbeddings";
import { useImageQuery } from "./useImageQuery";

jest.mock("./imageEmbeddings", () => ({ encodeSearchImage: jest.fn() }));
const encode = jest.mocked(encodeSearchImage);

describe("useImageQuery", () => {
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    encode.mockResolvedValue([0.1, 0.2]);
  });

  it("encodes an uploaded image and exposes model progress", async () => {
    let report!: Parameters<typeof encode>[1];
    let finish!: (vector: number[]) => void;
    encode.mockImplementation(
      (_blob, onProgress) =>
        new Promise<number[]>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageQuery());
    const blob = new Blob(["photo"], { type: "image/jpeg" });
    act(() => result.current.startImageQuery(blob, "upload"));
    expect(result.current.imageQuery).toEqual({
      id: 1,
      source: "upload",
      previewUrl: "blob:first",
      vector: null,
    });
    act(() => report?.(55, "Encoding image", { loaded: 5, total: 9, file: "vision.onnx" }));
    expect(result.current.imageModelProgressDetails.file).toBe("vision.onnx");
    act(() => report?.(60, "Finishing"));
    expect(result.current.imageModelProgressDetails).toEqual({ loaded: 0, total: 0 });
    await act(async () => finish([0.4, 0.5]));
    expect(result.current.imageQuery?.vector).toEqual([0.4, 0.5]);
    expect(result.current.imageModelProgress).toBe(100);
  });

  it("revokes previews when replacing, clearing, and unmounting", () => {
    encode.mockReturnValue(new Promise(() => {}));
    const view = renderHook(() => useImageQuery());
    act(() => view.result.current.clearImageQuery());
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => view.result.current.startImageQuery(new Blob(["one"]), "upload"));
    act(() => view.result.current.startImageQuery(new Blob(["two"]), "drawing"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    act(() => view.result.current.clearImageQuery());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(view.result.current.imageQuery).toBeNull();
    expect(view.result.current.imageVectorError).toBeNull();
    view.unmount();
  });

  it("reports an active encoding failure and releases its preview", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    encode.mockRejectedValue(new Error("bad image"));
    const { result } = renderHook(() => useImageQuery());
    act(() => result.current.startImageQuery(new Blob(["bad"]), "upload"));
    await act(async () => Promise.resolve());
    expect(result.current.imageQuery).toBeNull();
    expect(result.current.imageVectorError).toBe("Image search is unavailable right now.");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(error).toHaveBeenCalledWith("Failed to encode search image", expect.any(Error));
    error.mockRestore();
  });

  it.each(["progress", "resolve", "reject"])("ignores stale %s work", async (outcome) => {
    let report!: Parameters<typeof encode>[1];
    let resolve!: (vector: number[]) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<number[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    encode.mockImplementation((_blob, onProgress) => {
      report = onProgress;
      return pending;
    });
    const { result } = renderHook(() => useImageQuery());
    act(() => result.current.startImageQuery(new Blob(["old"]), "upload"));
    act(() => result.current.clearImageQuery());

    if (outcome === "progress") {
      act(() => report?.(99, "Stale"));
      expect(result.current.imageModelStage).not.toBe("Stale");
      resolve([]);
    } else if (outcome === "resolve") {
      resolve([9]);
    } else {
      reject(new Error("late"));
    }
    await act(async () => {
      try {
        await pending;
      } catch {}
      await Promise.resolve();
    });
    expect(result.current.imageQuery).toBeNull();
  });

  it("invalidates in-flight work when unmounted", async () => {
    let resolve!: (vector: number[]) => void;
    const pending = new Promise<number[]>((res) => {
      resolve = res;
    });
    encode.mockReturnValue(pending);
    const view = renderHook(() => useImageQuery());
    act(() => view.result.current.startImageQuery(new Blob(["photo"]), "upload"));
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    resolve([1]);
    await pending;
  });
});
