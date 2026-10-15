import { useEffect, useRef, useState } from "react";
import { AppLink } from "../platform";
import { Button, Caption, Heading, SegmentedToggle } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameStatsLine } from "./GameRecord";
import { useGameReadiness } from "./GameReadiness";
import { useGameSettings } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { ResultNextSteps } from "./ResultNextSteps";
import {
  dealJigsaw,
  jigsawSolved,
  moveJigsaw,
  rotateJigsaw,
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
  const recorded = useRef(false);
  const src = board ? getResizedAlbumImageSrc(board.photo.path) : null;
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
  const update = (state: JigsawState) => {
    if (!board || state === board.state) return;
    setBoard({ ...board, state });
    if (jigsawSolved(state) && !recorded.current) {
      recorded.current = true;
      record({ won: true });
    }
  };
  const choose = (index: number) => {
    if (!board || complete || preview) return;
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
        <SegmentedToggle
          ariaLabel="Puzzle variant"
          value={settings.mode}
          options={[
            { value: "swap", label: "Swap" },
            { value: "rotate", label: "Quarter turns" },
            { value: "slide", label: "Sliding tiles" },
          ]}
          onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
        />
        <Caption>
          {settings.mode === "swap"
            ? "Choose two pieces to exchange them."
            : settings.mode === "rotate"
              ? "Pieces need the right position and orientation."
              : "Move neighbouring pieces into the empty space."}
        </Caption>
        <Button variant="primary" disabled={loading || !photos.length} onClick={start}>
          Start puzzle
        </Button>
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  const loaded = image?.src === src && !image.failed;
  return (
    <div className={styles.game}>
      <div className={styles.actions}>
        <Button onClick={() => setBoard(null)}>Menu</Button>
        <Caption>
          {board.state.moves} {board.state.moves === 1 ? "move" : "moves"}
        </Caption>
        <Button active={preview} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
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
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${board.size}, minmax(0,1fr))`,
          aspectRatio: image?.src === src ? image.ratio : 1.5,
        }}
        aria-label="Photograph puzzle"
      >
        {preview || complete ? (
          <img
            src={src!}
            alt={board.photo.caption || "Completed photograph"}
            className={styles.preview}
          />
        ) : (
          board.state.tiles.map((tile, index) => (
            <button
              key={index}
              type="button"
              className={styles.tile}
              aria-label={
                tile === -1
                  ? "Empty space"
                  : `Piece at row ${Math.floor(index / board.size) + 1}, column ${(index % board.size) + 1}`
              }
              aria-pressed={selected === index}
              disabled={!loaded || tile === -1}
              onClick={() => choose(index)}
            >
              {tile !== -1 ? (
                <span
                  className={styles.crop}
                  style={{
                    backgroundImage: `url("${src}")`,
                    backgroundSize: `${board.size * 100}% ${board.size * 100}%`,
                    backgroundPosition: `${((tile % board.size) * 100) / (board.size - 1)}% ${(Math.floor(tile / board.size) * 100) / (board.size - 1)}%`,
                    transform: `rotate(${board.state.turns[index]! * 90}deg)`,
                  }}
                />
              ) : null}
            </button>
          ))
        )}
      </div>
      {complete ? (
        <>
          <Heading level={2}>
            Completed in {board.state.moves} {board.state.moves === 1 ? "move" : "moves"}
          </Heading>
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
            : rotating
              ? "Choose a piece to rotate it clockwise."
              : board.mode === "slide"
                ? "Choose a piece beside the empty space."
                : selected === null
                  ? "Choose a piece."
                  : "Choose a second piece to swap."}
        </p>
      )}
      {image?.failed ? <Button onClick={start}>Another photograph</Button> : null}
    </div>
  );
};
