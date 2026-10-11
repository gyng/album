import { parseWeatherMetadata, weatherCondition } from "./weather";

import { weatherFixture } from "../test/fixtures/weather";

it("reads valid weather JSON and keeps zero rainfall", () => {
  expect(parseWeatherMetadata(JSON.stringify(weatherFixture))).toEqual(weatherFixture);
});

it.each([
  undefined,
  "broken",
  {},
  { ...weatherFixture, temperature_2m: null },
  { ...weatherFixture, wind_speed_10m: "8" },
  { ...weatherFixture, sampled_at: "2024-01-01T23:00:00" },
])("rejects malformed or unsupported weather metadata", (value) => {
  expect(parseWeatherMetadata(value)).toBeNull();
});

it.each([
  [0, "Clear"],
  [3, "Overcast"],
  [65, "Rain"],
  [73, "Snow"],
  [99, "Thunderstorm"],
  [100, "Unknown"],
])("names WMO condition %i", (code, expected) => {
  expect(weatherCondition(code as number)).toBe(expected);
});
