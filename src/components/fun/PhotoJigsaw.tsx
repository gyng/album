import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AppLink } from "../platform";
import { Button, Caption, Heading, Input } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameStatsLine } from "./GameRecord";
import { useGameReadiness } from "./GameReadiness";
import { useGameSettings } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { JigsawPiece } from "./JigsawPiece";
import { useJigsawDrag } from "./useJigsawDrag";
import { ResultNextSteps } from "./ResultNextSteps";
import {
  dealJigsaw,
  jigsawSolved,
  isJigsawSize,
  JIGSAW_MIN_SIZE,
  JIGSAW_MAX_SIZE,
  jigsawPieceEdges,
  moveJigsaw,
  rotateJigsaw,
  placeJigsawPiece,
  returnJigsawPiece,
  type JigsawState,
  type JigsawMode,
} from "../../util/photoJigsaw";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import styles from "./PhotoJigsaw.module.css";

type Board = { photo: PhotoGamePhoto; size: number; mode: JigsawMode; state: JigsawState };
export const PhotoJigsaw = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [edgesOnly, setEdgesOnly] = useState(false);
  const [customSize, setCustomSize] = useState<string | null>(null);
  const customId = useId();
  const [feedback, setFeedback] = useState("");
  const { loading } = useGameReadiness();
  const [settings, setSettings] = useGameSettings("jigsaw");
  const { stats, record } = useGameStats("photo-jigsaw");
  const [board, setBoard] = useState<Board | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [preview, setPreview] = useState(false),
    [rotating, setRotating] = useState(false);
  const [image, setImage] = useState<{ src: string; ratio: number; failed: boolean } | null>(null);
  const recorded = useRef(false),
    root = useRef<HTMLDivElement>(null),
    result = useRef<HTMLHeadingElement>(null);
  const src = board ? getResizedAlbumImageSrc(board.photo.path) : null;
  const loaded = image?.src === src && !image?.failed;
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled)
        setImage({ src, ratio: img.naturalWidth / img.naturalHeight || 1.5, failed: false });
    };
    img.onerror = () => {
      if (!cancelled) setImage({ src, ratio: 1.5, failed: true });
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  const validSize =
    customSize === null || (customSize.trim() !== "" && isJigsawSize(Number(customSize)));
  const start = () => {
    if (!validSize || !photos.length) return;
    const other = photos.filter((photo) => photo.path !== board?.photo.path);
    const available = other.length ? other : photos;
    const photo = available[Math.floor(Math.random() * available.length)]!;
    recorded.current = false;
    setEdgesOnly(false);
    setFeedback("");
    setSelected(null);
    setPreview(false);
    setRotating(false);
    setBoard({
      photo,
      size: settings.size,
      mode: settings.mode,
      state: dealJigsaw(settings.size, settings.mode),
    });
  };
  const complete = !!board && jigsawSolved(board.state);
  useEffect(() => {
    if (complete) result.current?.focus({ preventScroll: true });
  }, [complete]);
  const update = (state: JigsawState) => {
    if (!board || state === board.state) return;
    setBoard({ ...board, state });
    if (jigsawSolved(state) && !recorded.current) {
      recorded.current = true;
      record({ won: true });
    }
  };
  const place = (piece: number, target: number | "pool") => {
    if (!board || !loaded || complete || preview) return;
    if (board.mode === "jigsaw" && target !== "pool" && target !== piece) {
      setFeedback("That piece does not fit here.");
      return;
    }
    setFeedback("");
    if (target === "pool") {
      if (board.mode === "pool" || board.mode === "jigsaw")
        update(returnJigsawPiece(board.state, piece));
    } else if (board.mode === "pool" || board.mode === "jigsaw")
      update(placeJigsawPiece(board.state, piece, target));
    else
      update(
        moveJigsaw(board.state, board.state.tiles.indexOf(piece), target, board.mode, board.size),
      );
    setSelected(null);
  };
  const gesture = useJigsawDrag(root, !!board && !!loaded && !preview && !complete, place);
  const onPieceKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setSelected(null);
      gesture.cancel();
    }
  };
  const choose = (index: number) => {
    if (!board || !loaded || complete || preview || gesture.ignoreClick()) return;
    const piece = board.state.tiles[index]!;
    if (board.mode === "pool" || board.mode === "jigsaw") {
      if (selected === null) {
        if (piece >= 0) setSelected(piece);
      } else if (selected === piece) setSelected(null);
      else place(selected, index);
      return;
    }
    if (rotating) {
      update(rotateJigsaw(board.state, index));
      return;
    }
    if (board.mode === "slide") {
      update(moveJigsaw(board.state, index, board.state.tiles.indexOf(-1), board.mode, board.size));
      return;
    }
    if (selected === null) {
      setSelected(index);
      return;
    }
    update(moveJigsaw(board.state, selected, index, board.mode, board.size));
    setSelected(null);
  };
  if (!board)
    return (
      <GameIntro game="photo-jigsaw">
        <p>Reassemble a photograph from the archive.</p>
        <div className={styles.variants} role="group" aria-label="Puzzle size">
          {[3, 4, 5, 6, 8, 10].map((size) => (
            <Button
              key={size}
              active={settings.size === size}
              aria-pressed={settings.size === size}
              onClick={() => {
                setCustomSize(null);
                setSettings((s) => ({ ...s, size }));
              }}
            >
              {size} × {size}
            </Button>
          ))}
        </div>
        <label className={styles.customSize} htmlFor={`${customId}-input`}>
          Custom grid size
          <Input
            id={`${customId}-input`}
            type="number"
            inputMode="numeric"
            min={JIGSAW_MIN_SIZE}
            max={JIGSAW_MAX_SIZE}
            step={1}
            value={customSize ?? String(settings.size)}
            aria-invalid={!validSize}
            aria-describedby={customId}
            onChange={(event) => {
              const value = event.target.value;
              setCustomSize(value);
              if (value.trim() && isJigsawSize(Number(value)))
                setSettings((s) => ({ ...s, size: Number(value) }));
            }}
          />
        </label>
        <Caption id={customId}>
          {validSize
            ? `${settings.size * settings.size} pieces · ${JIGSAW_MIN_SIZE}–${JIGSAW_MAX_SIZE} per side`
            : `Enter a whole number from ${JIGSAW_MIN_SIZE} to ${JIGSAW_MAX_SIZE}.`}
        </Caption>
        <div className={styles.variants} role="group" aria-label="Puzzle variant">
          {(
            [
              { value: "jigsaw", label: "Jigsaw" },
              { value: "pool", label: "Rectangular pieces" },
              { value: "swap", label: "Swap" },
              { value: "rotate", label: "Quarter turns" },
              { value: "slide", label: "Sliding tiles" },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              active={settings.mode === option.value}
              aria-pressed={settings.mode === option.value}
              onClick={() => setSettings((s) => ({ ...s, mode: option.value }))}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {settings.mode === "rotate" ? (
          <Caption>Pieces need the right position and orientation.</Caption>
        ) : null}
        <Button
          variant="primary"
          disabled={loading || !photos.length || !validSize}
          onClick={start}
        >
          Start puzzle
        </Button>
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  const shaped = board.mode === "jigsaw";
  const poolMode = board.mode === "pool" || board.mode === "jigsaw";
  const crop = (piece: number, turn = 0): CSSProperties => ({
    backgroundImage: `url("${src}")`,
    backgroundSize: `${board.size * 100}% ${board.size * 100}%`,
    backgroundPosition: `${((piece % board.size) * 100) / (board.size - 1)}% ${(Math.floor(piece / board.size) * 100) / (board.size - 1)}%`,
    transform: `rotate(${turn * 90}deg)`,
  });
  const ratio = image?.src === src ? image.ratio : 1.5;
  return (
    <div
      className={styles.game}
      ref={root}
      role="group"
      aria-label="Jigsaw game"
      onPointerMove={gesture.move}
      onPointerUp={gesture.end}
      onPointerCancel={gesture.cancel}
    >
      <div className={styles.actions}>
        <Button
          onClick={() => {
            gesture.cancel();
            setBoard(null);
          }}
        >
          Menu
        </Button>
        <Button
          onClick={() => {
            gesture.cancel();
            start();
          }}
        >
          New photo
        </Button>
        <Caption>
          {board.state.moves} {board.state.moves === 1 ? "move" : "moves"}
        </Caption>
        <Button
          active={preview}
          aria-pressed={preview}
          onClick={() => {
            gesture.cancel();
            setSelected(null);
            setPreview((v) => !v);
          }}
        >
          Preview
        </Button>
        {board.mode === "rotate" ? (
          <Button
            active={rotating}
            aria-pressed={rotating}
            onClick={() => {
              setRotating((v) => !v);
              setSelected(null);
            }}
          >
            Rotate pieces
          </Button>
        ) : null}
      </div>
      {!loaded ? (
        <p role={image?.src === src && image.failed ? "alert" : "status"}>
          {image?.src === src && image.failed
            ? "This photograph could not load. Choose another."
            : "Loading photograph…"}
        </p>
      ) : null}
      <div
        className={[styles.scene, poolMode && !complete ? styles.withPool : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className={styles.board}
          style={{ gridTemplateColumns: `repeat(${board.size},minmax(0,1fr))`, aspectRatio: ratio }}
          aria-label="Photograph puzzle"
        >
          {preview || complete ? (
            <img
              src={src!}
              alt={board.photo.caption || "Completed photograph"}
              className={styles.preview}
            />
          ) : (
            board.state.tiles.map((piece, index) => (
              <button
                key={index}
                type="button"
                className={[
                  styles.tile,
                  shaped ? styles.shapedTile : "",
                  piece >= 0 ? styles.draggable : "",
                  gesture.drag?.piece === piece ? styles.dragging : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={`${piece < 0 ? "Empty cell" : "Piece"} at row ${Math.floor(index / board.size) + 1}, column ${(index % board.size) + 1}`}
                aria-pressed={
                  selected !== null && (poolMode ? selected === piece : selected === index)
                }
                disabled={!loaded || (!poolMode && piece < 0)}
                data-jigsaw-target={index}
                {...(piece < 0 ? { "data-empty": true } : {})}
                {...(gesture.over === index ? { "data-drop-target": true } : {})}
                onPointerDown={(event) => {
                  if (piece >= 0) gesture.begin(event, piece);
                }}
                onClick={() => choose(index)}
                onKeyDown={onPieceKeyDown}
              >
                {shaped ? (
                  <JigsawPiece
                    piece={piece >= 0 ? piece : index}
                    size={board.size}
                    src={src!}
                    empty={piece < 0}
                  />
                ) : piece >= 0 ? (
                  <span className={styles.crop} style={crop(piece, board.state.turns[index]!)} />
                ) : null}
              </button>
            ))
          )}
        </div>
        {poolMode && !complete ? (
          <section
            className={styles.poolPanel}
            aria-label="Piece pool"
            data-jigsaw-target="pool"
            {...(gesture.over === "pool" ? { "data-drop-target": true } : {})}
          >
            <div className={styles.actions}>
              <Heading level={2}>Pieces</Heading>
              <Caption>{board.state.pool!.length} remaining</Caption>
              {shaped ? (
                <Button
                  active={edgesOnly}
                  aria-pressed={edgesOnly}
                  onClick={() => setEdgesOnly(!edgesOnly)}
                >
                  Edges only
                </Button>
              ) : null}
            </div>
            <div className={styles.pool} style={{ "--piece-ratio": ratio } as CSSProperties}>
              {board.state
                .pool!.filter(
                  (piece) => !edgesOnly || jigsawPieceEdges(piece, board.size).includes(0),
                )
                .map((piece, index) => (
                  <button
                    key={piece}
                    type="button"
                    className={[
                      styles.tile,
                      styles.poolPiece,
                      shaped ? styles.shapedPoolPiece : "",
                      styles.draggable,
                      gesture.drag?.piece === piece ? styles.dragging : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`Pool piece ${index + 1}`}
                    onKeyDown={onPieceKeyDown}
                    aria-pressed={selected === piece}
                    disabled={!loaded || preview}
                    onPointerDown={(event) => gesture.begin(event, piece)}
                    onClick={() => {
                      if (!gesture.ignoreClick())
                        setSelected((value) => (value === piece ? null : piece));
                    }}
                  >
                    {shaped ? (
                      <JigsawPiece piece={piece} size={board.size} src={src!} />
                    ) : (
                      <span className={styles.crop} style={crop(piece)} />
                    )}
                  </button>
                ))}
            </div>
            {selected !== null && board.state.tiles.includes(selected) ? (
              <Button onClick={() => place(selected, "pool")}>Return piece to pool</Button>
            ) : null}
          </section>
        ) : null}
      </div>
      {complete ? (
        <>
          <h2 ref={result} tabIndex={-1}>
            Completed in {board.state.moves} {board.state.moves === 1 ? "move" : "moves"}
          </h2>
          <AppLink href={board.photo.href}>Open photograph</AppLink>
          <Button variant="primary" onClick={start}>
            Another puzzle
          </Button>
          <ResultNextSteps photos={[board.photo]} />
        </>
      ) : (
        <p role="status">
          {feedback ||
            (preview
              ? "Previewing the original photograph."
              : poolMode
                ? selected === null
                  ? "Choose a piece."
                  : "Choose a cell."
                : rotating
                  ? "Choose a piece to rotate it clockwise."
                  : board.mode === "slide"
                    ? "Choose a piece beside the empty space."
                    : selected === null
                      ? "Choose a piece."
                      : "Choose a second piece to swap.")}
        </p>
      )}
      {image?.src === src && image.failed ? (
        <Button onClick={start}>Another photograph</Button>
      ) : null}
      {gesture.drag ? (
        <div
          className={[styles.dragPreview, shaped ? styles.shapedDrag : ""]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
          style={{
            width: gesture.drag.width,
            height: gesture.drag.height,
            transform: `translate(${gesture.drag.x}px,${gesture.drag.y}px)`,
          }}
        >
          {shaped ? (
            <JigsawPiece piece={gesture.drag.piece} size={board.size} src={src!} />
          ) : (
            <span
              className={styles.crop}
              style={crop(
                gesture.drag.piece,
                board.state.turns[board.state.tiles.indexOf(gesture.drag.piece)] ?? 0,
              )}
            />
          )}
        </div>
      ) : null}
    </div>
  );
};
