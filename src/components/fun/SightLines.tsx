import { useEffect, useRef, useState } from "react";
import { Button, Caption } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameDock } from "./GameDock";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { useGameSettings } from "./useGameSettings";
import {
  buildPhotoWordSearch,
  matchPhotoSearchLine,
  photoSearchLine,
  type PhotoWordSearch,
} from "../../util/photoWordSearch";
import type { PhotoGamePhoto } from "../../util/photoGames";
import styles from "./SightLines.module.css";

export const SightLines = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [settings, setSettings] = useGameSettings("sightLines");
  const [puzzle, setPuzzle] = useState<PhotoWordSearch | null>(null);
  const [found, setFound] = useState<Array<{ id: string; cells: number[] }>>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [hint, setHint] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const drag = useRef<{ start: number; end: number; pointer: number } | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const finished = Boolean(puzzle && (gaveUp || found.length === puzzle.targets.length));
  useEffect(() => {
    if (!finished) return;
    // Let the finishing touch's compatibility click settle before moving focus.
    const frame = requestAnimationFrame(() => resultRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [finished]);
  const start = () => {
    const next = buildPhotoWordSearch(photos, settings.size);
    if (!next) {
      setMessage(
        "This archive needs more photographs with distinct subjects. Try the smaller grid.",
      );
      return;
    }
    setPuzzle(next);
    setFound([]);
    setSelected([]);
    setAnchor(null);
    setHint(null);
    setGaveUp(false);
    setMessage("");
  };
  const check = (cells: number[]) => {
    if (!puzzle) return;
    const target = matchPhotoSearchLine(
      puzzle,
      cells,
      found.map((item) => item.id),
    );
    setSelected(cells);
    setAnchor(null);
    if (target) {
      const next = [...found, { id: target.id, cells }];
      setFound(next);
      setHint(null);
      setMessage(
        next.length === puzzle.targets.length
          ? "Every sight line found!"
          : `${target.label} found.`,
      );
      setSelected([]);
    } else
      setMessage(
        cells.length !== 3
          ? "Choose a straight line of three photographs."
          : "That line doesn’t match an unfound connection.",
      );
  };
  const tap = (index: number) => {
    if (anchor === null) {
      setAnchor(index);
      setSelected([index]);
      setMessage("Choose the other end of the line.");
    } else if (anchor === index) {
      setAnchor(null);
      setSelected([]);
      setMessage("");
    } else check(photoSearchLine(anchor, index, puzzle!.size));
  };
  if (!puzzle)
    return (
      <GameIntro game="sight-lines">
        <p>Find four lines of three related photographs: across, down or diagonally.</p>
        <div className={styles.actions} role="group" aria-label="Board size">
          {([5, 6] as const).map((size) => (
            <Button
              key={size}
              active={settings.size === size}
              aria-pressed={settings.size === size}
              onClick={() => setSettings({ size })}
            >
              {size}×{size}
            </Button>
          ))}
        </div>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start searching
        </Button>
      </GameIntro>
    );
  const shownLines = puzzle.targets.flatMap((target, index) => {
    const match = found.find((item) => item.id === target.id);
    return match || gaveUp
      ? [{ ...target, cells: match?.cells ?? target.cells, number: index + 1, revealed: !match }]
      : [];
  });
  const lineCoordinates = (cells: number[]) => ({
    x1: (((cells[0]! % puzzle.size) + 0.5) / puzzle.size) * 100,
    y1: ((Math.floor(cells[0]! / puzzle.size) + 0.5) / puzzle.size) * 100,
    x2: (((cells.at(-1)! % puzzle.size) + 0.5) / puzzle.size) * 100,
    y2: ((Math.floor(cells.at(-1)! / puzzle.size) + 0.5) / puzzle.size) * 100,
  });
  return (
    <div className={styles.game}>
      <GameDock
        label="Sight Lines board and targets"
        active={!finished}
        {...(styles.boardDock ? { className: styles.boardDock } : {})}
      >
        <div className={styles.actions}>
          <Caption>
            {found.length} / {puzzle.targets.length} sight lines
          </Caption>
          {!finished ? (
            <>
              <Button
                onClick={() => {
                  const target = puzzle.targets.find(
                    (item) => !found.some((match) => match.id === item.id),
                  )!;
                  setHint(target.cells[0]!);
                  setSelected([]);
                  setAnchor(null);
                  setMessage(
                    `A ${target.label.toLowerCase()} line starts at the marked photograph.`,
                  );
                }}
              >
                Hint
              </Button>
              <Button
                onClick={() => {
                  setGaveUp(true);
                  setSelected([]);
                  setAnchor(null);
                  setHint(null);
                  setMessage("The hidden sight lines are revealed below.");
                }}
              >
                Give up
              </Button>
            </>
          ) : (
            <Button onClick={start}>Play again</Button>
          )}
        </div>
        <section aria-label="Search targets" className={styles.targets}>
          <h2>Find these</h2>
          <Caption>Three photographs in a straight line for each subject.</Caption>
          <ul className={styles.clues}>
            {puzzle.targets.map((target, index) => {
              const complete = found.some((match) => match.id === target.id);
              return (
                <li
                  key={target.id}
                  data-found={complete}
                  aria-label={`${target.label}: ${complete ? "found" : "still to find"}`}
                >
                  <span className={styles.targetNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.targetLabel}>{target.label}</span>
                  {complete ? <span aria-hidden="true">✓</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
        <div role="status" className={styles.feedback}>
          {message || "Drag a line, or tap its first and last photographs."}
        </div>
        <div
          className={styles.board}
          role="group"
          aria-label="Photo search board"
          style={{ "--search-size": puzzle.size } as React.CSSProperties}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointer !== event.pointerId) return;
            const tile = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest<HTMLButtonElement>("button[data-cell]");
            if (!tile || !event.currentTarget.contains(tile)) return;
            drag.current.end = Number(tile.dataset.cell);
            setSelected(photoSearchLine(drag.current.start, drag.current.end, puzzle.size));
          }}
          onPointerUp={(event) => {
            const gesture = drag.current;
            if (!gesture || gesture.pointer !== event.pointerId) return;
            drag.current = null;
            if (gesture.start === gesture.end) tap(gesture.start);
            else check(photoSearchLine(gesture.start, gesture.end, puzzle.size));
          }}
          onPointerCancel={() => {
            drag.current = null;
            setSelected(anchor === null ? [] : [anchor]);
          }}
        >
          {puzzle.tiles.map((photo, index) => {
            const matches = shownLines.filter((item) => item.cells.includes(index));
            return (
              <button
                key={photo.path}
                type="button"
                data-cell={index}
                data-found={matches.length > 0}
                data-hint={hint === index}
                className={styles.tile}
                disabled={finished}
                aria-pressed={selected.includes(index)}
                aria-label={`Row ${Math.floor(index / puzzle.size) + 1}, column ${(index % puzzle.size) + 1}${matches.length ? `; ${matches.map((item) => `${item.label} ${item.revealed ? "revealed" : "found"}`).join(", ")}` : ""}${hint === index ? "; hint starts here" : ""}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  drag.current = { start: index, end: index, pointer: event.pointerId };
                  event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
                }}
                onClick={(event) => {
                  if (event.detail === 0) tap(index);
                }}
              >
                <GamePhoto photo={photo} />
                {matches.length ? (
                  <span className={styles.mark} aria-hidden="true">
                    {matches.map((item) => item.number).join("·")}
                  </span>
                ) : hint === index ? (
                  <span className={styles.mark} aria-hidden="true">
                    ?
                  </span>
                ) : null}
              </button>
            );
          })}
          <svg
            className={styles.lines}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {shownLines.map((line) => (
              <g key={line.id} data-revealed={line.revealed}>
                <line {...lineCoordinates(line.cells)} className={styles.lineHalo} />
                <line {...lineCoordinates(line.cells)} className={styles.foundLine} />
              </g>
            ))}
            {selected.length > 1 ? (
              <line {...lineCoordinates(selected)} className={styles.selectedLine} />
            ) : null}
          </svg>
        </div>
      </GameDock>
      {selected.length ? (
        <section aria-label="Selected photographs">
          <PhotoChain
            photos={selected.map((index) => puzzle.tiles[index]!)}
            linked={false}
            numbered={false}
          />
        </section>
      ) : null}
      {finished ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-label="Sight Lines result"
          className={styles.result}
        >
          <p>
            {gaveUp
              ? `${found.length} of ${puzzle.targets.length} sight lines found.`
              : "All four connections found."}
          </p>
          {puzzle.targets.map((target, index) => (
            <div key={target.id}>
              <h2>
                {index + 1}. {target.label}
              </h2>
              <PhotoChain
                photos={(found.find((item) => item.id === target.id)?.cells ?? target.cells).map(
                  (index) => puzzle.tiles[index]!,
                )}
                numbered={false}
              />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
};
