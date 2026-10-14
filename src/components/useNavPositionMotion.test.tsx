/** @jest-environment jsdom */
import { useRef } from "react";
import { render } from "@testing-library/react";
import { useNavPositionMotion } from "./useNavPositionMotion";

const Harness = ({ layout }: { layout: "regular" | "map" | "wider-map" }) => {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  useNavPositionMotion(left, "left");
  useNavPositionMotion(right, "right", "right");
  return (
    <>
      <div ref={left} data-region="left" data-layout={layout} />
      <div ref={right} data-region="right" data-layout={layout} />
    </>
  );
};

it("moves the two edges independently, anchors a wider appearance group at its right edge and preserves the old route on cleanup", () => {
  sessionStorage.clear();
  history.replaceState(null, "", "/fun");
  const cancel = jest.fn();
  const animate = jest.fn(
    (_frames: Keyframe[], _options?: KeyframeAnimationOptions) =>
      ({ cancel }) as unknown as Animation,
  );
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const match = jest
    .spyOn(window, "matchMedia")
    .mockReturnValue({ matches: false } as MediaQueryList);
  const rect = jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const regular = this.dataset.layout === "regular";
      const left = this.dataset.region === "left";
      const width = left ? 1000 : regular ? 108 : this.dataset.layout === "map" ? 278 : 328;
      const x = left ? (regular ? 292 : 24) : (regular ? 1628 : 1896) - width;
      return {
        x,
        y: 24,
        width,
        height: 44,
        top: 24,
        bottom: 68,
        left: x,
        right: x + width,
        toJSON: () => ({}),
      };
    });
  const view = render(<Harness layout="regular" />);
  history.replaceState(null, "", "/map");
  view.rerender(<Harness layout="map" />);
  expect(animate.mock.calls.map((call) => call[0])).toEqual([
    [{ transform: "translate(268px, 0px)" }, { transform: "translate(0, 0)" }],
    [{ transform: "translate(-268px, 0px)" }, { transform: "translate(0, 0)" }],
  ]);
  view.rerender(<Harness layout="wider-map" />);
  expect(animate).toHaveBeenCalledTimes(2);
  history.replaceState(null, "", "/fun");
  view.unmount();
  expect(JSON.parse(sessionStorage.getItem("gallery-nav-position:right")!).path).toBe("/map");
  const returned = render(<Harness layout="regular" />);
  expect(animate.mock.calls.slice(2).map((call) => call[0])).toEqual([
    [{ transform: "translate(-268px, 0px)" }, { transform: "translate(0, 0)" }],
    [{ transform: "translate(268px, 0px)" }, { transform: "translate(0, 0)" }],
  ]);
  match.mockReturnValue({ matches: true } as MediaQueryList);
  returned.rerender(<Harness layout="map" />);
  expect(animate).toHaveBeenCalledTimes(4);
  returned.unmount();
  rect.mockRestore();
  match.mockRestore();
});

it("retains the presented position when navigation interrupts an unfinished animation", () => {
  history.replaceState(null, "", "/motion-origin");
  let target = 100;
  let translation = 0;
  const cancel = () => {
    translation = 0;
  };
  const animate = jest.fn((_frames: Keyframe[]) => ({ cancel }) as unknown as Animation);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const match = jest
    .spyOn(window, "matchMedia")
    .mockReturnValue({ matches: false } as MediaQueryList);
  const rect = jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({
      x: target + translation,
      y: 24,
      width: 100,
      height: 44,
      top: 24,
      bottom: 68,
      left: target + translation,
      right: target + translation + 100,
      toJSON: () => ({}),
    }));
  const Region = () => {
    const ref = useRef<HTMLDivElement>(null);
    useNavPositionMotion(ref, "trailing");
    return <div ref={ref} />;
  };
  const view = render(<Region />);
  target = 200;
  history.replaceState(null, "", "/motion-middle");
  view.rerender(<Region />);
  translation = -50;
  history.replaceState(null, "", "/motion-next");
  view.unmount();
  expect(JSON.parse(sessionStorage.getItem("gallery-nav-position:trailing")!).x).toBe(150);
  target = 300;
  const next = render(<Region />);
  expect(animate.mock.calls.at(-1)![0][0]).toEqual({ transform: "translate(-150px, 0px)" });
  next.unmount();
  rect.mockRestore();
  match.mockRestore();
});

it.each([
  ["sticky", 24],
  ["relative", 724],
] as const)("records %s album navigation in the correct coordinates", (position, expectedY) => {
  history.replaceState(null, "", "/album/motion-sticky");
  const oldScroll = window.scrollY;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 700 });
  const rect = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 24,
    y: 24,
    width: 100,
    height: 44,
    top: 24,
    bottom: 68,
    left: 24,
    right: 124,
    toJSON: () => ({}),
  });
  const view = render(
    <div data-nav-viewport-motion style={{ position }}>
      <Harness layout="regular" />
    </div>,
  );
  view.unmount();
  expect(JSON.parse(sessionStorage.getItem("gallery-nav-position:left")!).y).toBe(expectedY);
  rect.mockRestore();
  Object.defineProperty(window, "scrollY", { configurable: true, value: oldScroll });
});

describe("positions that are not a navigation", () => {
  let target: number;
  let animate: jest.Mock;
  let match: jest.SpyInstance;
  let rect: jest.SpyInstance;
  const innerWidth = window.innerWidth;
  const Region = () => {
    const ref = useRef<HTMLDivElement>(null);
    useNavPositionMotion(ref, "trailing");
    return <div ref={ref} />;
  };
  beforeEach(() => {
    sessionStorage.clear();
    target = 100;
    animate = jest.fn(() => ({ cancel: () => {} }) as unknown as Animation);
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    match = jest.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    rect = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: target,
      y: 24,
      width: 100,
      height: 44,
      top: 24,
      bottom: 68,
      left: target,
      right: target + 100,
      toJSON: () => ({}),
    }));
  });
  afterEach(() => {
    rect.mockRestore();
    match.mockRestore();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  });

  it("does not glide when a resize moves the nav", () => {
    history.replaceState(null, "", "/explore");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const view = render(<Region />);
    animate.mockClear();
    // Desktop to phone width re-renders the same route somewhere new.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    target = 900;
    view.rerender(<Region />);
    expect(animate).not.toHaveBeenCalled();
    view.unmount();
  });

  it("glides when the page itself moves the nav at the same width", () => {
    // Guess Where starting a round switches to its map chrome without a navigation.
    history.replaceState(null, "", "/fun/guess");
    const view = render(<Region />);
    animate.mockClear();
    target = 160;
    view.rerender(<Region />);
    expect(animate.mock.calls.map((call) => call[0])).toEqual([
      [{ transform: "translate(-60px, 0px)" }, { transform: "translate(0, 0)" }],
    ]);
    view.unmount();
  });

  it("does not launch the nav from a position measured at another viewport width", () => {
    history.replaceState(null, "", "/explore/timeline");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    target = 1100;
    render(<Region />).unmount();
    animate.mockClear();
    history.replaceState(null, "", "/explore");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    target = 250;
    render(<Region />).unmount();
    expect(animate).not.toHaveBeenCalled();
  });
});
