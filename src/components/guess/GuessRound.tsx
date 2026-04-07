import React, { useCallback, useEffect, useRef, useState } from "react";
import { distanceMetersBetween } from "../mapRoute";
import { Caption } from "../ui";
import styles from "./GuessRound.module.css";
import { GuessPhoto } from "./guessTypes";
import { fireConfetti } from "./confetti";
import {
  MAX_SCORE,
  computeScore,
  computeTimeBonus,
  formatDistance,
  scoreRatio,
  scoreTierColour,
} from "./guessScoring";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.15;

export type RoundResult = {
  photo: GuessPhoto;
  distanceMeters: number;
  /** Distance-based score (max 5,000). */
  distanceScore: number;
  /** Time bonus (max 1,000, 0 when timer is off). */
  timeBonus: number;
  /** Total: distanceScore + timeBonus. */
  score: number;
  skipped: boolean;
};

type GuessRoundProps = {
  photo: GuessPhoto;
  roundNumber: number;
  totalRounds: number;
  cumulativeScore: number;
  timeLimit: number | null;
  /** Externally managed guess from the persistent map. */
  guess: { lat: number; lng: number } | null;
  onComplete: (result: RoundResult) => void;
  onReveal: () => void;
  onAbort: () => void;
  /** Persistent map element rendered by the parent to avoid remounts. */
  mapSlot: React.ReactNode;
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
  timeLimit,
  guess,
  onComplete,
  onReveal,
  onAbort,
  mapSlot,
}) => {
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Reset round-local state when the photo changes.
  // setState during render is the React-approved pattern for syncing state
  // with props — React re-renders immediately before painting.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevPath, setPrevPath] = useState(photo.path);
  if (prevPath !== photo.path) {
    setPrevPath(photo.path);
    setRevealed(false);
    setResult(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  const panRef = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const photoPanelRef = useRef<HTMLDivElement>(null);

  // Animated score counters — ref callbacks that imperatively update textContent
  const scoreCounterRef = useAnimatedCounter(result?.score ?? 0);
  const cumulativeCounterRef = useAnimatedCounter(
    revealed ? cumulativeScore + (result?.score ?? 0) : cumulativeScore,
  );

  // Timer state — must be declared before handlers that read it
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const timerCallbackRef = useRef<() => void>(() => {});

  const photoSrc = `/data/albums/${photo.albumName}/.resized_images/${photo.photoName}@1600.avif`;

  const handleConfirm = useCallback(() => {
    if (!guess) return;

    const distanceMeters = distanceMetersBetween(
      { decLat: guess.lat, decLng: guess.lng },
      { decLat: photo.lat, decLng: photo.lng },
    );
    const distanceScore = computeScore(distanceMeters / 1000);
    const timeBonus = computeTimeBonus(timeLimit, timeRemaining);
    const score = distanceScore + timeBonus;
    const roundResult: RoundResult = {
      photo,
      distanceMeters,
      distanceScore,
      timeBonus,
      score,
      skipped: false,
    };

    setResult(roundResult);
    setRevealed(true);
    onReveal();

    if (distanceScore / MAX_SCORE >= 0.7) {
      fireConfetti();
    }
  }, [guess, photo, timeLimit, timeRemaining, onReveal]);

  const handleSkip = useCallback(() => {
    const roundResult: RoundResult = {
      photo,
      distanceMeters: Infinity,
      distanceScore: 0,
      timeBonus: 0,
      score: 0,
      skipped: true,
    };
    setResult(roundResult);
    setRevealed(true);
    onReveal();
  }, [photo, onReveal]);

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
      if ((event.key === "Enter" || event.key === " ") && !revealed && guess) {
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

  // Timer: countdown per round, auto-confirm/skip on expiry.
  useEffect(() => {
    timerCallbackRef.current = () => {
      if (guess) {
        handleConfirm();
      } else {
        handleSkip();
      }
    };
  }, [guess, handleConfirm, handleSkip]);

  useEffect(() => {
    if (!timeLimit || revealed) return;
    let remaining = timeLimit;

    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        setTimeRemaining(0);
        timerCallbackRef.current();
        return;
      }
      setTimeRemaining(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLimit, revealed]);

  const geocodeLabel = revealed ? getGeocodeLabel(photo.geocode) : null;
  const tierColour =
    result && !result.skipped
      ? scoreTierColour(result.distanceScore)
      : undefined;
  const isBadGuess =
    result && !result.skipped && result.distanceScore / MAX_SCORE < 0.1;

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
        <button
          className={styles.abortButton}
          onClick={onAbort}
          title="Quit to menu"
        >
          &times;
        </button>
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
          {timeLimit && !revealed ? (
            <div
              className={styles.timerBar}
              style={{
                width: `${((timeRemaining ?? timeLimit) / timeLimit) * 100}%`,
                transitionDuration: "1s",
              }}
              data-urgent={
                timeRemaining !== null && timeRemaining <= timeLimit * 0.25
                  ? ""
                  : undefined
              }
              data-warning={
                timeRemaining !== null &&
                timeRemaining <= timeLimit * 0.5 &&
                timeRemaining > timeLimit * 0.25
                  ? ""
                  : undefined
              }
            />
          ) : null}
          {!isZoomed ? (
            <div className={styles.zoomHint}>Scroll to zoom</div>
          ) : null}
        </div>

        {/* Map panel */}
        <div className={styles.mapPanel}>
          {mapSlot}

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
                      <span
                        className={[
                          styles.distance,
                          isBadGuess ? styles.distanceBad : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {formatDistance(result?.distanceMeters ?? 0)}
                      </span>
                      <span
                        className={[
                          styles.scoreValue,
                          tierColour ? styles.scoreValueGlow : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={tierColour ? { color: tierColour } : undefined}
                      >
                        +<span ref={scoreCounterRef}>0</span>
                      </span>
                      {result && result.timeBonus > 0 ? (
                        <span className={styles.timeBonusInline}>
                          +{result.timeBonus.toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.scoreBarTrack}>
                      <div
                        className={styles.scoreBarFill}
                        style={{
                          width: `${scoreRatio(result?.distanceScore ?? 0) * 100}%`,
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
