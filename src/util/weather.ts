export type WeatherMetadata = {
  version: 1;
  source: "open-meteo";
  model: "era5" | "ecmwf_ifs";
  sampled_at: string;
  fetched_at: string;
  latitude: number;
  longitude: number;
  grid_latitude: number | null;
  grid_longitude: number | null;
  temperature_2m: number;
  weather_code: number;
  apparent_temperature: number | null;
  relative_humidity_2m: number | null;
  precipitation: number | null;
  cloud_cover: number | null;
  wind_speed_10m: number | null;
  snowfall: number | null;
};

const nullableFields = [
  "grid_latitude",
  "grid_longitude",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "cloud_cover",
  "wind_speed_10m",
  "snowfall",
] as const;

export const parseWeatherMetadata = (raw: unknown): WeatherMetadata | null => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== 1 ||
      value.source !== "open-meteo" ||
      !["era5", "ecmwf_ifs"].includes(value.model) ||
      typeof value.sampled_at !== "string" ||
      !value.sampled_at.endsWith("Z") ||
      !Number.isFinite(Date.parse(value.sampled_at)) ||
      typeof value.fetched_at !== "string" ||
      !Number.isFinite(Date.parse(value.fetched_at)) ||
      ![value.latitude, value.longitude, value.temperature_2m, value.weather_code].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      ) ||
      !nullableFields.every(
        (key) =>
          value[key] === null || (typeof value[key] === "number" && Number.isFinite(value[key])),
      )
    )
      return null;
    return value as WeatherMetadata;
  } catch {
    return null;
  }
};

export const weatherCondition = (code: number): string => {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown";
};
