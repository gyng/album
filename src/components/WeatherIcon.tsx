import styles from "./WeatherIcon.module.css";
import { WEATHER_FACETS } from "../util/metadataFacets";

const temperatureIcons = [
  "temperature-freezing",
  "temperature-cold",
  "temperature-mild",
  "temperature-warm",
  "temperature-hot",
] as const;
const cloudIcons = ["mostly-clear", "partly-cloudy", "mostly-cloudy", "overcast"] as const;

export type WeatherIconKind =
  | "sun"
  | "cloud"
  | "partly-cloudy"
  | "rain"
  | "snow"
  | "fog"
  | "storm"
  | "temperature"
  | "humidity"
  | "wind"
  | (typeof temperatureIcons)[number]
  | (typeof cloudIcons)[number];

export const weatherConditionIcon = (condition: string): WeatherIconKind => {
  if (condition === "Clear") return "sun";
  if (condition === "Mostly clear") return "mostly-clear";
  if (condition === "Partly cloudy") return "partly-cloudy";
  if (condition === "Overcast") return "overcast";
  if (condition === "Fog") return "fog";
  if (condition === "Thunderstorm") return "storm";
  if (condition.includes("Snow")) return "snow";
  if (
    condition.includes("rain") ||
    condition.includes("Rain") ||
    condition.includes("drizzle") ||
    condition.includes("Drizzle")
  )
    return "rain";
  return "cloud";
};

export const weatherTemperatureIcon = (value: number | null): WeatherIconKind =>
  value === null
    ? "temperature"
    : temperatureIcons[value < 0 ? 0 : value < 10 ? 1 : value < 20 ? 2 : value < 30 ? 3 : 4];

export const weatherCloudIcon = (value: number | null): WeatherIconKind =>
  value === null ? "cloud" : cloudIcons[value < 25 ? 0 : value < 50 ? 1 : value < 75 ? 2 : 3];

export const weatherFacetIcon = (facetId: string, label: string): WeatherIconKind => {
  if (facetId === "weather-condition") return weatherConditionIcon(label);
  if (facetId === "weather-temperature") {
    const index = WEATHER_FACETS[1].labels.findIndex((range) => range === label);
    return temperatureIcons[index] ?? "temperature";
  }
  if (facetId === "weather-cloud") {
    const index = WEATHER_FACETS[3].labels.findIndex((range) => range === label);
    return cloudIcons[index] ?? "cloud";
  }
  return label === "Dry" ? "sun" : "rain";
};

const cloud = <path d="M6 16a4 4 0 0 1-.5-8A6 6 0 0 1 17 7a4.5 4.5 0 0 1 1 9Z" />;

export const WeatherIcon = ({ kind }: { kind: WeatherIconKind }) => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === "sun" ? (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ) : null}
    {kind === "mostly-clear" ? (
      <>
        <circle cx="9" cy="9" r="4" />
        <path d="M9 1v2M1 9h2m.5-5.5L5 5M15 3l-2 2M3 15l2-2" />
        <path d="M12 19a3 3 0 0 1-.5-6A4 4 0 0 1 19 13a3 3 0 0 1 0 6Z" />
      </>
    ) : null}
    {kind === "mostly-cloudy" || kind === "overcast" ? (
      <>
        <path d="M4 9a3 3 0 0 1 3-4 5 5 0 0 1 9 1h2a3 3 0 0 1 3 3" />
        <g transform="translate(0 3)">{cloud}</g>
        {kind === "mostly-cloudy" ? <path d="M3 1v2M1 4h2m4-3L6 2" /> : null}
      </>
    ) : null}
    {kind === "partly-cloudy" ? (
      <>
        <path d="M8 3V1M3 8H1m2-5L1.5 1.5M8 5a3 3 0 0 0-3 3" />
        {cloud}
      </>
    ) : null}
    {["cloud", "rain", "snow", "storm", "fog"].includes(kind) ? cloud : null}
    {kind === "rain" ? <path d="m7 19-1 3m6-3-1 3m6-3-1 3" /> : null}
    {kind === "snow" ? <path d="M6 20h4m-2-2v4m6-2h4m-2-2v4" /> : null}
    {kind === "storm" ? <path d="m13 15-3 4h4l-3 4" /> : null}
    {kind === "fog" ? <path d="M4 19h16M6 22h12" /> : null}
    {kind === "temperature" ? (
      <>
        <path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z" />
        <path d="M12 8v10m6-12h3m-3 4h2" />
        <circle cx="12" cy="18" r="1" />
      </>
    ) : null}
    {kind.startsWith("temperature-") ? (
      <>
        <path d="M5 15V5a3 3 0 0 1 6 0v10a4 4 0 1 1-6 0Z" />
        <circle cx="8" cy="18" r="1.5" fill="currentColor" />
        <path
          d={`M8 18V${kind === "temperature-freezing" ? 16 : kind === "temperature-cold" ? 13 : kind === "temperature-mild" ? 10 : kind === "temperature-warm" ? 7 : 4}`}
          strokeWidth="2.5"
        />
        {kind === "temperature-freezing" ? (
          <path d="M18 5v8m-3.5-6 7 4m-7 0 7-4" />
        ) : kind === "temperature-hot" ? (
          <>
            <circle cx="18" cy="8" r="2" />
            <path d="M18 3V2m0 12v-1m4-5h1m-9 0h-1m2-4-1-1m7 1 1-1m-7 9-1 1m7-1 1 1" />
          </>
        ) : (
          <path d="M15 6h4m-4 4h3m-3 4h4" />
        )}
      </>
    ) : null}
    {kind === "humidity" ? (
      <>
        <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z" />
        <path d="m9 17 6-5m-6 0h.01M15 17h.01" />
      </>
    ) : null}
    {kind === "wind" ? (
      <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" />
    ) : null}
  </svg>
);
