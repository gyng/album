import React, { useCallback, useState } from "react";
import Map, { Marker, Source, Layer, useMap } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./GuessMap.module.css";

export type GuessMapProps = {
  /** When set, shows the actual location and a connecting line from the guess. */
  reveal?: { lat: number; lng: number };
  onGuess: (lat: number, lng: number) => void;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const RevealFitter: React.FC<{
  guess: { lat: number; lng: number };
  actual: { lat: number; lng: number };
}> = ({ guess, actual }) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map) return;

    const bounds: LngLatBoundsLike = [
      [
        Math.min(guess.lng, actual.lng) - 2,
        Math.min(guess.lat, actual.lat) - 2,
      ],
      [
        Math.max(guess.lng, actual.lng) + 2,
        Math.max(guess.lat, actual.lat) + 2,
      ],
    ];

    map.fitBounds(bounds, { padding: 60, duration: 1200 });
  }, [map, guess, actual]);

  return null;
};

const lineGeoJson = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
    },
  ],
});

export const GuessMap: React.FC<GuessMapProps> = ({ reveal, onGuess }) => {
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (reveal) return;
      const { lat, lng } = event.lngLat;
      setGuess({ lat, lng });
      onGuess(lat, lng);
    },
    [reveal, onGuess],
  );

  return (
    <div className={styles.mapContainer}>
      <Map
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.5 }}
        scrollZoom
        cooperativeGestures={false}
        onClick={handleClick}
        cursor={reveal ? "default" : "crosshair"}
        attributionControl={{ compact: true }}
      >
        {guess ? (
          <Marker
            longitude={guess.lng}
            latitude={guess.lat}
            anchor="center"
          >
            <div className={styles.guessPin} />
          </Marker>
        ) : null}

        {reveal ? (
          <>
            <Marker
              longitude={reveal.lng}
              latitude={reveal.lat}
              anchor="center"
            >
              <div className={styles.actualPin} />
            </Marker>
            {guess ? (
              <>
                <Source
                  id="guess-line"
                  type="geojson"
                  data={lineGeoJson(guess, reveal)}
                >
                  <Layer
                    id="guess-line-glow"
                    type="line"
                    paint={{
                      "line-color": "#ef4444",
                      "line-width": 6,
                      "line-opacity": 0.2,
                      "line-blur": 4,
                    }}
                  />
                  <Layer
                    id="guess-line-layer"
                    type="line"
                    paint={{
                      "line-color": "#ef4444",
                      "line-width": 2,
                      "line-dasharray": [4, 3],
                    }}
                  />
                </Source>
                <RevealFitter guess={guess} actual={reveal} />
              </>
            ) : null}
          </>
        ) : null}
      </Map>

      {!reveal && !guess ? (
        <div className={styles.hint}>Click to place your guess</div>
      ) : null}
    </div>
  );
};
