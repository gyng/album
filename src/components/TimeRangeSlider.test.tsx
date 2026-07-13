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

const renderSlider = () => {
  const onDrag = jest.fn();
  const onCommit = jest.fn();
  render(
    <TimeRangeSlider
      photos={photos}
      fromMs={fromMs}
      toMs={toMs}
      onDrag={onDrag}
      onCommit={onCommit}
    />,
  );
  return { onDrag, onCommit };
};

describe("TimeRangeSlider", () => {
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
});
