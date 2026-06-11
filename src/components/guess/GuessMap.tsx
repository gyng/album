import React, { useCallback, useEffect } from "react";
import Map, { Marker, Source, Layer, useMap } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TIER_DANGER } from "./guessScoring";
import styles from "./GuessMap.module.css";

export type GuessMapProps = {
  /** Current guess position, managed by the parent. */
  guess: { lat: number; lng: number } | null;
  /** When set, shows the actual location and a connecting line from the guess. */
  reveal?: { lat: number; lng: number };
  onGuess: (lat: number, lng: number) => void;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

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

/**
 * Re-frames the map on reveal so both the guess pin and the true location are
 * visible — otherwise the connecting line runs off-screen and the answer marker
 * is never seen. Rendered as a child of <Map> so it can use the map imperatively
 * (useMap() only works inside MapLibreMap children — see the map rules).
 */
const RevealFit: React.FC<{
  guess: { lat: number; lng: number } | null;
  reveal: { lat: number; lng: number };
}> = ({ guess, reveal }) => {
  const { current: map } = useMap();
  // Depend on primitive coordinates rather than the object identities: the
  // parent recreates the `reveal`/`guess` objects each render, which would
  // otherwise re-fire fitBounds on every re-render of the revealed round.
  const revealLat = reveal.lat;
  const revealLng = reveal.lng;
  const guessLat = guess?.lat ?? null;
  const guessLng = guess?.lng ?? null;

  useEffect(() => {
    if (!map) return;
    // Frame both the guess and the true location (or just the answer when the
    // round was skipped). Uses the corner-array form of fitBounds to match the
    // map's MapAutoFit pattern.
    const hasGuess = guessLat !== null && guessLng !== null;
    const lngs = [revealLng, ...(hasGuess ? [guessLng] : [])];
    const lats = [revealLat, ...(hasGuess ? [guessLat] : [])];
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 6, duration: 800 },
    );
  }, [map, revealLat, revealLng, guessLat, guessLng]);

  return null;
};

export const GuessMap: React.FC<GuessMapProps> = ({
  guess,
  reveal,
  onGuess,
}) => {
  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (reveal) return;
      const { lat, lng } = event.lngLat;
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
        dragPan
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
            <RevealFit guess={guess} reveal={reveal} />
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
                      "line-color": TIER_DANGER,
                      "line-width": 6,
                      "line-opacity": 0.2,
                      "line-blur": 4,
                    }}
                  />
                  <Layer
                    id="guess-line-layer"
                    type="line"
                    paint={{
                      "line-color": TIER_DANGER,
                      "line-width": 2,
                      "line-dasharray": [4, 3],
                    }}
                  />
                </Source>
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
