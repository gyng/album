import React, { useCallback, useEffect } from "react";
import { DataLayer, type LineFeature, type MapPointerEvent, MapView, Marker, useMap } from "../map";
import { TIER_DANGER } from "./guessScoring";
import { computeWrapAwareBounds } from "../../util/mapBounds";
import { MapLibreStyles } from "../MapLibreStyles";
import styles from "./GuessMap.module.css";

export type GuessMapProps = {
  /** Current guess position, managed by the parent. */
  guess: { lat: number; lng: number } | null;
  /** When set, shows the actual location and a connecting line from the guess. */
  reveal?: { lat: number; lng: number };
  onGuess: (lat: number, lng: number) => void;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/**
 * The guess-to-answer connection: a soft wide glow with the dashed line drawn
 * over it, so the link reads at a glance without hiding the map beneath.
 */
const connectionLines = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): LineFeature[] => {
  const path = [
    { lng: from.lng, lat: from.lat },
    { lng: to.lng, lat: to.lat },
  ];

  return [
    { id: "guess-line-glow", path, color: TIER_DANGER, width: 6, opacity: 0.2, blur: 4 },
    { id: "guess-line-stroke", path, color: TIER_DANGER, width: 2, dash: [4, 3] },
  ];
};

/**
 * Re-frames the map on reveal so both the guess pin and the true location are
 * visible — otherwise the connecting line runs off-screen and the answer marker
 * is never seen. Rendered as a child of <MapView> so it can use the map
 * imperatively (useMap() only works inside map children — see the map rules).
 */
const RevealFit: React.FC<{
  guess: { lat: number; lng: number } | null;
  reveal: { lat: number; lng: number };
}> = ({ guess, reveal }) => {
  const map = useMap();
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
    // round was skipped).
    const hasGuess = guessLat !== null && guessLng !== null;
    const points: [number, number][] = [
      [revealLng, revealLat],
      ...(hasGuess ? [[guessLng, guessLat] as [number, number]] : []),
    ];
    // Antimeridian-aware so a guess and answer on opposite sides of ±180° frame
    // the short hop rather than the whole globe.
    // The reveal point above guarantees a non-empty input.
    const [[west, south], [east, north]] = computeWrapAwareBounds(points)!;
    map.fitBounds(
      [
        { lng: west, lat: south },
        { lng: east, lat: north },
      ],
      { padding: 60, maxZoom: 6, duration: 800 },
    );
  }, [map, revealLat, revealLng, guessLat, guessLng]);

  return null;
};

export const GuessMap: React.FC<GuessMapProps> = ({ guess, reveal, onGuess }) => {
  const handleClick = useCallback(
    (event: MapPointerEvent) => {
      if (reveal) return;
      onGuess(event.at.lat, event.at.lng);
    },
    [reveal, onGuess],
  );

  return (
    <>
      <MapLibreStyles />
      <div className={styles.mapContainer} role="region" aria-label="Guess map">
        {/* Scroll-zoom, drag-pan and one-finger gestures are the provider
            defaults, which is what a guessing map wants. */}
        <MapView
          styleUrl={MAP_STYLE}
          initialView={{ center: { lng: 0, lat: 20 }, zoom: 1.5 }}
          onClick={handleClick}
          cursor={reveal ? "default" : "crosshair"}
          attribution={{ compact: true }}
        >
          {guess ? (
            <Marker at={{ lng: guess.lng, lat: guess.lat }} anchor="center">
              <div className={styles.guessPin} />
            </Marker>
          ) : null}

          {reveal ? (
            <>
              <RevealFit guess={guess} reveal={reveal} />
              <Marker at={{ lng: reveal.lng, lat: reveal.lat }} anchor="center">
                <div className={styles.actualPin} />
              </Marker>
              {guess ? <DataLayer id="guess-line" lines={connectionLines(guess, reveal)} /> : null}
            </>
          ) : null}
        </MapView>

        {!reveal && !guess ? <div className={styles.hint}>Click to place your guess</div> : null}
      </div>
    </>
  );
};
