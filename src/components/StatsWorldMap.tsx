import React from "react";
import Map, { Layer, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./StatsWorldMap.module.css";

type Props = {
  points: Array<{ lat: number; lng: number }>;
};

const STATS_PINK = "rgb(230, 32, 101)";

const clusterLayer = {
  id: "stats-clusters",
  type: "circle" as const,
  filter: ["has", "point_count"],
  paint: {
    "circle-color": STATS_PINK,
    "circle-stroke-color": "rgba(255,255,255,0.78)",
    "circle-stroke-width": 2,
    "circle-radius": [
      "step",
      ["get", "point_count"],
      13,
      10,
      18,
      30,
      24,
      80,
      31,
    ],
    "circle-blur": 0.08,
  },
};

const clusterCountLayer = {
  id: "stats-cluster-count",
  type: "symbol" as const,
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count"],
    "text-size": 12,
    "text-font": ["Noto Sans Bold"],
  },
  paint: {
    "text-color": "rgba(0, 0, 0, 0.9)",
    "text-halo-color": "rgba(255, 255, 255, 0.96)",
    "text-halo-width": 1.2,
    "text-halo-blur": 0.4,
  },
};

const pointLayer = {
  id: "stats-unclustered-point",
  type: "circle" as const,
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": STATS_PINK,
    "circle-stroke-color": "rgba(255,255,255,0.84)",
    "circle-stroke-width": 2,
    "circle-radius": 5,
  },
};

export const StatsWorldMap: React.FC<Props> = ({ points }) => {
  const geoJson = React.useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: points.map((point) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Point" as const,
          coordinates: [point.lng, point.lat] as [number, number],
        },
      })),
    }),
    [points],
  );

  return (
    <div className={styles.shell}>
      <div className={styles.map}>
        <Map
          initialViewState={{
            longitude: 15,
            latitude: 20,
            zoom: 1.25,
          }}
          mapStyle="https://api.maptiler.com/maps/toner-v2/style.json?key=iilC4hPY1594noPX9OQ2"
          attributionControl={false}
        >
          <Source
            id="stats-photo-points"
            type="geojson"
            data={geoJson}
            cluster
            clusterMaxZoom={12}
            clusterRadius={42}
          >
            <Layer {...(clusterLayer as any)} />
            <Layer {...(clusterCountLayer as any)} />
            <Layer {...(pointLayer as any)} />
          </Source>
        </Map>
      </div>
    </div>
  );
};
