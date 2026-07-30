import { PHOTO_EXTENSIONS, VIDEO_EXTENSIONS, isSupportedMediaFile } from "./albumMedia";

const prepare = require("../bin/prepare-optimised-images.cjs");
const { VIDEO_EXTENSIONS: VIDEO_EXTENSIONS_SOURCE } = require("./video");

describe("album media extensions", () => {
  // The image prepass and the page build must agree on what a photo is. When
  // they disagreed, the prepass skipped a file and the build then handed it to
  // sharp, which threw and failed the whole build.
  it("matches the image prepass's photo extension list", () => {
    expect([...PHOTO_EXTENSIONS].sort((a, b) => a.localeCompare(b))).toEqual(
      [...prepare.PHOTO_EXTENSIONS].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("matches the video extension list owned by services/video", () => {
    expect([...VIDEO_EXTENSIONS].sort((a, b) => a.localeCompare(b))).toEqual(
      [...VIDEO_EXTENSIONS_SOURCE].sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each([...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS])("accepts %s", (extension) => {
    expect(isSupportedMediaFile(`photo${extension}`)).toBe(true);
  });

  it("accepts the synthetic YouTube filename", () => {
    expect(isSupportedMediaFile("dQw4w9WgXcQ.youtube")).toBe(true);
  });

  it("accepts an uppercase extension", () => {
    expect(isSupportedMediaFile("DSCF2768.JPG")).toBe(true);
    expect(isSupportedMediaFile("CLIP.MOV")).toBe(true);
  });

  // The most likely first-run input for a new user is a folder of iPhone
  // exports; every one of these previously reached sharp.
  it.each([
    ["IMG_0001.HEIC"],
    ["IMG_0001.AAE"],
    ["IMG_0001.dng"],
    [".DS_Store"],
    ["desktop.ini"],
    ["notes.txt"],
  ])("rejects %s", (filename) => {
    expect(isSupportedMediaFile(filename)).toBe(false);
  });
});
