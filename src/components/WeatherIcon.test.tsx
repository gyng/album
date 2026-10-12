/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import {
  WeatherIcon,
  weatherTemperatureIcon,
  weatherCloudIcon,
  weatherFacetIcon,
} from "./WeatherIcon";

it.each([
  [-1, "temperature-freezing"],
  [0, "temperature-cold"],
  [9.9, "temperature-cold"],
  [10, "temperature-mild"],
  [19.9, "temperature-mild"],
  [20, "temperature-warm"],
  [29.9, "temperature-warm"],
  [30, "temperature-hot"],
])("uses the temperature range at %s°C", (value, kind) => {
  expect(weatherTemperatureIcon(value)).toBe(kind);
});

it.each([
  [0, "mostly-clear"],
  [24.9, "mostly-clear"],
  [25, "partly-cloudy"],
  [49.9, "partly-cloudy"],
  [50, "mostly-cloudy"],
  [74.9, "mostly-cloudy"],
  [75, "overcast"],
  [100, "overcast"],
  [null, "cloud"],
])("uses the cloud-cover range at %s%%", (value, kind) => {
  expect(weatherCloudIcon(value)).toBe(kind);
});

it("uses the same distinct graphics for facet ranges and measured values", () => {
  const temperatures = ["Below 0°C", "0–9°C", "10–19°C", "20–29°C", "30°C and above"];
  const clouds = ["0–24%", "25–49%", "50–74%", "75–100%"];
  for (const [facet, labels, values, icon] of [
    ["weather-temperature", temperatures, [-1, 0, 10, 20, 30], weatherTemperatureIcon],
    ["weather-cloud", clouds, [0, 25, 50, 75], weatherCloudIcon],
  ] as const) {
    const graphics = labels.map((label, index) => {
      const kind = weatherFacetIcon(facet, label);
      expect(kind).toBe(icon(values[index]!));
      const { container, unmount } = render(<WeatherIcon kind={kind} />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("aria-hidden", "true");
      const graphic = svg.innerHTML;
      unmount();
      return graphic;
    });
    expect(new Set(graphics).size).toBe(labels.length);
  }
});
