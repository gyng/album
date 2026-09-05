import { chooseRecentSlideshowPhoto } from "./recentSlideshowPhotos";
import { getSlideshowPhotoSrc } from "./slideshowQueue";

it("cycles cached photos within the current album pool without repeating the current one", () => {
  const a = { path: "../albums/test-simple/a.jpg", exif: "", geocode: "" };
  const b = { ...a, path: "../albums/test-simple/b.jpg" };
  const c = { ...a, path: "../albums/other/c.jpg" };
  const cached = [a, b, c].map(
    (photo) => `https://photos.example.com${getSlideshowPhotoSrc(photo)}`,
  );
  expect(chooseRecentSlideshowPhoto([a, b], cached, a.path)).toEqual(b);
  expect(chooseRecentSlideshowPhoto([a, b], cached, b.path)).toEqual(a);
  expect(chooseRecentSlideshowPhoto([a], cached, a.path)).toBeNull();
  expect(chooseRecentSlideshowPhoto([a, b], [], a.path)).toBeNull();
});
