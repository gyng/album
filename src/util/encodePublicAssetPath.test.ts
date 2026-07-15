import { encodePublicAssetPath } from "./encodePublicAssetPath";

describe("encodePublicAssetPath", () => {
  it("canonicalises the size separator", () => {
    expect(encodePublicAssetPath("/data/albums/kanto/.resized_images/DSCF1.jpg@800.avif")).toBe(
      "/data/albums/kanto/.resized_images/DSCF1.jpg%40800.avif",
    );
  });

  it("encodes every reserved character so the canonical form is stable", () => {
    // Next's production static serving only matches the canonical encoding
    // once any part of the path needs escaping, so "@" must become "%40".
    expect(
      encodePublicAssetPath("/data/albums/türkiye/.resized_images/DSCF4983.JPG@800.avif"),
    ).toBe("/data/albums/t%C3%BCrkiye/.resized_images/DSCF4983.JPG%40800.avif");
  });

  it("encodes spaces so srcSet candidate parsing stays intact", () => {
    expect(
      encodePublicAssetPath(
        "/data/albums/taiwan/.resized_images/2015-10-18 16.10.22.jpg@1600.avif",
      ),
    ).toBe("/data/albums/taiwan/.resized_images/2015-10-18%2016.10.22.jpg%401600.avif");
  });

  it("preserves the path structure", () => {
    expect(encodePublicAssetPath("/a/b/c")).toBe("/a/b/c");
  });
});
