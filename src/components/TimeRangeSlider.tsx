import React from "react";
import {
  computeDateExtent,
  computeSparklineBins,
  positionToMs,
  msToPosition,
  formatDisplayDate,
  type DateExtent,
} from "../util/timeRange";
import type { MapWorldEntry } from "./MapWorld";
import styles from "./TimeRangeSlider.module.css";

const BIN_COUNT = 100;

const clampPosition = (position: number): number =>
  Math.max(0, Math.min(1, position));

type TimeRangeSliderProps = {
  /** All photos (album-filtered, not date-filtered) for sparkline. */
  photos: MapWorldEntry[];
  /** Live range in epoch ms, or null when no filter is active. */
  fromMs: number | null;
  toMs: number | null;
  /** Called on every pointer move during drag — use for live opacity. */
  onDrag: (fromMs: number, toMs: number) => void;
  /** Called on pointer up — use for committing the range (URL, filtering). */
  onCommit: (fromMs: number | null, toMs: number | null) => void;
  className?: string;
};

const Sparkline: React.FC<{
  bins: number[];
  fromPos: number;
  toPos: number;
  hasRange: boolean;
}> = ({ bins, fromPos, toPos, hasRange }) => {
  const max = Math.max(...bins, 1);
  // Minimum bar height so single-photo bins are still visible
  const minHeight = Math.max(max * 0.08, 1);
  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${bins.length} ${max}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bins.map((count, i) => {
        if (count === 0) return null;
        const h = Math.max(count, minHeight);
        const pos = (i + 0.5) / bins.length;
        const active = hasRange && pos >= fromPos && pos <= toPos;
        return (
          <rect
            key={i}
            x={i + 0.1}
            y={max - h}
            width={0.8}
            height={h}
            rx={0.15}
            className={active ? styles.sparklineBarActive : styles.sparklineBar}
          />
        );
      })}
    </svg>
  );
};

export const TimeRangeSlider: React.FC<TimeRangeSliderProps> = ({
  photos,
  fromMs,
  toMs,
  onDrag,
  onCommit,
  className,
}) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef<"from" | "to" | null>(null);

  const extent: DateExtent | null = React.useMemo(
    () => computeDateExtent(photos),
    [photos],
  );

  const bins = React.useMemo(
    () => (extent ? computeSparklineBins(photos, extent, BIN_COUNT) : []),
    [photos, extent],
  );

  if (!extent) return null;

  const hasRange = fromMs !== null && toMs !== null;
  const fromPos = hasRange ? clampPosition(msToPosition(fromMs, extent)) : 0;
  const toPos = hasRange ? clampPosition(msToPosition(toMs, extent)) : 1;

  const getPositionFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    thumb: "from" | "to",
  ) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = thumb;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const thumb = draggingRef.current;
    if (!thumb) return;

    const pos = getPositionFromPointer(e.clientX);
    const ms = positionToMs(pos, extent);

    if (thumb === "from") {
      const clampedTo = toMs ?? extent.maxMs;
      onDrag(Math.min(ms, clampedTo), clampedTo);
    } else {
      const clampedFrom = fromMs ?? extent.minMs;
      onDrag(clampedFrom, Math.max(ms, clampedFrom));
    }
  };

  const handlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = null;

    // If thumbs are at extremes, clear the filter
    if (fromMs !== null && toMs !== null) {
      const atMin = clampPosition(msToPosition(fromMs, extent)) < 0.005;
      const atMax = clampPosition(msToPosition(toMs, extent)) > 0.995;
      if (atMin && atMax) {
        onCommit(null, null);
        return;
      }
    }
    onCommit(fromMs, toMs);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.thumb}`)) return;

    const pos = getPositionFromPointer(e.clientX);
    const ms = positionToMs(pos, extent);

    if (!hasRange) {
      // First click: set a narrow range around the click point
      const rangeWidth = (extent.maxMs - extent.minMs) * 0.05;
      const from = Math.max(ms - rangeWidth / 2, extent.minMs);
      const to = Math.min(ms + rangeWidth / 2, extent.maxMs);
      onDrag(from, to);
      onCommit(from, to);
    } else {
      // Move the nearest thumb
      const distToFrom = Math.abs(pos - fromPos);
      const distToTo = Math.abs(pos - toPos);
      if (distToFrom < distToTo) {
        onDrag(ms, toMs!);
        onCommit(ms, toMs);
      } else {
        onDrag(fromMs!, ms);
        onCommit(fromMs, positionToMs(pos, extent));
      }
    }
  };

  const handleReset = () => {
    onCommit(null, null);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    thumb: "from" | "to",
  ) => {
    const step = (extent.maxMs - extent.minMs) / BIN_COUNT;
    let newMs: number | null = null;

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const current = thumb === "from" ? (fromMs ?? extent.minMs) : (toMs ?? extent.maxMs);
      newMs = Math.max(current - step, extent.minMs);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const current = thumb === "from" ? (fromMs ?? extent.minMs) : (toMs ?? extent.maxMs);
      newMs = Math.min(current + step, extent.maxMs);
    }

    if (newMs === null) return;

    if (thumb === "from") {
      const clampedTo = toMs ?? extent.maxMs;
      const clamped = Math.min(newMs, clampedTo);
      onDrag(clamped, clampedTo);
      onCommit(clamped, clampedTo);
    } else {
      const clampedFrom = fromMs ?? extent.minMs;
      const clamped = Math.max(newMs, clampedFrom);
      onDrag(clampedFrom, clamped);
      onCommit(clampedFrom, clamped);
    }
  };

  const thumbClass = (isHidden: boolean) =>
    [styles.thumb, isHidden ? styles.thumbHidden : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className={[styles.container, className].filter(Boolean).join(" ")}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <Sparkline
        bins={bins}
        fromPos={fromPos}
        toPos={toPos}
        hasRange={hasRange}
      />

      <div
        ref={trackRef}
        className={styles.trackArea}
        onClick={handleTrackClick}
      >
        <div className={styles.track}>
          {hasRange && (
            <div
              className={styles.trackFill}
              style={{
                left: `${fromPos * 100}%`,
                width: `${(toPos - fromPos) * 100}%`,
              }}
            />
          )}
        </div>

        {/* From thumb */}
        <div
          className={thumbClass(!hasRange)}
          style={{ left: `${fromPos * 100}%` }}
          role="slider"
          aria-label="Range start"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fromPos * 100)}
          aria-valuetext={hasRange ? formatDisplayDate(fromMs!) : "Start"}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, "from")}
          onKeyDown={(e) => handleKeyDown(e, "from")}
        />

        {/* To thumb */}
        <div
          className={thumbClass(!hasRange)}
          style={{ left: `${toPos * 100}%` }}
          role="slider"
          aria-label="Range end"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(toPos * 100)}
          aria-valuetext={hasRange ? formatDisplayDate(toMs!) : "End"}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, "to")}
          onKeyDown={(e) => handleKeyDown(e, "to")}
        />
      </div>

      <div
        className={[styles.labels, hasRange ? styles.labelsActive : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <span className={styles.label}>
          {hasRange ? formatDisplayDate(fromMs!) : formatDisplayDate(extent.minMs)}
        </span>
        {hasRange ? (
          <button
            className={styles.resetButton}
            onClick={handleReset}
            aria-label="Clear time filter"
          >
            ✕ Reset
          </button>
        ) : null}
        <span className={styles.label}>
          {hasRange ? formatDisplayDate(toMs!) : formatDisplayDate(extent.maxMs)}
        </span>
      </div>
    </div>
  );
};
