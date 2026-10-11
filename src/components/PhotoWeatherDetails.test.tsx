/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PhotoWeatherDetails } from "./PhotoWeatherDetails";
import { weatherFixture } from "../test/fixtures/weather";

it("shows estimated conditions, zero rainfall, units and attribution", () => {
  render(<PhotoWeatherDetails weather={weatherFixture} />);
  expect(screen.getByText("Overcast · 27.0°C")).toBeTruthy();
  expect(screen.getByText("0 mm")).toBeTruthy();
  expect(screen.getByText("8 km/h")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Weather data by Open-Meteo" })).toHaveAttribute(
    "href",
    "https://open-meteo.com/",
  );
  expect(screen.queryByText("Snowfall, preceding hour")).toBeNull();
});

it("omits missing metrics while retaining available values", () => {
  render(
    <PhotoWeatherDetails weather={{ ...weatherFixture, wind_speed_10m: null, snowfall: 1.5 }} />,
  );
  expect(screen.queryByText("Wind")).toBeNull();
  expect(screen.getByText("1.5 cm")).toBeTruthy();
});
