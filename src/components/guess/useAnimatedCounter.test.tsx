/**
 * @jest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { useAnimatedCounter } from "./useAnimatedCounter";

type FrameCallback = (now: number) => void;

describe("useAnimatedCounter", () => {
  let frames: FrameCallback[];
  let requestAnimationFrameMock: jest.Mock;
  let cancelAnimationFrameMock: jest.Mock;

  beforeEach(() => {
    frames = [];
    requestAnimationFrameMock = jest.fn((callback: FrameCallback) => {
      frames.push(callback);
      return frames.length;
    });
    cancelAnimationFrameMock = jest.fn();
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(requestAnimationFrameMock);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelAnimationFrameMock);
    jest.spyOn(performance, "now").mockReturnValue(100);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("animates from zero to the formatted target without triggering React renders", () => {
    const { result } = renderHook(() => useAnimatedCounter(1_000, 600));
    const node = document.createElement("strong");

    result.current(node);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    frames.shift()?.(100);
    expect(node.textContent).toBe("0");

    frames.shift()?.(400);
    expect(Number(node.textContent?.replaceAll(",", ""))).toBeGreaterThan(0);
    expect(Number(node.textContent?.replaceAll(",", ""))).toBeLessThan(1_000);

    frames.shift()?.(700);
    expect(node.textContent).toBe((1_000).toLocaleString("en-GB"));
    expect(frames).toHaveLength(0);
  });

  it("jumps directly to zero and reduced-motion targets", () => {
    const zero = renderHook(() => useAnimatedCounter(0));
    const zeroNode = document.createElement("span");
    zero.result.current(zeroNode);
    expect(zeroNode.textContent).toBe("0");

    jest.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const reduced = renderHook(() => useAnimatedCounter(12_345));
    const reducedNode = document.createElement("span");
    reduced.result.current(reducedNode);
    expect(reducedNode.textContent).toBe((12_345).toLocaleString("en-GB"));

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
  });

  it("does not restart an unchanged target", () => {
    const { result } = renderHook(() => useAnimatedCounter(250));
    const node = document.createElement("span");

    result.current(node);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    result.current(node);
    expect(node.textContent).toBe((250).toLocaleString("en-GB"));
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameMock).toHaveBeenLastCalledWith(1);
  });

  it("cancels the active frame when the ref detaches", () => {
    const { result } = renderHook(() => useAnimatedCounter(100));
    const node = document.createElement("span");

    result.current(node);
    result.current(null);

    expect(cancelAnimationFrameMock).toHaveBeenLastCalledWith(1);
  });
});
