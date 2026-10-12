import type { WeatherMetadata } from "../util/weather";
import { weatherCondition } from "../util/weather";
import {
  WeatherIcon,
  weatherConditionIcon,
  weatherTemperatureIcon,
  weatherCloudIcon,
} from "./WeatherIcon";
import styles from "./PhotoWeatherDetails.module.css";

export const PhotoWeatherDetails = ({ weather }: { weather: WeatherMetadata }) => {
  const metrics = [
    [
      "Feels like",
      weatherTemperatureIcon(weather.apparent_temperature),
      weather.apparent_temperature,
      "°C",
    ],
    ["Humidity", "humidity", weather.relative_humidity_2m, "%"],
    ["Cloud cover", weatherCloudIcon(weather.cloud_cover), weather.cloud_cover, "%"],
    ["Wind", "wind", weather.wind_speed_10m, " km/h"],
    ["Precipitation, preceding hour", "rain", weather.precipitation, " mm"],
    [
      "Snowfall, preceding hour",
      "snow",
      weather.snowfall && weather.snowfall > 0 ? weather.snowfall : null,
      " cm",
    ],
  ] as const;
  return (
    <div className={styles.weather}>
      <div className={styles.summary}>
        <WeatherIcon kind={weatherConditionIcon(weatherCondition(weather.weather_code))} />{" "}
        {weatherCondition(weather.weather_code)} ·{" "}
        <WeatherIcon kind={weatherTemperatureIcon(weather.temperature_2m)} />{" "}
        {weather.temperature_2m.toFixed(1)}°C
      </div>
      <div className={styles.source}>
        Estimated hourly weather · {weather.model === "era5" ? "ERA5" : "ECMWF IFS"}
        <br />
        <a href="https://open-meteo.com/">Weather data by Open-Meteo</a>
        {" · "}
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
      </div>
      <details className={styles.provenance}>
        <summary>Estimate details</summary>
        <dl className={styles.metrics}>
          {metrics
            .filter(([, , value]) => value !== null)
            .map(([label, kind, value, unit]) => (
              <div key={label}>
                <dt>
                  <WeatherIcon kind={kind} /> {label}
                </dt>
                <dd>
                  {value}
                  {unit}
                </dd>
              </div>
            ))}
          <div>
            <dt>Hour (UTC)</dt>
            <dd>{weather.sampled_at.replace("T", " ").replace(":00Z", " UTC")}</dd>
          </div>
          {weather.grid_latitude !== null && weather.grid_longitude !== null ? (
            <div>
              <dt>Model grid</dt>
              <dd>
                {weather.grid_latitude.toFixed(3)}, {weather.grid_longitude.toFixed(3)}
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
    </div>
  );
};
