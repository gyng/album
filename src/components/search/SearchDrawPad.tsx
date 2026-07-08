import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SearchDrawPad.module.css";

// Canvas backing resolution. SigLIP downsamples to 224×224, so 448 keeps
// strokes crisp at 2× without wasting encode time on a huge bitmap.
const CANVAS_SIZE = 448;

const BRUSH_COLOURS = [
  "#1a1a1a",
  "#d33d2e",
  "#e8a33d",
  "#2e8b57",
  "#2f6fc4",
  "#7d4fb0",
  "#8a5a3b",
  "#ffffff",
];

const BRUSH_SIZES = [
  { label: "Fine", width: 6 },
  { label: "Medium", width: 16 },
  { label: "Broad", width: 34 },
];

type Props = {
  onCancel: () => void;
  onSubmit: (blob: Blob) => void;
};

export const SearchDrawPad: React.FC<Props> = ({ onCancel, onSubmit }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [brushColour, setBrushColour] = useState(BRUSH_COLOURS[0]);
  const [brushWidth, setBrushWidth] = useState(BRUSH_SIZES[1].width);
  const [hasStrokes, setHasStrokes] = useState(false);

  const fillBackground = useCallback(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) {
      return;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }, []);

  useEffect(() => {
    fillBackground();
  }, [fillBackground]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = canvasPoint(event);
    drawTo(event);
  };

  const drawTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) {
      return;
    }
    const context = event.currentTarget.getContext("2d");
    const from = lastPointRef.current;
    if (!context || !from) {
      return;
    }
    const to = canvasPoint(event);
    context.strokeStyle = brushColour;
    context.lineWidth = brushWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    // A tap with no movement still leaves a dot thanks to the round cap.
    context.lineTo(to.x + 0.01, to.y + 0.01);
    context.stroke();
    lastPointRef.current = to;
    setHasStrokes(true);
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleClear = () => {
    fillBackground();
    setHasStrokes(false);
  };

  const handleSubmit = () => {
    canvasRef.current?.toBlob((blob) => {
      if (blob) {
        onSubmit(blob);
      }
    }, "image/png");
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Draw to search"
      >
        <div className={styles.title}>Draw to search</div>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={drawTo}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div className={styles.toolRow} role="group" aria-label="Brush colour">
          {BRUSH_COLOURS.map((colour) => (
            <button
              key={colour}
              type="button"
              className={[
                styles.swatch,
                colour === brushColour ? styles.swatchActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ backgroundColor: colour }}
              aria-label={`Brush colour ${colour}`}
              aria-pressed={colour === brushColour}
              onClick={() => setBrushColour(colour)}
            />
          ))}
        </div>
        <div className={styles.toolRow} role="group" aria-label="Brush size">
          {BRUSH_SIZES.map((size) => (
            <button
              key={size.label}
              type="button"
              className={[
                styles.sizeButton,
                size.width === brushWidth ? styles.sizeButtonActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={size.width === brushWidth}
              onClick={() => setBrushWidth(size.width)}
            >
              {size.label}
            </button>
          ))}
        </div>
        <div className={styles.actionRow}>
          <button type="button" className={styles.action} onClick={handleClear}>
            Clear
          </button>
          <button type="button" className={styles.action} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.actionPrimary}
            onClick={handleSubmit}
            disabled={!hasStrokes}
          >
            Search
          </button>
        </div>
      </div>
    </div>
  );
};
