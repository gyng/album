/**
 * @jest-environment jsdom
 */

import { prefetchImageSrcSet, resetPrefetchedImages } from "./prefetchImage";

const sources = [
  { src: "/photo@800.avif", width: 800 },
  { src: "/photo@1600.avif", width: 1600 },
];

describe("prefetchImageSrcSet", () => {
  let made: HTMLImageElement[] = [];
  const RealImage = globalThis.Image;

  beforeEach(() => {
    resetPrefetchedImages();
    made = [];
    globalThis.Image = class extends RealImage {
      constructor() {
        super();
        made.push(this as unknown as HTMLImageElement);
      }
    } as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = RealImage;
  });

  // The whole point is that the browser picks the candidate it will pick on the
  // next page: choosing a width here guesses at a layout that has not happened.
  it("hands the browser the whole source set and the sizes it will be read at", () => {
    prefetchImageSrcSet(sources, "auto, 100vw");

    expect(made).toHaveLength(1);
    expect(made[0]?.sizes).toBe("auto, 100vw");
    expect(made[0]?.srcset).toBe("/photo@800.avif 800w, /photo@1600.avif 1600w");
  });

  it("fetches a photograph once however many times the pointer crosses it", () => {
    prefetchImageSrcSet(sources, "auto, 100vw");
    prefetchImageSrcSet(sources, "auto, 100vw");
    prefetchImageSrcSet(sources, "auto, 100vw");

    expect(made).toHaveLength(1);
  });

  it("has nothing to fetch for a block with no sources", () => {
    prefetchImageSrcSet([], "auto, 100vw");

    expect(made).toHaveLength(0);
  });

  // A reader who has asked for less data has asked for less data.
  it("leaves it alone under Save-Data", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });

    prefetchImageSrcSet(sources, "auto, 100vw");

    expect(made).toHaveLength(0);
    Object.defineProperty(navigator, "connection", { configurable: true, value: undefined });
  });
});
