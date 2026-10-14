/** @jest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { ALBUM_STEP_ATTRIBUTE, pickStep, useAlbumStepping } from "./useAlbumStepping";

describe("pickStep", () => {
  it("steps to the first stop below and the last one above", () => {
    // Partway through the second photograph.
    const offsets = [-1800, -300, 600, 1500];
    expect(pickStep(offsets, 1)).toBe(2);
    expect(pickStep(offsets, -1)).toBe(1);
  });

  it("treats a stop already in place as the current one", () => {
    const offsets = [-900, 0.5, 900];
    expect(pickStep(offsets, 1)).toBe(2);
    expect(pickStep(offsets, -1)).toBe(0);
  });

  it("has nowhere to go past either end", () => {
    expect(pickStep([0, 900], -1)).toBeNull();
    expect(pickStep([-900, 0], 1)).toBeNull();
  });
});

describe("useAlbumStepping", () => {
  const Album = () => {
    useAlbumStepping();
    return (
      <>
        <input aria-label="Search" />
        {[0, 1, 2].map((index) => (
          <section key={index} {...{ [ALBUM_STEP_ATTRIBUTE]: "" }} data-index={index} />
        ))}
      </>
    );
  };
  let scrolled: number[];
  let now: number;

  beforeEach(() => {
    scrolled = [];
    now = 0;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    // The reader is at the top of the second photograph.
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = (Number(this.dataset.index) - 1) * 1000;
      return { top } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement) {
        scrolled.push(Number(this.dataset.index));
      },
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("moves a photograph at a time with J, K and the arrows", () => {
    render(<Album />);
    fireEvent.keyDown(window, { key: "j" });
    now = 1000;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(scrolled).toEqual([2, 0]);
  });

  it("keeps stepping while a smooth scroll is still on its way", () => {
    render(<Album />);
    fireEvent.keyDown(window, { key: "k" });
    now = 100;
    fireEvent.keyDown(window, { key: "j" });
    expect(scrolled).toEqual([0, 1]);
  });

  it("leaves keys alone in a text field or with a modifier", () => {
    const view = render(<Album />);
    fireEvent.keyDown(view.getByLabelText("Search"), { key: "j" });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(scrolled).toEqual([]);
  });
});
