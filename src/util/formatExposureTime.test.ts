import { formatExposureTime } from "./formatExposureTime";

it.each([
  [1 / 125, "1⁄125s"],
  [0.5, "1⁄2s"],
  [40691 / 1000000, "0.0407s"],
  [0.3, "0.300s"],
  [2, "2s"],
])("formats exposure %s readably", (seconds, expected) => {
  expect(formatExposureTime(seconds)).toBe(expected);
});
