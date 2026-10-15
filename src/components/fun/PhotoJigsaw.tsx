import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AppLink } from "../platform";
import { Button, Caption, Heading, SegmentedToggle } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameStatsLine } from "./GameRecord";
import { useGameReadiness } from "./GameReadiness";
import { useGameSettings } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { useJigsawDrag } from "./useJigsawDrag";
import { ResultNextSteps } from "./ResultNextSteps";
import {
  dealJigsaw,
  jigsawSolved,
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
  const start = () => {
    if (!photos.length) return;
    const photo = photos[Math.floor(Math.random() * photos.length)]!;
    recorded.current = false;
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
    if (target === "pool") {
      if (board.mode === "pool") update(returnJigsawPiece(board.state, piece));
    } else if (board.mode === "pool") update(placeJigsawPiece(board.state, piece, target));
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
    if (board.mode === "pool") {
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
        <SegmentedToggle
          ariaLabel="Puzzle size"
          value={String(settings.size)}
          options={[3, 4, 5].map((n) => ({ value: String(n), label: `${n} × ${n}` }))}
          onChange={(v) => setSettings((s) => ({ ...s, size: Number(v) as 3 | 4 | 5 }))}
        />
        <div className={styles.variants} role="group" aria-label="Puzzle variant">
          {(
            [
              { value: "pool", label: "Piece pool" },
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
        <Button variant="primary" disabled={loading || !photos.length} onClick={start}>
          Start puzzle
        </Button>
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  const poolMode = board.mode === "pool";
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
                {piece >= 0 ? (
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
            </div>
            <div className={styles.pool} style={{ "--piece-ratio": ratio } as CSSProperties}>
              {board.state.pool!.map((piece, index) => (
                <button
                  key={piece}
                  type="button"
                  className={[
                    styles.tile,
                    styles.poolPiece,
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
                  <span className={styles.crop} style={crop(piece)} />
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
          {preview
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
                    : "Choose a second piece to swap."}
        </p>
      )}
      {image?.src === src && image.failed ? (
        <Button onClick={start}>Another photograph</Button>
      ) : null}
      {gesture.drag ? (
        <div
          className={styles.dragPreview}
          aria-hidden="true"
          style={{
            width: gesture.drag.width,
            height: gesture.drag.height,
            transform: `translate(${gesture.drag.x}px,${gesture.drag.y}px)`,
          }}
        >
          <span
            className={styles.crop}
            style={crop(
              gesture.drag.piece,
              board.state.turns[board.state.tiles.indexOf(gesture.drag.piece)] ?? 0,
            )}
          />
        </div>
      ) : null}
    </div>
  );
};
