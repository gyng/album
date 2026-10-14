/** @jest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { ALBUM_STEP_ATTRIBUTE, centreOffset, pickStep, useAlbumStepping } from "./useAlbumStepping";

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

describe("centreOffset", () => {
  it("measures a photograph's centre from the middle of the area below any sticky chrome", () => {
    // 900px viewport, 100px of sticky nav: the visible middle is 500.
    expect(centreOffset({ top: 300, height: 400 }, 100, 900)).toBe(0);
    expect(centreOffset({ top: 1300, height: 400 }, 100, 900)).toBe(1000);
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
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    // The second photograph is centred; the others sit a screen above and below.
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = Number(this.dataset.index);
      return { top: (index - 1) * 1000 + 100, height: 600 } as DOMRect;
    });
    jest.spyOn(window, "scrollTo").mockImplementation(((options: ScrollToOptions) => {
      // Back to the stop whose centre the scroll lands on.
      scrolled.push(options.top! / 1000 + 1);
    }) as typeof window.scrollTo);
  });
  afterEach(() => jest.restoreAllMocks());

  it("centres a photograph at a time with J, K and the arrows", () => {
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
