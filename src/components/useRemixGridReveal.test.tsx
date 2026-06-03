/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { useRemixGridReveal } from "./useRemixGridReveal";

describe("useRemixGridReveal", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("is always ready for a single (non-remix) slide", () => {
    const { result } = renderHook(() =>
      useRemixGridReveal({ seedPath: "a", companionPaths: [] }),
    );
    expect(result.current.isRemixGridReady).toBe(true);
  });

  it("stays not-ready until every cell of a remix has loaded", () => {
    const companionPaths = ["b", "c"]; // 3 cells with the seed
    const { result } = renderHook(() =>
      useRemixGridReveal({ seedPath: "a", companionPaths }),
    );
    expect(result.current.isRemixGridReady).toBe(false);

    act(() => result.current.markRemixCellLoaded("a"));
    expect(result.current.isRemixGridReady).toBe(false);
    act(() => result.current.markRemixCellLoaded("b"));
    expect(result.current.isRemixGridReady).toBe(false);
    act(() => result.current.markRemixCellLoaded("c"));
    expect(result.current.isRemixGridReady).toBe(true);
  });

  it("ignores duplicate load events for the same cell", () => {
    const companionPaths = ["b"]; // 2 cells
    const { result } = renderHook(() =>
      useRemixGridReveal({ seedPath: "a", companionPaths }),
    );
    act(() => result.current.markRemixCellLoaded("a"));
    act(() => result.current.markRemixCellLoaded("a")); // duplicate
    // The seed counted once; the companion still pending → not ready.
    expect(result.current.isRemixGridReady).toBe(false);
    act(() => result.current.markRemixCellLoaded("b"));
    expect(result.current.isRemixGridReady).toBe(true);
  });

  it("resets readiness when the layout changes", () => {
    const { result, rerender } = renderHook((props) => useRemixGridReveal(props), {
      initialProps: { seedPath: "a", companionPaths: ["b"] },
    });
    act(() => result.current.markRemixCellLoaded("a"));
    act(() => result.current.markRemixCellLoaded("b"));
    expect(result.current.isRemixGridReady).toBe(true);

    // New layout → the loaded set is cleared, so it waits again.
    rerender({ seedPath: "x", companionPaths: ["y"] });
    expect(result.current.isRemixGridReady).toBe(false);
  });

  it("reveals after the 3s safety net even if a cell never loads", () => {
    const { result } = renderHook(() =>
      useRemixGridReveal({ seedPath: "a", companionPaths: ["b"] }),
    );
    expect(result.current.isRemixGridReady).toBe(false);
    act(() => {
      jest.advanceTimersByTime(3001);
    });
    expect(result.current.isRemixGridReady).toBe(true);
  });
});
