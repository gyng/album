/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";

type FakeSentinel = EventTarget & { release: jest.Mock };

const makeSentinel = (): FakeSentinel => {
  const target = new EventTarget() as FakeSentinel;
  target.release = jest.fn().mockResolvedValue(undefined);
  return target;
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

describe("useWakeLock", () => {
  let request: jest.Mock;
  let sentinel: FakeSentinel;

  beforeEach(() => {
    setVisibility("visible");
    sentinel = makeSentinel();
    request = jest.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
  });

  afterEach(() => {
    // @ts-expect-error - cleaning up the test shim
    delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
  });

  it("reports support when navigator.wakeLock.request exists", () => {
    const { result } = renderHook(() => useWakeLock(true));
    expect(result.current.isSupported).toBe(true);
  });

  it("reports no support when the API is absent", () => {
    // @ts-expect-error - removing the shim for this case
    delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
    const { result } = renderHook(() => useWakeLock(true));
    expect(result.current.isSupported).toBe(false);
  });

  it("acquires a sentinel and marks the lock active", async () => {
    const { result } = renderHook(() => useWakeLock(false));
    await act(async () => {
      await result.current.acquire();
    });
    expect(request).toHaveBeenCalledWith("screen");
    expect(result.current.isActive).toBe(true);
    expect(result.current.ref.current).toBe(sentinel);
  });

  it("releases the sentinel and clears active state", async () => {
    const { result } = renderHook(() => useWakeLock(false));
    await act(async () => {
      await result.current.acquire();
    });
    await act(async () => {
      await result.current.release();
    });
    expect(sentinel.release).toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
    expect(result.current.ref.current).toBeNull();
  });

  it("goes inactive when the platform fires the sentinel 'release' event", async () => {
    const { result } = renderHook(() => useWakeLock(false));
    await act(async () => {
      await result.current.acquire();
    });
    act(() => {
      sentinel.dispatchEvent(new Event("release"));
    });
    expect(result.current.isActive).toBe(false);
    expect(result.current.ref.current).toBeNull();
  });

  it("does not acquire while disabled, even on an acquire() call", async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await act(async () => {
      await result.current.acquire();
    });
    // disabled=true short-circuits to release(), so no request is made.
    expect(request).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });

  it("auto-acquires on mount when enabled and visible", async () => {
    const { result } = renderHook(() => useWakeLock(false));
    // The on-load effect fires acquire(); flush its microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith("screen");
    expect(result.current.isActive).toBe(true);
  });

  it("re-marks active on visibilitychange back to visible", async () => {
    const { result } = renderHook(() => useWakeLock(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isActive).toBe(true);

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isActive).toBe(false);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    // The sentinel ref is retained while hidden, so re-acquiring flips the
    // active state back on WITHOUT issuing a fresh request — guard that the
    // platform lock was requested exactly once (on mount), not re-churned on
    // every blur/focus.
    expect(result.current.isActive).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases on unmount", async () => {
    const { result, unmount } = renderHook(() => useWakeLock(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.ref.current).toBe(sentinel);
    unmount();
    expect(sentinel.release).toHaveBeenCalled();
  });
});
