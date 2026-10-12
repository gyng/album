import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  buildPhotoCrossword,
  checkPhotoCrossword,
  crosswordClue,
  type PhotoCrosswordPuzzle,
} from "../../util/photoCrossword";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { Button, Caption, Heading } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto } from "./GamePhoto";
import styles from "./PhotoCrossword.module.css";

export const PhotoCrossword = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [mode, setMode] = useState<"visible" | "hidden">("hidden");
  const [cluesRevealed, setCluesRevealed] = useState(false);
  const [size, setSize] = useState<3 | 4>(3);
  const [puzzle, setPuzzle] = useState<PhotoCrosswordPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [cells, setCells] = useState<Array<PhotoGamePhoto | null>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[] | null>(null);
  const [finished, setFinished] = useState<"solved" | "revealed" | null>(null);
  const [message, setMessage] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  const start = () => {
    const next = buildPhotoCrossword(photos, size);
    if (!next) {
      setMessage(
        "This archive cannot make a complete grid with distinct crossing clues. Try a smaller grid or another puzzle.",
      );
      return;
    }
    setPuzzle(next);
    setTiles(next.tiles);
    setCluesRevealed(false);
    setCells(
      Array.from({ length: size ** 2 }, (_, i) =>
        mode === "hidden" &&
        (i % size === Math.floor(i / size) || i % size === (Math.floor(i / size) + 1) % size)
          ? next.solution[i]!
          : null,
      ),
    );
    setSelected(null);
    setChecked(null);
    setFinished(null);
    setMessage("");
  };
  if (!puzzle)
    return (
      <GameIntro game="cross-exposure">
        <p>
          {mode === "hidden"
            ? "Infer the row and column connections from the starting photographs, then place the remaining shots. Each line starts with two fixed photographs."
            : "Each photograph must fit both its row and its column. Every shot is used once; more than one arrangement can work."}
        </p>
        <div className={styles.actions} role="group" aria-label="Clue mode">
          <Button
            active={mode === "hidden"}
            aria-pressed={mode === "hidden"}
            onClick={() => setMode("hidden")}
          >
            Hidden connections
          </Button>
          <Button
            active={mode === "visible"}
            aria-pressed={mode === "visible"}
            onClick={() => setMode("visible")}
          >
            Visible clues
          </Button>
        </div>
        <div className={styles.actions} role="group" aria-label="Grid size">
          {([3, 4] as const).map((value) => (
            <Button
              key={value}
              active={size === value}
              aria-pressed={size === value}
              onClick={() => {
                setSize(value);
                setMessage("");
              }}
            >
              {value}×{value}
            </Button>
          ))}
        </div>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start crossing
        </Button>
      </GameIntro>
    );
  const isFixed = (index: number) =>
    mode === "hidden" &&
    (index % size === Math.floor(index / size) ||
      index % size === (Math.floor(index / size) + 1) % size);
  const showClues = mode === "visible" || cluesRevealed || !!finished;
  const place = (index: number) => {
    if (finished || isFixed(index)) return;
    if (!selected) {
      if (cells[index]) {
        setSelected(cells[index]!.path);
        setMessage("Photograph selected. Choose another square to move or swap it, or remove it.");
      }
      return;
    }
    const photo = tiles.find((item) => item.path === selected)!;
    const next = [...cells];
    const previous = next.findIndex((item) => item?.path === selected);
    if (previous >= 0) next[previous] = next[index]!;
    next[index] = photo;
    setCells(next);
    setSelected(null);
    setChecked(null);
    setMessage("");
  };
  const used = new Set(cells.filter(Boolean).map((photo) => photo!.path));
  const label = (index: number) =>
    `Row ${Math.floor(index / size) + 1}${showClues ? `: ${crosswordClue(puzzle.rows[Math.floor(index / size)]!)}` : ""}; column ${(index % size) + 1}${showClues ? `: ${crosswordClue(puzzle.columns[index % size]!)}` : ""}${isFixed(index) ? "; fixed starting photograph" : cells[index] ? "; occupied" : "; empty"}`;
  return (
    <div className={styles.game}>
      <Caption>
        {cells.filter(Boolean).length} of {size ** 2} squares filled
      </Caption>
      {finished ? (
        <div ref={resultRef} tabIndex={-1} role="region" aria-label="Cross Exposure result">
          <Heading level={1}>
            {finished === "solved" ? "Every clue crossed" : "One arrangement that works"}
          </Heading>
          <Caption>
            {finished === "solved"
              ? "Every photograph fits both clues."
              : "Other arrangements can be valid too."}
          </Caption>
        </div>
      ) : null}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus lets keyboard users scroll the wide board on narrow screens. */}
      <div className={styles.boardScroll} role="region" aria-label="Crossword board" tabIndex={0}>
        <table className={styles.board} style={{ "--crossword-size": size } as CSSProperties}>
          <thead>
            <tr>
              <td aria-hidden="true" />
              {puzzle.columns.map((question, index) => (
                <th key={question.id} scope="col">
                  {showClues ? crosswordClue(question) : `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {puzzle.rows.map((question, row) => (
              <tr key={question.id}>
                <th scope="row">{showClues ? crosswordClue(question) : `Row ${row + 1}`}</th>
                {puzzle.columns.map((column, col) => {
                  const index = row * size + col;
                  return (
                    <td key={column.id}>
                      <button
                        type="button"
                        className={[
                          styles.cell,
                          checked?.[index] === false ? styles.incorrect : "",
                          checked?.[index] === true ? styles.correct : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-label={label(index)}
                        aria-pressed={!!cells[index] && selected === cells[index]!.path}
                        {...(checked?.[index] === false ? { "aria-invalid": true as const } : {})}
                        disabled={!!finished || isFixed(index)}
                        onClick={() => place(index)}
                      >
                        {cells[index] ? (
                          <GamePhoto photo={cells[index]!} />
                        ) : (
                          <span aria-hidden="true">+</span>
                        )}
                        {checked && cells[index] ? (
                          <span className={styles.mark} aria-hidden="true">
                            {checked[index] ? "✓" : "×"}
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status">
        {message || (selected ? "Choose a square for the selected photograph." : "")}
      </p>
      {!finished ? (
        <>
          <div className={styles.tray} role="group" aria-label="Available photographs">
            {tiles
              .filter((photo) => !used.has(photo.path))
              .map((photo, index) => (
                <button
                  type="button"
                  key={photo.path}
                  className={styles.tile}
                  aria-label={`Select photograph ${index + 1}`}
                  aria-pressed={selected === photo.path}
                  onClick={() => {
                    setSelected(selected === photo.path ? null : photo.path);
                    setMessage("");
                  }}
                >
                  <GamePhoto photo={photo} />
                  {selected === photo.path ? (
                    <span className={styles.mark} aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                const result = checkPhotoCrossword(puzzle, cells);
                setChecked(result);
                const count = result.filter(Boolean).length;
                setMessage(`${count} of ${size ** 2} photographs fit both clues.`);
                if (result.every(Boolean)) setFinished("solved");
              }}
            >
              Check grid
            </Button>
            <Button
              disabled={!selected || !used.has(selected)}
              onClick={() => {
                setCells(cells.map((photo) => (photo?.path === selected ? null : photo)));
                setSelected(null);
                setChecked(null);
                setMessage("");
              }}
            >
              Remove selected
            </Button>
            <Button
              disabled={!cells.some((photo, index) => photo && !isFixed(index))}
              onClick={() => {
                setCells(cells.map((photo, index) => (isFixed(index) ? photo : null)));
                setSelected(null);
                setChecked(null);
                setMessage("");
              }}
            >
              Clear grid
            </Button>
            <Button onClick={() => setTiles(shuffleGamePhotos(tiles))}>Shuffle</Button>
            {mode === "hidden" && !cluesRevealed ? (
              <Button onClick={() => setCluesRevealed(true)}>Reveal clues</Button>
            ) : null}
            <Button
              variant="quiet"
              onClick={() => {
                setCells(puzzle.solution);
                setChecked(null);
                setSelected(null);
                setFinished("revealed");
                setMessage("");
              }}
            >
              Give up
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
          <Button
            onClick={() => {
              setPuzzle(null);
              setFinished(null);
              setMessage("");
            }}
          >
            Change grid size
          </Button>
        </div>
      )}
    </div>
  );
};
