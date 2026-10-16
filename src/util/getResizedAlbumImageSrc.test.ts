import { getResizedAlbumImageSrc, getResizedAlbumVideoSrc } from "./getResizedAlbumImageSrc";

it("maps an indexed album path to its 800px resized asset", () => {
  expect(getResizedAlbumImageSrc("../albums/test-simple/photo.jpg")).toBe(
    "/data/albums/test-simple/.resized_images/photo.jpg%40800.avif",
  );
});

describe("getResizedAlbumVideoSrc", () => {
  it("maps a clip to the transcoded file optimiseVideo wrote beside its album", () => {
    expect(getResizedAlbumVideoSrc("../albums/test-simple/DSCF0159.MOV")).toBe(
      "/data/albums/test-simple/.resized_videos/DSCF0159.MOV%401920.mp4",
    );
  });

  it("resolves a scene row to the clip it was extracted from", () => {
    // A per-minute scene (`clip.mov@t120`) is a frame inside the clip, so it
    // must name the clip's own playable file rather than one of its own.
    expect(getResizedAlbumVideoSrc("../albums/japan/clip.mov@t120")).toBe(
      "/data/albums/japan/.resized_videos/clip.mov%401920.mp4",
    );
  });

  it("maps any album path, leaving it to the caller to know it is a clip", () => {
    // The helper is a path builder, not a media-kind test: a photograph's path
    // maps into the video cache directory too, which is exactly what a caller
    // that already read `mediaKind` off the row expects.
    expect(getResizedAlbumVideoSrc("../albums/test-simple/photo.jpg")).toBe(
      "/data/albums/test-simple/.resized_videos/photo.jpg%401920.mp4",
    );
  });

  it("percent-encodes each segment, so an album with a space resolves", () => {
    expect(getResizedAlbumVideoSrc("../albums/first roll/clip.mov")).toBe(
      "/data/albums/first%20roll/.resized_videos/clip.mov%401920.mp4",
    );
  });
});
