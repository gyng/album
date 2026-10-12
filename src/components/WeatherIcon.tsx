import styles from "./WeatherIcon.module.css";

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
  | "wind";

export const weatherConditionIcon = (condition: string): WeatherIconKind => {
  if (condition === "Clear") return "sun";
  if (["Mostly clear", "Partly cloudy"].includes(condition)) return "partly-cloudy";
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

const cloud = <path d="M6 16a4 4 0 0 1-.5-8A6 6 0 0 1 17 7a4.5 4.5 0 0 1 1 9Z" />;

export const WeatherIcon = ({ kind }: { kind: WeatherIconKind }) => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === "sun" ? (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
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
