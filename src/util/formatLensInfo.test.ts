import { formatLensInfo } from "./formatLensInfo";

// exifr hands LensInfo over as the four numbers EXIF stores, which printed as
// "23,23,1.4,1.4" wherever a lens had no model name to show instead.
it.each([
  [[23, 23, 1.4, 1.4], "23mm f/1.4"],
  [[16, 80, 4, 4], "16–80mm f/4"],
  [[18, 55, 2.8, 4], "18–55mm f/2.8–4"],
  ["XF 23mm F1.4", "XF 23mm F1.4"],
])("formats lens range %j readably", (lensInfo, expected) => {
  expect(formatLensInfo(lensInfo)).toBe(expected);
});

it("formats nothing it cannot read", () => {
  expect(formatLensInfo(undefined)).toBeUndefined();
  expect(formatLensInfo([0, 0, 0, 0])).toBeUndefined();
  expect(formatLensInfo([23])).toBeUndefined();
});
