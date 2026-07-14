/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { MapWorldEntry } from "./MapWorld";
import { TimeRangeSlider } from "./TimeRangeSlider";
import { exifWallClockTimestamp } from "../util/exifTime";

const photos: MapWorldEntry[] = [
  {
    album: "trip",
    src: { src: "/one.jpg", width: 100, height: 100 },
    decLat: 1,
    decLng: 1,
    date: "2020-01-01T00:00:00",
    href: "/one.jpg",
  },
  {
    album: "trip",
    src: { src: "/two.jpg", width: 100, height: 100 },
    decLat: 2,
    decLng: 2,
    date: "2025-01-01T00:00:00",
    href: "/two.jpg",
  },
];
const fromMs = exifWallClockTimestamp("2021-01-01T00:00:00")!;
const toMs = exifWallClockTimestamp("2024-01-01T00:00:00")!;

const renderSlider = (overrides: Partial<React.ComponentProps<typeof TimeRangeSlider>> = {}) => {
  const onDrag = jest.fn();
  const onCommit = jest.fn();
  const view = render(
    <TimeRangeSlider
      photos={photos}
      fromMs={fromMs}
      toMs={toMs}
      onDrag={onDrag}
      onCommit={onCommit}
      {...overrides}
    />,
  );
  return { ...view, onDrag, onCommit };
};

describe("TimeRangeSlider", () => {
  beforeAll(() => {
    globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("commits keyboard range changes", () => {
    const { onDrag, onCommit } = renderSlider();

    fireEvent.keyDown(screen.getByRole("slider", { name: "Start date" }), {
      key: "ArrowRight",
    });
    expect(onDrag).toHaveBeenCalledWith(expect.any(Number), toMs);
    expect(onDrag.mock.calls[0]?.[0]).toBeGreaterThan(fromMs);
    expect(onCommit).toHaveBeenCalledWith(expect.any(Number), toMs);
  });

  it("clears the active date filter", () => {
    const { onCommit } = renderSlider();

    fireEvent.click(screen.getByRole("button", { name: "Clear date filter" }));
    expect(onCommit).toHaveBeenCalledWith(null, null);
  });

  it("renders nothing when no photo has a usable date", () => {
    const { container } = renderSlider({
      photos: [{ ...photos[0], date: null }],
      fromMs: null,
      toMs: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the full range before a filter is selected and starts one on track click", () => {
    const { container, onDrag, onCommit } = renderSlider({
      fromMs: null,
      toMs: null,
      id: "timeline-range",
      className: "extra",
    });
    const start = screen.getByRole("slider", { name: "Start date" });
    const end = screen.getByRole("slider", { name: "End date" });
    const trackArea = start.parentElement!;
    trackArea.getBoundingClientRect = () =>
      ({ left: 0, width: 100, right: 100, top: 0, bottom: 20, height: 20 }) as DOMRect;

    expect(container.querySelector("#timeline-range")).toBeTruthy();
    expect(start.getAttribute("aria-valuetext")).toBe("Start");
    expect(end.getAttribute("aria-valuetext")).toBe("End");
    expect(screen.queryByRole("button", { name: "Clear date filter" })).toBeNull();

    fireEvent.click(trackArea, { clientX: 50 });
    expect(onDrag).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(onCommit).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(onCommit.mock.calls[0][0]).toBeLessThan(onCommit.mock.calls[0][1]);

    fireEvent.click(start, { clientX: 10 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("moves the nearest range endpoint when the active track is clicked", () => {
    const first = renderSlider();
    const start = screen.getByRole("slider", { name: "Start date" });
    const trackArea = start.parentElement!;
    trackArea.getBoundingClientRect = () =>
      ({ left: 0, width: 100, right: 100, top: 0, bottom: 20, height: 20 }) as DOMRect;

    fireEvent.click(trackArea, { clientX: 10 });
    expect(first.onDrag).toHaveBeenLastCalledWith(expect.any(Number), toMs);
    expect(first.onCommit).toHaveBeenLastCalledWith(expect.any(Number), toMs);
    first.unmount();

    const second = renderSlider();
    const secondStart = screen.getByRole("slider", { name: "Start date" });
    const secondTrack = secondStart.parentElement!;
    secondTrack.getBoundingClientRect = () => trackArea.getBoundingClientRect();
    fireEvent.click(secondTrack, { clientX: 90 });
    expect(second.onDrag).toHaveBeenLastCalledWith(fromMs, expect.any(Number));
    expect(second.onCommit).toHaveBeenLastCalledWith(fromMs, expect.any(Number));
  });

  it("drags each thumb live, clamps crossing, and commits on release or cancel", () => {
    const { onDrag, onCommit } = renderSlider();
    const start = screen.getByRole("slider", { name: "Start date" });
    const end = screen.getByRole("slider", { name: "End date" });
    const trackArea = start.parentElement!;
    const container = trackArea.parentElement!;
    trackArea.getBoundingClientRect = () =>
      ({ left: 0, width: 100, right: 100, top: 0, bottom: 20, height: 20 }) as DOMRect;

    fireEvent.pointerMove(container, { clientX: 50 });
    expect(onDrag).not.toHaveBeenCalled();
    fireEvent.pointerUp(container);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: "touch", clientX: 20 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 100 });
    expect(onDrag).toHaveBeenLastCalledWith(toMs, toMs);
    fireEvent.pointerUp(container, { pointerId: 1 });
    expect(onCommit).toHaveBeenLastCalledWith(fromMs, toMs);

    fireEvent.pointerDown(end, { pointerId: 2, pointerType: "touch", clientX: 80 });
    fireEvent.pointerMove(container, { pointerId: 2, clientX: -20 });
    expect(onDrag).toHaveBeenLastCalledWith(fromMs, fromMs);
    fireEvent.pointerCancel(container, { pointerId: 2 });
    expect(onCommit).toHaveBeenLastCalledWith(fromMs, toMs);
  });

  it("clears a range whose thumbs are already at the two extremes", () => {
    const minMs = exifWallClockTimestamp(photos[0].date)!;
    const maxMs = exifWallClockTimestamp(photos[1].date)!;
    const { onCommit } = renderSlider({ fromMs: minMs, toMs: maxMs });
    const start = screen.getByRole("slider", { name: "Start date" });
    const container = start.parentElement!.parentElement!;

    fireEvent.pointerDown(start, { pointerId: 3, pointerType: "touch" });
    fireEvent.pointerUp(container, { pointerId: 3 });
    expect(onCommit).toHaveBeenCalledWith(null, null);
  });

  it("supports every arrow-key direction on both thumbs and ignores other keys", () => {
    const { onDrag, onCommit } = renderSlider();
    const start = screen.getByRole("slider", { name: "Start date" });
    const end = screen.getByRole("slider", { name: "End date" });

    for (const key of ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"]) {
      fireEvent.keyDown(start, { key });
      fireEvent.keyDown(end, { key });
    }
    const callsBeforeIgnoredKey = onCommit.mock.calls.length;
    fireEvent.keyDown(start, { key: "Home" });

    expect(onDrag).toHaveBeenCalled();
    expect(onCommit.mock.calls).toHaveLength(callsBeforeIgnoredKey);
  });

  it("uses extent endpoints for keyboard control before a range exists", () => {
    const { onDrag, onCommit } = renderSlider({ fromMs: null, toMs: null });
    const start = screen.getByRole("slider", { name: "Start date" });
    const end = screen.getByRole("slider", { name: "End date" });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(end, { key: "ArrowRight" });

    expect(onDrag).toHaveBeenCalledTimes(4);
    expect(onCommit).toHaveBeenCalledTimes(4);
  });

  it("uses extent endpoints while dragging before a range exists", () => {
    const { onDrag, onCommit } = renderSlider({ fromMs: null, toMs: null });
    const start = screen.getByRole("slider", { name: "Start date" });
    const end = screen.getByRole("slider", { name: "End date" });
    const trackArea = start.parentElement!;
    const container = trackArea.parentElement!;
    trackArea.getBoundingClientRect = () =>
      ({ left: 0, width: 100, right: 100, top: 0, bottom: 20, height: 20 }) as DOMRect;

    fireEvent.pointerDown(start, { pointerId: 4, pointerType: "touch" });
    fireEvent.pointerMove(container, { pointerId: 4, clientX: 25 });
    fireEvent.pointerUp(container, { pointerId: 4 });
    fireEvent.pointerDown(end, { pointerId: 5, pointerType: "touch" });
    fireEvent.pointerMove(container, { pointerId: 5, clientX: 75 });
    fireEvent.pointerUp(container, { pointerId: 5 });

    expect(onDrag).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledWith(null, null);
  });

  it("clamps externally supplied positions to the visual track", () => {
    const minMs = exifWallClockTimestamp(photos[0].date)!;
    const maxMs = exifWallClockTimestamp(photos[1].date)!;
    renderSlider({ fromMs: minMs - 100_000, toMs: maxMs + 100_000 });

    expect(screen.getByRole("slider", { name: "Start date" }).getAttribute("aria-valuenow")).toBe(
      "0",
    );
    expect(screen.getByRole("slider", { name: "End date" }).getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });
});
