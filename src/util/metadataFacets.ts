import { parseWeatherMetadata, weatherCondition, type WeatherMetadata } from "./weather";

export const WEATHER_FACETS = [
  {
    id: "weather-condition",
    labels: null,
    displayName: "Conditions",
    value: (w: WeatherMetadata) => weatherCondition(w.weather_code),
  },
  {
    id: "weather-temperature",
    labels: ["Below 0°C", "0–9°C", "10–19°C", "20–29°C", "30°C and above"],
    displayName: "Temperature",
    value: (w: WeatherMetadata) =>
      w.temperature_2m < 0
        ? "Below 0°C"
        : w.temperature_2m < 10
          ? "0–9°C"
          : w.temperature_2m < 20
            ? "10–19°C"
            : w.temperature_2m < 30
              ? "20–29°C"
              : "30°C and above",
  },
  {
    id: "weather-precipitation",
    labels: ["Dry", "Precipitation"],
    displayName: "Precipitation in the preceding hour",
    value: (w: WeatherMetadata) =>
      w.precipitation === null ? null : w.precipitation > 0 ? "Precipitation" : "Dry",
  },
  {
    id: "weather-cloud",
    labels: ["0–24%", "25–49%", "50–74%", "75–100%"],
    displayName: "Cloud cover",
    value: (w: WeatherMetadata) =>
      w.cloud_cover === null
        ? null
        : w.cloud_cover < 25
          ? "0–24%"
          : w.cloud_cover < 50
            ? "25–49%"
            : w.cloud_cover < 75
              ? "50–74%"
              : "75–100%",
  },
] as const;
export const FRAMING_FACETS = [
  { id: "aspect-ratio", displayName: "Aspect ratio" },
  { id: "orientation", displayName: "Orientation" },
] as const;
export const METADATA_FACETS = [...FRAMING_FACETS, ...WEATHER_FACETS];
export const weatherFacetValue = (id: string, raw: unknown): string | null => {
  const weather = parseWeatherMetadata(raw);
  return weather ? (WEATHER_FACETS.find((facet) => facet.id === id)?.value(weather) ?? null) : null;
};
