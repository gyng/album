import { pickPosterVariant } from "./videoPoster";

const variant = (width: number) => ({
  src: `/data/albums/trip/.resized_images/clip.mov%40${width}.avif`,
  width,
  height: Math.round(width * 0.5625),
});

describe("pickPosterVariant", () => {
  it("takes the largest variant that does not exceed the target width", () => {
    expect(pickPosterVariant([variant(800), variant(1600), variant(3200)], 1600)?.width).toBe(1600);
    expect(pickPosterVariant([variant(800), variant(1600), variant(3200)], 1000)?.width).toBe(800);
  });

  // A poster only ever has to look right at its display size; sending the
  // 3200px variant to a `<video poster>` would download megabytes for a frame
  // the viewer replaces on play.
  it("falls back to the smallest variant when every one is too large", () => {
    expect(pickPosterVariant([variant(1600), variant(3200)], 800)?.width).toBe(1600);
  });

  it("returns undefined when there are no variants", () => {
    expect(pickPosterVariant([], 1600)).toBeUndefined();
    expect(pickPosterVariant(undefined, 1600)).toBeUndefined();
  });
});
