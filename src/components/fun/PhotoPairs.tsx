import { useEffect, useRef, useState } from "react";
import { Button, Caption, SegmentedToggle } from "../ui";
import { GameIntro } from "./GameIllustration";
import { AppLink } from "../platform";
import { GameStatsLine } from "./GameRecord";
import { useGameReadiness } from "./GameReadiness";
import { useGameSettings } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { ResultNextSteps } from "./ResultNextSteps";
import {
  buildPhotoPairs,
  flipPairCard,
  initialPairsState,
  shuffleUnmatched,
  type PairCard,
  type PairsState,
} from "../../util/photoPairs";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import styles from "./PhotoPairs.module.css";

const BOARD_SIZES = [
  { pairs: 4, columns: 4, label: "4×2" },
  { pairs: 6, columns: 4, label: "4×3" },
  { pairs: 8, columns: 4, label: "4×4" },
  { pairs: 12, columns: 5, label: "5×5" },
  { pairs: 18, columns: 6, label: "6×6" },
  { pairs: 24, columns: 7, label: "7×7" },
] as const;

type Board = {
  cards: PairCard[];
  state: PairsState;
  glimpse: boolean;
  moving: boolean;
  loaded: string[];
};
export const PhotoPairs = ({
  photos,
  onActiveChange,
}: {
  photos: PhotoGamePhoto[];
  onActiveChange?: (active: boolean) => void;
}) => {
  const { loading } = useGameReadiness();
  const [settings, setSettings] = useGameSettings("pairs");
  const { stats, record } = useGameStats("photo-pairs");
  const [board, setBoard] = useState<Board | null>(null);
  const [message, setMessage] = useState("");
  const recorded = useRef(false);
  const active = board !== null;
  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  const start = () => {
    const cards = buildPhotoPairs(photos, settings.pairs, settings.mode);
    if (!cards) {
      setMessage(
        "There are not enough distinct pairs for these settings. Try fewer pairs or another mode.",
      );
      return;
    }
    recorded.current = false;
    setMessage("");
    setBoard({
      cards,
      state: initialPairsState(),
      glimpse: settings.twist === "glimpse",
      moving: settings.twist === "moving",
      loaded: [],
    });
  };
  const glimpseReady =
    !!board?.glimpse && board.cards.every((card) => board.loaded.includes(card.photo.path));
  useEffect(() => {
    if (!glimpseReady) return;
    const timer = window.setTimeout(
      () => setBoard((b) => (b ? { ...b, glimpse: false } : b)),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [glimpseReady]);
  const miss = board?.state.open.length === 2;
  const missReady =
    !!board &&
    miss &&
    board.state.open.every((index) => board.loaded.includes(board.cards[index]!.photo.path));
  useEffect(() => {
    if (!missReady) return;
    const timer = window.setTimeout(
      () =>
        setBoard((b) =>
          b
            ? {
                ...b,
                cards: b.moving ? shuffleUnmatched(b.cards, b.state.matched) : b.cards,
                state: { ...b.state, open: [] },
              }
            : b,
        ),
      1400,
    );
    return () => window.clearTimeout(timer);
  }, [missReady]);
  const complete = !!board && board.state.matched.length === board.cards.length;
  const flip = (index: number) => {
    if (!board || board.glimpse || complete) return;
    const state = flipPairCard(board.state, index, board.cards);
    if (state === board.state) return;
    setBoard({ ...board, state });
    if (state.matched.length === board.cards.length && !recorded.current) {
      recorded.current = true;
      record({ won: true, score: Math.round((100 * (board.cards.length / 2)) / state.turns) });
    }
  };
  if (!board)
    return (
      <GameIntro game="photo-pairs">
        <p>Turn over two cards. Find the pairs of different photographs that belong together.</p>
        <SegmentedToggle
          ariaLabel="Pair connection"
          value={settings.mode}
          options={[
            { value: "visual", label: "Lookalikes" },
            { value: "semantic", label: "Same subject" },
          ]}
          onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
        />
        <Caption>
          {settings.mode === "visual"
            ? "Pairs are selected by visual resemblance."
            : "Each pair shares a different visible subject."}
        </Caption>
        <div className={styles.sizes} role="group" aria-label="Board size">
          {BOARD_SIZES.map(({ pairs, label }) => (
            <Button
              key={pairs}
              aria-pressed={settings.pairs === pairs}
              onClick={() => setSettings((s) => ({ ...s, pairs }))}
            >
              {label}
            </Button>
          ))}
        </div>
        {settings.pairs === 12 || settings.pairs === 24 ? (
          <Caption>Empty centre square; every photograph has a partner.</Caption>
        ) : null}
        <SegmentedToggle
          ariaLabel="Memory twist"
          value={settings.twist}
          options={[
            { value: "classic", label: "Classic" },
            { value: "glimpse", label: "One glimpse" },
            { value: "moving", label: "Moving cards" },
          ]}
          onChange={(twist) => setSettings((s) => ({ ...s, twist }))}
        />
        <Caption>
          {settings.twist === "glimpse"
            ? "Three seconds to see the board before the cards turn over."
            : settings.twist === "moving"
              ? "Unmatched cards change places after every miss."
              : "Matched pairs stay face up."}
        </Caption>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" disabled={loading} onClick={start}>
          Start matching
        </Button>
        <GameStatsLine stats={stats} formatBest={(v) => `${v}% efficiency`} />
      </GameIntro>
    );
  const columns = BOARD_SIZES.find((size) => size.pairs * 2 === board.cards.length)?.columns ?? 4;
  const cells = board.cards.map((card, index) => ({ card, index }));
  const centre = columns % 2 === 1 ? Math.floor((columns * columns) / 2) : -1;
  const layout = centre < 0 ? cells : [...cells.slice(0, centre), null, ...cells.slice(centre)];
  return (
    <div className={styles.game}>
      <div className={styles.actions}>
        <Button onClick={() => setBoard(null)}>Menu</Button>
        <Caption>
          {board.state.matched.length / 2} / {board.cards.length / 2} pairs · {board.state.turns}{" "}
          turns
        </Caption>
      </div>
      <p role="status" aria-live="polite">
        {complete
          ? `All pairs found in ${board.state.turns} turns.`
          : board.glimpse
            ? "Remember the photographs…"
            : miss
              ? board.moving
                ? "No match. Unmatched cards will move."
                : "No match."
              : "Choose two cards."}
      </p>
      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        aria-label="Matching cards"
      >
        {layout.map((cell) => {
          if (!cell) return <span key="centre" aria-label="Empty centre square" />;
          const { card, index } = cell;
          const matched = board.state.matched.includes(index),
            open = matched || board.glimpse || board.state.open.includes(index);
          if (complete)
            return (
              <AppLink
                key={card.photo.path}
                href={card.photo.href}
                className={styles.card}
                aria-label={`Open photograph ${index + 1}: ${card.photo.caption || "Archive photograph"}`}
              >
                <img
                  src={getResizedAlbumImageSrc(card.photo.path)}
                  alt=""
                  className={styles.face}
                />
              </AppLink>
            );
          return (
            <button
              key={card.photo.path}
              type="button"
              className={styles.card}
              aria-label={
                open
                  ? `Card ${index + 1}: ${card.photo.caption || "Archive photograph"}${matched ? ", matched" : ""}`
                  : `Card ${index + 1}, face down`
              }
              aria-pressed={open}
              aria-disabled={matched || board.glimpse || miss || complete}
              onClick={() => flip(index)}
            >
              {open ? (
                <>
                  <img
                    src={getResizedAlbumImageSrc(card.photo.path)}
                    alt={card.photo.caption || "Archive photograph"}
                    loading="eager"
                    className={styles.face}
                    onLoad={() =>
                      setBoard((previous) =>
                        previous && !previous.loaded.includes(card.photo.path)
                          ? { ...previous, loaded: [...previous.loaded, card.photo.path] }
                          : previous,
                      )
                    }
                    onError={() => {
                      setBoard(null);
                      setMessage("A photograph could not load. Try another board.");
                    }}
                  />
                  {matched ? (
                    <span className={styles.match}>
                      {card.subject?.toLowerCase() || "Matched"} ✓
                    </span>
                  ) : null}
                </>
              ) : (
                <span className={styles.back} aria-hidden="true">
                  {index + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {complete ? (
        <div className={styles.finish}>
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
          <ResultNextSteps photos={board.cards.map((card) => card.photo)} />
        </div>
      ) : null}
    </div>
  );
};
