import React from "react";
import { DataLayer, MapView, type PointFeature } from "./map";
import styles from "./StatsWorldMap.module.css";
import { MapLibreStyles } from "./MapLibreStyles";

type Props = {
  points: Array<{ lat: number; lng: number }>;
};

const STATS_PINK = "rgb(230, 32, 101)";
/** The ring that keeps a lone photo readable over dark tiles. */
const STATS_POINT_RING = { color: "rgba(255, 255, 255, 0.84)", width: 2 };
const STATS_POINT_RADIUS = 5;

export const StatsWorldMap: React.FC<Props> = ({ points }) => {
  const features = React.useMemo<PointFeature[]>(
    () =>
      points.map((point, index) => ({
        id: `stats-photo-${index}`,
        at: { lng: point.lng, lat: point.lat },
        color: STATS_PINK,
        radius: STATS_POINT_RADIUS,
      })),
    [points],
  );

  return (
    <>
      <MapLibreStyles />
      <div className={styles.container}>
        <div className={styles.shell}>
          <div className={styles.map}>
            <MapView
              initialView={{ center: { lng: 15, lat: 20 }, zoom: 1.25 }}
              styleUrl="https://api.maptiler.com/maps/toner-v2/style.json?key=iilC4hPY1594noPX9OQ2"
              attribution={false}
            >
              <DataLayer id="stats-photos" points={features} stroke={STATS_POINT_RING} cluster />
            </MapView>
          </div>
        </div>
      </div>
    </>
  );
};
