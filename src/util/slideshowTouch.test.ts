import {
  getNextSlideshowOverlayPreset,
  getSlideshowTouchTapAction,
} from "./slideshowTouch";

describe("getSlideshowTouchTapAction", () => {
  it("advances on right-side taps", () => {
    expect(
      getSlideshowTouchTapAction({
        clientX: 800,
        bounds: { left: 0, width: 1000 },
        canGoPrevious: true,
      }),
    ).toBe("next");
  });

  it("goes previous on left-side taps when history is available", () => {
    expect(
      getSlideshowTouchTapAction({
        clientX: 120,
        bounds: { left: 0, width: 1000 },
        canGoPrevious: true,
      }),
    ).toBe("previous");
  });

  it("advances on left-side taps when there is no previous photo", () => {
    expect(
      getSlideshowTouchTapAction({
        clientX: 120,
        bounds: { left: 0, width: 1000 },
        canGoPrevious: false,
      }),
    ).toBe("next");
  });
});

describe("getNextSlideshowOverlayPreset", () => {
  it("progressively enables details, map, and clock before disabling all", () => {
    const details = getNextSlideshowOverlayPreset({
      showDetails: false,
      showMap: false,
      showClock: false,
    });
    expect(details).toEqual({
      showDetails: true,
      showMap: false,
      showClock: false,
    });

    const map = getNextSlideshowOverlayPreset(details);
    expect(map).toEqual({
      showDetails: true,
      showMap: true,
      showClock: false,
    });

    const clock = getNextSlideshowOverlayPreset(map);
    expect(clock).toEqual({
      showDetails: true,
      showMap: true,
      showClock: true,
    });

    expect(getNextSlideshowOverlayPreset(clock)).toEqual({
      showDetails: false,
      showMap: false,
      showClock: false,
    });
  });

  it("resets mixed toolbar states to all disabled", () => {
    expect(
      getNextSlideshowOverlayPreset({
        showDetails: false,
        showMap: true,
        showClock: false,
      }),
    ).toEqual({
      showDetails: false,
      showMap: false,
      showClock: false,
    });
  });
});
