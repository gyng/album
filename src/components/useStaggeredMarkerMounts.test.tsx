/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { useStaggeredMarkerMounts } from "./useStaggeredMarkerMounts";

const photos = (count: number, prefix = "p") =>
  Array.from({ length: count }, (_, index) => ({ href: `${prefix}-${index}` }));

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Runs whatever frames are pending, as the browser would on the next paint. */
const nextFrame = () => {
  const pending = frames;
  frames = [];
  act(() => {
    pending.forEach((callback) => {
      callback(performance.now());
    });
  });
};

it("admits markers a chunk at a time instead of all at once", () => {
  const { result } = renderHook(() => useStaggeredMarkerMounts(photos(10), 4));
  expect(result.current).toHaveLength(4);

  nextFrame();
  expect(result.current).toHaveLength(8);

  nextFrame();
  expect(result.current).toHaveLength(10);

  // Converged: nothing left to schedule.
  expect(frames).toHaveLength(0);
});

it("keeps what is already mounted while the rest arrive", () => {
  const all = photos(6);
  const { result, rerender } = renderHook(({ items }) => useStaggeredMarkerMounts(items, 2), {
    initialProps: { items: all },
  });
  expect(result.current.map((photo) => photo.href)).toEqual(["p-0", "p-1"]);

  // A pan that keeps the first two and brings two more into range must not
  // unmount the pair already on the map.
  rerender({ items: [...all.slice(0, 2), { href: "q-0" }, { href: "q-1" }] });
  expect(result.current.map((photo) => photo.href)).toEqual(["p-0", "p-1"]);

  nextFrame();
  expect(result.current.map((photo) => photo.href)).toEqual(["p-0", "p-1", "q-0", "q-1"]);
});

it("admits nothing while the markers are not being drawn, and staggers from scratch when they are", () => {
  // Below the thumbnail zoom the photos are one GPU layer and no marker is
  // mounted at all. Admitting them in the background would spend the whole
  // stagger before the reveal, and hand the reveal every marker at once —
  // which is the burst this exists to spread.
  const { result, rerender } = renderHook(
    ({ enabled }) => useStaggeredMarkerMounts(photos(10), 4, enabled),
    { initialProps: { enabled: false } },
  );
  expect(result.current).toHaveLength(0);

  nextFrame();
  expect(result.current).toHaveLength(0);

  rerender({ enabled: true });
  expect(result.current).toHaveLength(4);

  nextFrame();
  expect(result.current).toHaveLength(8);
});

it("shows a chunk at once when the map is handed a set it has never shown", () => {
  const { result, rerender } = renderHook(({ items }) => useStaggeredMarkerMounts(items, 2), {
    initialProps: { items: photos(2) },
  });
  expect(result.current).toHaveLength(2);

  // A jump somewhere else entirely: the previous markers go immediately, and
  // the new ones must not leave the map looking empty for a frame first.
  rerender({ items: photos(5, "q") });
  expect(result.current.map((photo) => photo.href)).toEqual(["q-0", "q-1"]);

  nextFrame();
  expect(result.current).toHaveLength(4);

  nextFrame();
  expect(result.current).toHaveLength(5);
});
