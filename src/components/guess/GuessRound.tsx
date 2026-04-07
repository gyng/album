import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { distanceMetersBetween } from "../mapRoute";
import { Caption } from "../ui";
import styles from "./GuessRound.module.css";
import { GuessPhoto } from "./guessTypes";
import { fireConfetti } from "./confetti";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.15;

const GuessMap = dynamic(() => import("./GuessMapExport"), {
  loading: () => <div className={styles.mapPlaceholder} />,
  ssr: false,
});

const MAX_SCORE = 5000;
const DECAY_FACTOR = 250;

const computeScore = (distanceKm: number): number =>
  Math.round(MAX_SCORE * Math.exp(-distanceKm / DECAY_FACTOR));

const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString()} km`;
};

/** 0–1 ratio for the score bar width. */
const scoreRatio = (score: number): number => score / MAX_SCORE;

/** Returns a CSS colour based on score tier — green for close, amber mid, accent for far. */
const scoreTierColour = (score: number): string => {
  const ratio = score / MAX_SCORE;
  if (ratio >= 0.7) return "#22c55e";
  if (ratio >= 0.35) return "#eab308";
  return "var(--c-accent)";
};

export type RoundResult = {
  photo: GuessPhoto;
  distanceMeters: number;
  score: number;
  skipped: boolean;
};

type GuessRoundProps = {
  photo: GuessPhoto;
  roundNumber: number;
  totalRounds: number;
  cumulativeScore: number;
  difficulty: "easy" | "medium" | "hard";
  onComplete: (result: RoundResult) => void;
};

const getGeocodeLabel = (geocode: string): string | null => {
  if (!geocode) return null;
  const parts = geocode
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
  return parts[0];
};

/**
 * Imperatively animates a DOM element's textContent from 0 to the target value.
 * Avoids React state entirely so no re-renders are triggered during the count.
 */
const useAnimatedCounter = (
  target: number,
  durationMs = 600,
): React.RefCallback<HTMLElement> => {
  const rafRef = useRef<number>(0);
  const prevTarget = useRef<number | null>(null);

  return useCallback(
    (node: HTMLElement | null) => {
      cancelAnimationFrame(rafRef.current);
      if (!node) return;

      if (target === 0 || target === prevTarget.current) {
        node.textContent = target.toLocaleString();
        prevTarget.current = target;
        return;
      }
      prevTarget.current = target;

      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(eased * target).toLocaleString();
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    },
    [target, durationMs],
  );
};

export const GuessRound: React.FC<GuessRoundProps> = ({
  photo,
  roundNumber,
  totalRounds,
  cumulativeScore,
  difficulty,
  onComplete,
}) => {
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);

  // Photo zoom/pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const photoPanelRef = useRef<HTMLDivElement>(null);

  // Animated score counters — ref callbacks that imperatively update textContent
  const scoreCounterRef = useAnimatedCounter(result?.score ?? 0);
  const cumulativeCounterRef = useAnimatedCounter(
    revealed ? cumulativeScore + (result?.score ?? 0) : cumulativeScore,
  );

  const photoSrc = `/data/albums/${photo.albumName}/.resized_images/${photo.photoName}@1600.avif`;

  const handleGuess = useCallback((lat: number, lng: number) => {
    setGuess({ lat, lng });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!guess) return;

    const distanceMeters = distanceMetersBetween(
      { decLat: guess.lat, decLng: guess.lng },
      { decLat: photo.lat, decLng: photo.lng },
    );
    const score = computeScore(distanceMeters / 1000);
    const roundResult: RoundResult = {
      photo,
      distanceMeters,
      score,
      skipped: false,
    };

    setResult(roundResult);
    setRevealed(true);

    if (score / MAX_SCORE >= 0.7) {
      fireConfetti();
    }
  }, [guess, photo]);

  const handleSkip = useCallback(() => {
    const roundResult: RoundResult = {
      photo,
      distanceMeters: Infinity,
      score: 0,
      skipped: true,
    };
    setResult(roundResult);
    setRevealed(true);
  }, [photo]);

  const handleNext = useCallback(() => {
    if (result) onComplete(result);
  }, [result, onComplete]);

  // Photo zoom: scroll wheel zooms, drag pans, double-click resets
  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    setZoom((prev) => {
      const next = event.deltaY < 0 ? prev * ZOOM_STEP : prev / ZOOM_STEP;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (clamped === MIN_ZOOM) {
        panRef.current = { x: 0, y: 0 };
        setPan({ x: 0, y: 0 });
      }
      return clamped;
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (zoom <= MIN_ZOOM) return;
      dragging.current = true;
      dragStart.current = {
        x: event.clientX - panRef.current.x,
        y: event.clientY - panRef.current.y,
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [zoom],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragging.current) return;
    const next = {
      x: event.clientX - dragStart.current.x,
      y: event.clientY - dragStart.current.y,
    };
    panRef.current = next;
    setPan(next);
  }, []);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    setZoom(MIN_ZOOM);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, []);

  const isZoomed = zoom > MIN_ZOOM;

  // Keyboard shortcuts: Enter = confirm, Space/ArrowRight = next
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !revealed && guess) {
        event.preventDefault();
        handleConfirm();
      } else if (
        revealed &&
        (event.key === " " ||
          event.key === "ArrowRight" ||
          event.key === "Enter")
      ) {
        event.preventDefault();
        handleNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [revealed, guess, handleConfirm, handleNext]);

  const countryHint =
    difficulty === "easy" && photo.geocode
      ? photo.geocode.split("\n").pop()?.trim()
      : null;

  const geocodeLabel = revealed ? getGeocodeLabel(photo.geocode) : null;
  const tierColour =
    result && !result.skipped ? scoreTierColour(result.score) : undefined;

  return (
    <div className={styles.round}>
      {/* Top bar: progress dots + cumulative score */}
      <div className={styles.topBar}>
        <div className={styles.progressDots}>
          {Array.from({ length: totalRounds }, (_, idx) => (
            <span
              key={idx}
              className={[
                styles.dot,
                idx < roundNumber - 1 ? styles.dotDone : "",
                idx === roundNumber - 1 ? styles.dotCurrent : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
        <span
          className={[
            styles.cumulativeScore,
            revealed ? styles.cumulativeScoreBump : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span ref={cumulativeCounterRef}>{cumulativeScore.toLocaleString()}</span> pts
        </span>
      </div>

      <div className={styles.gameArea}>
        {/* Photo panel — scroll to zoom, drag to pan, double-click to reset */}
        <div
          ref={photoPanelRef}
          className={[styles.photoPanel, isZoomed ? styles.photoZoomed : ""]
            .filter(Boolean)
            .join(" ")}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <img
            src={photoSrc}
            alt=""
            className={styles.photo}
            draggable={false}
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            }}
          />
          {countryHint ? (
            <div className={styles.countryHint}>{countryHint}</div>
          ) : null}
          {!isZoomed ? (
            <div className={styles.zoomHint}>Scroll to zoom</div>
          ) : null}
        </div>

        {/* Map panel */}
        <div className={styles.mapPanel}>
          <GuessMap
            reveal={
              revealed ? { lat: photo.lat, lng: photo.lng } : undefined
            }
            onGuess={handleGuess}
          />

          <div className={styles.controls}>
            {!revealed ? (
              <>
                <button
                  className={[
                    styles.confirmButton,
                    guess ? styles.confirmReady : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={handleConfirm}
                  disabled={!guess}
                >
                  Confirm
                  <kbd className={styles.kbd}>Enter</kbd>
                </button>
                <button className={styles.skipButton} onClick={handleSkip}>
                  I have no idea
                </button>
              </>
            ) : (
              <div className={styles.revealPanel}>
                {result?.skipped ? (
                  <Caption as="span">Skipped</Caption>
                ) : (
                  <div className={styles.scoreReveal}>
                    <div className={styles.scoreLine}>
                      <span className={styles.distance}>
                        {formatDistance(result?.distanceMeters ?? 0)}
                      </span>
                      <span
                        className={styles.scoreValue}
                        style={tierColour ? { color: tierColour } : undefined}
                      >
                        +<span ref={scoreCounterRef}>0</span>
                      </span>
                    </div>
                    <div className={styles.scoreBarTrack}>
                      <div
                        className={styles.scoreBarFill}
                        style={{
                          width: `${scoreRatio(result?.score ?? 0) * 100}%`,
                          backgroundColor: tierColour,
                        }}
                      />
                    </div>
                  </div>
                )}
                {geocodeLabel ? (
                  <Caption as="span" size="sm">
                    {geocodeLabel}
                  </Caption>
                ) : null}
                <button className={styles.nextButton} onClick={handleNext}>
                  {roundNumber === totalRounds ? "See results" : "Next"}
                  <kbd className={styles.kbd}>
                    {roundNumber === totalRounds ? "Enter" : "\u2192"}
                  </kbd>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
