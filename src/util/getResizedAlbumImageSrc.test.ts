import { getResizedAlbumImageSrc } from "./getResizedAlbumImageSrc";

it("maps an indexed album path to its 800px resized asset", () => {
  expect(getResizedAlbumImageSrc("../albums/test-simple/photo.jpg")).toBe(
    "/data/albums/test-simple/.resized_images/photo.jpg%40800.avif",
  );
});
