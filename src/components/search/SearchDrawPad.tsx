import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon, LoadingIndicator } from "../ui";
import { warmSearchImageModel } from "./imageEmbeddings";
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
  inline?: boolean;
  onCancel: () => void;
  onSubmit: (blob: Blob) => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  initialDrawing?: Blob;
  onDraft?: (blob: Blob | null) => void;
};

export const SearchDrawPad: React.FC<Props> = ({
  onCancel,
  onSubmit,
  inline = false,
  title = "Draw to search",
  description,
  submitLabel = "Search",
  cancelLabel = "Cancel",
  initialDrawing,
  onDraft,
}) => {
  const initialBlobRef = useRef(initialDrawing);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // invariant: BRUSH_COLOURS and BRUSH_SIZES are non-empty module constants
  const [brushColour, setBrushColour] = useState(BRUSH_COLOURS[0]!);
  const [brushWidth, setBrushWidth] = useState(BRUSH_SIZES[1]!.width);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [restoring, setRestoring] = useState(!!initialDrawing);
  const warmedRef = useRef(false);
  const [warming, setWarming] = useState(false);
  const undoRef = useRef<Array<{ pixels: ImageData; hasStrokes: boolean }>>([]);
  const redoRef = useRef<Array<{ pixels: ImageData; hasStrokes: boolean }>>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [eraser, setEraser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillBackground = useCallback(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) {
      return;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }, []);

  useEffect(() => {
    const saved = initialBlobRef.current;
    fillBackground();
    setHasStrokes(false);
    setError(null);
    if (!saved) {
      setRestoring(false);
      return;
    }
    setRestoring(true);
    let cancelled = false;
    const url = URL.createObjectURL(saved);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const context = canvasRef.current?.getContext("2d");
      if (context) {
        context.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        setHasStrokes(true);
      } else setError("The saved sketch could not be reopened.");
      setRestoring(false);
    };
    image.onerror = () => {
      if (!cancelled) {
        setError("The saved sketch could not be reopened. You can start a new sketch.");
        setRestoring(false);
      }
    };
    image.src = url;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [fillBackground]);

  useEffect(() => {
    if (inline) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog?.showModal) {
      dialog.showModal();
    } else {
      // jsdom and older embedded browsers do not expose showModal().
      dialog?.setAttribute("open", "");
    }
    cancelRef.current?.focus();

    return () => {
      if (dialog?.open && dialog.close) {
        dialog.close();
      }
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [inline]);

  const snapshot = () => {
    const context = canvasRef.current?.getContext("2d");
    return context
      ? { pixels: context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE), hasStrokes }
      : null;
  };
  const saveUndo = () => {
    const current = snapshot();
    if (!current) return;
    undoRef.current = [...undoRef.current.slice(-19), current];
    redoRef.current = [];
    setHistoryVersion((version) => version + 1);
  };
  const restoreHistory = (source: typeof undoRef, destination: typeof redoRef) => {
    const previous = source.current.pop();
    const current = snapshot();
    const context = canvasRef.current?.getContext("2d");
    if (!previous || !current || !context) return;
    destination.current.push(current);
    context.putImageData(previous.pixels, 0, 0);
    setHasStrokes(previous.hasStrokes);
    setError(null);
    setHistoryVersion((version) => version + 1);
    saveInlineDraft();
  };

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (restoring) return;
    if (event.button !== 0 || isDrawingRef.current) return;
    saveUndo();
    if (!warmedRef.current) {
      warmedRef.current = true;
      setWarming(true);
      void warmSearchImageModel()
        .catch(() => {
          warmedRef.current = false;
        })
        .finally(() => setWarming(false));
    }
    event.currentTarget.focus();
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
    if (!context) {
      return;
    }
    const from = lastPointRef.current!;
    const to = canvasPoint(event);
    context.strokeStyle = eraser ? "#ffffff" : brushColour;
    context.lineWidth = brushWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    // A tap with no movement still leaves a dot thanks to the round cap.
    context.lineTo(to.x + 0.01, to.y + 0.01);
    context.stroke();
    setError(null);
    lastPointRef.current = to;
    setHasStrokes(true);
  };

  const handlePointerUp = () => {
    const changed = isDrawingRef.current;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (changed) saveInlineDraft();
  };

  const handleClear = () => {
    saveUndo();
    fillBackground();
    setHasStrokes(false);
    setError(null);
    if (inline) onDraft?.(null);
  };

  const hasInk = () => {
    const pixels = canvasRef.current
      ?.getContext("2d")
      ?.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
    if (!pixels) return false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! < 250 || pixels[i + 1]! < 250 || pixels[i + 2]! < 250) return true;
    }
    return false;
  };

  const saveInlineDraft = () => {
    if (!inline || !onDraft) return;
    if (!hasInk()) {
      onDraft(null);
      return;
    }
    canvasRef.current?.toBlob((blob) => {
      if (blob) onDraft(blob);
    }, "image/png");
  };

  const handleCancel = () => {
    if (!onDraft || restoring) {
      onCancel();
      return;
    }
    if (!hasStrokes || !hasInk()) {
      onDraft(null);
      onCancel();
      return;
    }
    canvasRef.current!.toBlob((blob) => {
      if (blob) onDraft(blob);
      onCancel();
    }, "image/png");
  };

  const handleSubmit = () => {
    if (!hasInk()) {
      setHasStrokes(false);
      setError("The canvas is blank. Add a few strokes first.");
      return;
    }
    canvasRef.current!.toBlob((blob) => {
      if (blob) {
        onSubmit(blob);
      }
    }, "image/png");
  };

  // History refs hold bounded pixel snapshots; the version makes availability reactive.
  void historyVersion;
  const panel = (
    // Shortcuts bubble from the canvas and toolbar controls within this group.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label="Drawing tools"
      className={[styles.panel, inline ? styles.inlinePanel : ""].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase()))
          return;
        event.preventDefault();
        if (event.shiftKey || event.key.toLowerCase() === "y") restoreHistory(redoRef, undoRef);
        else restoreHistory(undoRef, redoRef);
      }}
    >
      <div className={styles.title}>{title}</div>
      {description ? <p className={styles.description}>{description}</p> : null}
      {/* A focusable canvas scopes undo/redo to the active sketch. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <canvas
        tabIndex={0}
        ref={canvasRef}
        className={styles.canvas}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        onPointerDown={handlePointerDown}
        onPointerMove={drawTo}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        aria-label="Drawing canvas"
      />
      <div className={styles.tools}>
        {warming ? (
          <div role="status" aria-busy="true">
            <LoadingIndicator label="Preparing image matching…" />
          </div>
        ) : null}
        {restoring ? (
          <p className={styles.status} role="status">
            Restoring sketch…
          </p>
        ) : null}
        {error ? (
          <p className={styles.status} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.toolRow} role="group" aria-label="Drawing actions">
          <Button
            size="icon"
            className={styles.iconTool}
            aria-label="Brush"
            title="Brush"
            active={!eraser}
            aria-pressed={!eraser}
            onClick={() => setEraser(false)}
          >
            <Icon kind="pencil" />
          </Button>
          <Button
            size="icon"
            className={styles.iconTool}
            aria-label="Eraser"
            title="Eraser"
            active={eraser}
            aria-pressed={eraser}
            onClick={() => setEraser(true)}
          >
            <Icon kind="eraser" />
          </Button>
          <Button
            size="icon"
            className={styles.iconTool}
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!undoRef.current.length || restoring}
            onClick={() => restoreHistory(undoRef, redoRef)}
          >
            <Icon kind="undo" />
          </Button>
          <Button
            size="icon"
            className={styles.iconTool}
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!redoRef.current.length || restoring}
            onClick={() => restoreHistory(redoRef, undoRef)}
          >
            <Icon kind="redo" />
          </Button>
          <Button
            size="icon"
            className={styles.iconTool}
            aria-label="Clear"
            title="Clear canvas"
            onClick={handleClear}
            disabled={restoring}
          >
            <Icon kind="clear" />
          </Button>
        </div>
        <div className={styles.toolRow} role="group" aria-label="Brush colour">
          {BRUSH_COLOURS.map((colour) => (
            <button
              key={colour}
              type="button"
              className={[styles.swatch, colour === brushColour ? styles.swatchActive : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ backgroundColor: colour }}
              data-colour-swatch
              aria-label={`Brush colour ${colour}`}
              title={`Brush colour ${colour}`}
              aria-pressed={colour === brushColour}
              onClick={() => {
                setBrushColour(colour);
                setEraser(false);
              }}
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
              aria-label={size.label}
              title={`${size.label} brush · ${size.width}px`}
              onClick={() => setBrushWidth(size.width)}
            >
              <span
                className={styles.brushPreview}
                style={{ width: Math.round(size.width / 2), height: Math.round(size.width / 2) }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
        <div className={styles.actionRow}>
          {!inline ? (
            <Button ref={cancelRef} onClick={handleCancel}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button variant="accent" onClick={handleSubmit} disabled={!hasStrokes || restoring}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
  if (inline) return <section aria-label={title}>{panel}</section>;
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        handleCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleCancel();
      }}
    >
      {panel}
    </dialog>
  );
};
