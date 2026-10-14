import { useEffect, useId, useRef, useState } from "react";
import { useUrlSearchParams } from "../platform";
import { Button, Caption, KeyHint } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameDock } from "./GameDock";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { useGameSettings } from "./useGameSettings";
import { useGameShortcuts } from "./useGameShortcuts";
import { useGameStats } from "./useGameStats";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
  useShareOrigin,
} from "./GameRecord";
import { dailyNumber, localDayKey } from "../../util/gameDaily";
import {
  buildPhotoWordSearch,
  PHOTO_SEARCH_SIZES,
  PHOTO_SEARCH_LINE_LENGTHS,
  matchPhotoSearchLine,
  photoSearchLine,
  type PhotoWordSearch,
} from "../../util/photoWordSearch";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./SightLines.module.css";

/** Everyone's daily board has the same shape, whatever their own saved settings. */
export const SIGHT_LINES_DAILY = { size: 6, lineLength: 4 } as const;

/** Today's board, independent of the archive's arrival order and of `Math.random`. */
export const buildDailySightLines = (photos: PhotoGamePhoto[], day: string = localDayKey()) =>
  buildPhotoWordSearch(
    dailyPhotoOrder(photos),
    SIGHT_LINES_DAILY.size,
    dailyPuzzle("sight-lines", day).random(),
    SIGHT_LINES_DAILY.lineLength,
  );

/** Spoiler-free: the shape of the board and how it went, never its subjects. */
const dailySummary = (puzzle: PhotoWordSearch, found: number, hints: number) =>
  `${puzzle.size}×${puzzle.size} · ${found}/${puzzle.targets.length} lines · ${
    hints ? `${hints} ${hints === 1 ? "hint" : "hints"}` : "no hints"
  }`;

export const SightLines = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [settings, setSettings] = useGameSettings("sightLines");
  const { ready: urlReady, hasSearchParam } = useUrlSearchParams();
  const { stats, record } = useGameStats("sight-lines");
  const shareOrigin = useShareOrigin();
  const dailyDescriptionId = useId();
  const [puzzle, setPuzzle] = useState<PhotoWordSearch | null>(null);
  // The day of the daily being played; null for an ordinary game.
  const [daily, setDaily] = useState<string | null>(null);
  const [hinted, setHinted] = useState<string[]>([]);
  const [found, setFound] = useState<Array<{ id: string; cells: number[] }>>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [hint, setHint] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const drag = useRef<{ start: number; end: number; pointer: number } | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [focusCell, setFocusCell] = useState(0);
  const finished = Boolean(puzzle && (gaveUp || found.length === puzzle.targets.length));
  useEffect(() => {
    if (!finished) return;
    // Let the finishing touch's compatibility click settle before moving focus.
    const frame = requestAnimationFrame(() => resultRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [finished]);
  const begin = (next: PhotoWordSearch, day: string | null) => {
    setPuzzle(next);
    setDaily(day);
    setHinted([]);
    setFound([]);
    setSelected([]);
    setAnchor(null);
    setHint(null);
    setGaveUp(false);
    setMessage("");
    drag.current = null;
    setFocusCell(0);
  };
  const start = () => {
    const next = buildPhotoWordSearch(photos, settings.size, Math.random, settings.lineLength);
    if (!next) {
      setMessage("There are not enough photographs for this grid. Try a smaller grid.");
      return;
    }
    begin(next, null);
  };
  const startDaily = () => {
    const day = localDayKey();
    const next = buildDailySightLines(photos, day);
    if (!next) {
      setMessage("There are not enough photographs for today’s board.");
      return;
    }
    begin(next, day);
  };
  const today = localDayKey();
  const todaysDaily = stats?.dailies[today];
  // A linked daily starts once the archive and the player's record are both known.
  const linkedDaily = useRef(false);
  const startLinkedDaily = useRef(startDaily);
  startLinkedDaily.current = startDaily;
  useEffect(() => {
    if (linkedDaily.current || !urlReady || !stats || !photos.length) return;
    linkedDaily.current = true;
    if (hasSearchParam("daily") && !stats.dailies[localDayKey()]) startLinkedDaily.current();
  }, [urlReady, hasSearchParam, stats, photos.length]);
  // No score: boards of different sizes would not compare. A win is every line, unaided by Give up.
  const finish = (board: PhotoWordSearch, foundCount: number) =>
    record({
      won: foundCount === board.targets.length,
      ...(daily
        ? { daily: { day: daily, summary: dailySummary(board, foundCount, hinted.length) } }
        : {}),
    });
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
      if (next.length === puzzle.targets.length) finish(puzzle, next.length);
      setMessage(
        next.length === puzzle.targets.length
          ? "Every sight line found!"
          : `${target.label} found.`,
      );
      setSelected([]);
    } else
      setMessage(
        cells.length !== puzzle.lineLength
          ? `Choose a straight line of ${puzzle.lineLength} photographs.`
          : "That line does not match a remaining subject.",
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
  const showHint = () => {
    if (!puzzle || finished) return;
    const target = puzzle.targets.find((item) => !found.some((match) => match.id === item.id));
    if (!target) return;
    setHint(target.cells[0]!);
    if (!hinted.includes(target.id)) setHinted([...hinted, target.id]);
    setSelected([]);
    setAnchor(null);
    setMessage(`${target.label}: the line starts at the marked photograph.`);
  };
  const giveUp = () => {
    if (!puzzle || finished) return;
    finish(puzzle, found.length);
    setGaveUp(true);
    setSelected([]);
    setAnchor(null);
    setHint(null);
    setMessage("The hidden sight lines are revealed below.");
  };
  const clear = () => {
    drag.current = null;
    setSelected([]);
    setAnchor(null);
    setHint(null);
    setMessage("");
  };
  const shortcuts = [
    {
      key: "N",
      label: puzzle ? "Play again" : "Start searching",
      action: start,
      enabled: !puzzle || finished,
    },
    { key: "H", label: "Hint", action: showHint, enabled: Boolean(puzzle && !finished) },
    {
      key: "Escape",
      label: "Clear selection",
      action: clear,
      enabled: Boolean(puzzle && !finished),
    },
    { key: "G", label: "Give up", action: giveUp, enabled: Boolean(puzzle && !finished) },
  ];
  useGameShortcuts(shortcuts);
  if (!puzzle)
    return (
      <GameIntro game="sight-lines">
        <p>Find lines of {settings.lineLength} related photographs: across, down or diagonally.</p>
        <div className={styles.actions} role="group" aria-label="Board size">
          {PHOTO_SEARCH_SIZES.map((size) => (
            <Button
              key={size}
              active={settings.size === size}
              aria-pressed={settings.size === size}
              onClick={() => setSettings((previous) => ({ ...previous, size }))}
            >
              {size}×{size}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Line length">
          {PHOTO_SEARCH_LINE_LENGTHS.map((lineLength) => (
            <Button
              key={lineLength}
              active={settings.lineLength === lineLength}
              aria-pressed={settings.lineLength === lineLength}
              onClick={() => setSettings((previous) => ({ ...previous, lineLength }))}
            >
              {lineLength} per line
            </Button>
          ))}
        </div>
        {message ? <p role="alert">{message}</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" onClick={start}>
            Start searching
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          {todaysDaily ? null : (
            <>
              <Button onClick={startDaily} aria-describedby={dailyDescriptionId}>
                Daily #{dailyNumber(today)}
              </Button>
              <Caption id={dailyDescriptionId} as="span">
                {SIGHT_LINES_DAILY.size}×{SIGHT_LINES_DAILY.size} · {SIGHT_LINES_DAILY.lineLength}{" "}
                per line · the same board for everyone today
              </Caption>
            </>
          )}
        </div>
        {todaysDaily ? (
          <div className={styles.actions}>
            <p className={styles.dailyResult}>
              Daily #{dailyNumber(today)} · {todaysDaily.summary}
            </p>
            <ShareResult
              text={dailyShareText("sight-lines", today, todaysDaily.summary, shareOrigin)}
            />
          </div>
        ) : null}
        <GameStatsLine stats={stats} best={null} />
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
              <Button onClick={showHint}>
                Hint<KeyHint aria-hidden="true">H</KeyHint>
              </Button>
              <Button onClick={giveUp}>
                Give up<KeyHint aria-hidden="true">G</KeyHint>
              </Button>
            </>
          ) : (
            <Button onClick={start}>
              Play again<KeyHint aria-hidden="true">N</KeyHint>
            </Button>
          )}
        </div>
        <section aria-label="Search targets" className={styles.targets}>
          <h2>Find these</h2>
          <Caption>{puzzle.lineLength} photographs in a straight line for each subject.</Caption>
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
        <div className={styles.boardScroll}>
          <div
            ref={boardRef}
            className={styles.board}
            data-large={puzzle.size > 6}

            role="group"
            aria-label="Photo search board"
            style={{ "--search-size": puzzle.size } as React.CSSProperties}
            onPointerMove={(event) => {
              if (event.pointerType === "touch" && puzzle.size > 6) return;
              if (!drag.current || drag.current.pointer !== event.pointerId) return;
              if (event.buttons === 0) {
                drag.current = null;
                setSelected(anchor === null ? [] : [anchor]);
                return;
              }
              const tile = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLButtonElement>("button[data-cell]");
              if (!tile || !event.currentTarget.contains(tile)) return;
              drag.current.end = Number(tile.dataset.cell);
              if (
                drag.current.end !== drag.current.start &&
                !event.currentTarget.hasPointerCapture(event.pointerId)
              )
                event.currentTarget.setPointerCapture(event.pointerId);
              setSelected(photoSearchLine(drag.current.start, drag.current.end, puzzle.size));
            }}
            onPointerUp={(event) => {
              const gesture = drag.current;
              if (!gesture || gesture.pointer !== event.pointerId) return;
              drag.current = null;
              if (gesture.start !== gesture.end)
                check(photoSearchLine(gesture.start, gesture.end, puzzle.size));
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
                  tabIndex={index === focusCell ? 0 : -1}
                  onFocus={() => setFocusCell(index)}
                  onKeyDown={(event) => {
                    const tile =
                      event.target instanceof Element
                        ? event.target.closest<HTMLButtonElement>("button[data-cell]")
                        : null;
                    if (!tile || finished) return;
                    const index = Number(tile.dataset.cell),
                      column = index % puzzle.size;
                    let next = index;
                    switch (event.key) {
                      case "ArrowRight":
                        if (column < puzzle.size - 1) next = index + 1;
                        break;
                      case "ArrowLeft":
                        if (column > 0) next = index - 1;
                        break;
                      case "ArrowDown":
                        if (index + puzzle.size < puzzle.tiles.length) next = index + puzzle.size;
                        break;
                      case "ArrowUp":
                        if (index >= puzzle.size) next = index - puzzle.size;
                        break;
                      case "Home":
                        next = index - column;
                        break;
                      case "End":
                        next = index - column + puzzle.size - 1;
                        break;
                      default:
                        return;
                    }
                    event.preventDefault();
                    setFocusCell(next);
                    boardRef.current
                      ?.querySelector<HTMLButtonElement>(`button[data-cell="${next}"]`)
                      ?.focus();
                  }}
                  data-found={matches.length > 0}
                  data-hint={hint === index}
                  className={styles.tile}
                  disabled={finished}
                  aria-pressed={selected.includes(index)}
                  aria-label={`Row ${Math.floor(index / puzzle.size) + 1}, column ${(index % puzzle.size) + 1}${matches.length ? `; ${matches.map((item) => `${item.label} ${item.revealed ? "revealed" : "found"}`).join(", ")}` : ""}${hint === index ? "; hint starts here" : ""}`}
                  onPointerDown={(event) => {
                    if (event.pointerType === "touch" && puzzle.size > 6) return;
                    if (event.button !== 0) return;
                    drag.current = { start: index, end: index, pointer: event.pointerId };
                  }}
                  onClick={() => {
                    // A tap completes on click, after its compatibility events, so
                    // revealing and focusing result links cannot retarget that tap.
                    tap(index);
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
              : `All ${puzzle.targets.length} connections found.`}
          </p>
          {daily ? (
            <ShareResult
              text={dailyShareText(
                "sight-lines",
                daily,
                dailySummary(puzzle, found.length, hinted.length),
                shareOrigin,
              )}
            />
          ) : null}
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
          <ResultNextSteps photos={puzzle.tiles} />
        </section>
      ) : null}
    </div>
  );
};
