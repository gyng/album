/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ParallelRelationshipData } from "../util/computeStats";
import { TechnicalHeatmaps } from "./TechnicalHeatmaps";

const hourBuckets = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

const data: ParallelRelationshipData = {
  axes: [
    { facetId: "hour", label: "Time", buckets: hourBuckets },
    { facetId: "aperture", label: "Aperture", buckets: ["f/2", "f/4"] },
    { facetId: "iso", label: "ISO", buckets: ["100", "200"] },
  ],
  paths: [
    { values: ["00:00", "f/2", "100"], count: 5 },
    { values: ["00:00", "f/2", "100"], count: 3 },
    { values: ["00:00", "f/2", "200"], count: 1 },
    { values: ["01:00", "f/4", "200"], count: 2 },
  ],
  total: 11,
};

describe("TechnicalHeatmaps", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let requestFrame: jest.SpyInstance;
  let cancelFrame: jest.SpyInstance;

  const flushFrames = () => {
    const pending = Array.from(frames.entries());
    frames.clear();
    act(() => {
      pending.forEach(([, callback]) => callback(0));
    });
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    requestFrame = jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });
    cancelFrame = jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("renders aggregated populated cells, empty cells, sparse hours, and search links", () => {
    const { container } = render(<TechnicalHeatmaps data={data} activeXAxisBucket="00:00" />);

    expect(screen.getByRole("heading", { name: "Time × Aperture" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Time × ISO" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Aperture × ISO" })).toBeTruthy();
    const aggregate = screen.getByTitle("00:00 · f/2 · 9 photos");
    expect(aggregate.getAttribute("href")).toContain("facet=hour%3A00%3A00");
    expect(aggregate.getAttribute("href")).toContain("facet=aperture%3Af%2F2");
    expect(container.querySelectorAll("a").length).toBeGreaterThan(3);
    expect(container.querySelectorAll("section")).toHaveLength(3);
    expect(screen.getByText(/Hover a square to trace/)).toBeTruthy();

    flushFrames();
  });

  it("draws weighted relationship overlays on hover and clears them on leave", () => {
    const { container, rerender } = render(<TechnicalHeatmaps data={data} />);
    flushFrames();

    const wrapper = container.firstElementChild as HTMLElement;
    wrapper.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }) as DOMRect;
    Array.from(container.querySelectorAll("a")).forEach((node, index) => {
      node.getBoundingClientRect = () =>
        ({
          left: 20 + index * 10,
          top: 30 + index * 5,
          width: 8,
          height: 8,
          right: 28 + index * 10,
          bottom: 38 + index * 5,
        }) as DOMRect;
    });

    const source = screen.getByTitle("00:00 · f/2 · 9 photos");
    fireEvent.mouseEnter(source);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(cancelFrame).toHaveBeenCalled();
    flushFrames();

    const overlay = container.querySelector('svg[aria-hidden="true"]');
    expect(overlay).toBeTruthy();
    expect(overlay?.querySelectorAll("path")).toHaveLength(4);
    expect(overlay?.textContent).toContain("8");
    expect(overlay?.textContent).toContain("1");
    const opacities = Array.from(overlay?.querySelectorAll("g g") ?? []).map(
      (node) => (node as SVGGElement).style.opacity,
    );
    expect(opacities).toContain("0.45");

    fireEvent.mouseLeave(source);
    flushFrames();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeNull();

    fireEvent.mouseEnter(source);
    flushFrames();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    rerender(<TechnicalHeatmaps data={data} pairs={[[1, 2]]} />);
    flushFrames();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeNull();
    rerender(<TechnicalHeatmaps data={data} pairs={[[1, 2]]} caption="Still filtered" />);
    flushFrames();
  });

  it.each([
    ["stacked", undefined, undefined],
    ["two-up", [[0, 1]] as Array<[number, number]>, undefined],
    [
      "diagonal",
      [
        [0, 1],
        [1, 2],
      ] as Array<[number, number]>,
      { "0-1": "First", "1-2": "Second" },
    ],
    ["tri-grid", undefined, undefined],
  ] as const)("mounts and cleans up the %s layout", (layout, pairs, titles) => {
    const { unmount } = render(
      <TechnicalHeatmaps
        data={data}
        layout={layout}
        {...(pairs ? { pairs: [...pairs] } : {})}
        {...(titles ? { titles } : {})}
        caption="Custom caption"
      />,
    );

    if (layout === "diagonal") {
      expect(screen.getByRole("heading", { name: "First" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    }
    expect(screen.getByText("Custom caption")).toBeTruthy();
    document.querySelectorAll("section").forEach((section) => {
      const link = section.querySelector("a");
      if (link) {
        fireEvent.focus(link);
        fireEvent.blur(link);
      }
    });
    unmount();
    expect(cancelFrame).toHaveBeenCalled();
  });
});
