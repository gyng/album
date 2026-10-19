import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  buildPhotoCrossword,
  checkPhotoCrossword,
  checkHiddenCrossword,
  resolveHiddenCrossword,
  crosswordClue,
  crosswordSeedIndices,
  type CrosswordClueCoordinate,
  type PhotoCrosswordPuzzle,
} from "../../util/photoCrossword";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { useUrlSearchParams } from "../platform";
import { Button, Caption, Heading, KeyHint } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto } from "./GamePhoto";
import { useGameReadiness } from "./GameReadiness";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
  useShareOrigin,
} from "./GameRecord";
import { useGameShortcuts, type GameShortcut } from "./useGameShortcuts";
import { useGameSettings, type GameSettingsRegistry } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoCrossword.module.css";

const columnLetter = (index: number) => String.fromCharCode(65 + index);

type RoundSettings = GameSettingsRegistry["cross"];

/** Everyone's daily board is the same: a 4×4 grid of hidden connections, every square empty. */
const DAILY_SETTINGS: RoundSettings = { mode: "hidden", prefill: 0, size: 4 };

/** Today's board, identical on every device whatever order the archive arrived in. */
export const dailyCrosswordPuzzle = (photos: PhotoGamePhoto[], day?: string) =>
  buildPhotoCrossword(
    dailyPhotoOrder(photos),
    DAILY_SETTINGS.size,
    dailyPuzzle("cross-exposure", day).random(),
  );

const hintCount = (count: number) => `${count} ${count === 1 ? "hint" : "hints"}`;

// Spoiler-free: how the round went, never which photographs or clues.
const dailySummary = (outcome: "solved" | "revealed", size: number, hints: number) =>
  `${size}×${size} · ${
    outcome === "solved"
      ? `Solved with ${hints ? hintCount(hints) : "no hints"}`
      : hints
        ? `Gave up after ${hintCount(hints)}`
        : "Gave up"
  }`;

export const PhotoCrossword = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [settings, setSettings] = useGameSettings("cross");
  // The board in play keeps the settings it was dealt with; a daily's are fixed and never saved.
  const [round, setRound] = useState<RoundSettings>(settings);
  const [daily, setDaily] = useState<string | null>(null);
  const { stats, record } = useGameStats("cross-exposure");
  const shareOrigin = useShareOrigin();
  const { loading } = useGameReadiness();
  const {
    ready: urlReady,
    searchParams,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const today = dailyPuzzle("cross-exposure");
  const todaysResult = stats?.dailies[today.day];
  const dailyRequested = useRef(false);
  const [revealedClues, setRevealedClues] = useState<CrosswordClueCoordinate[]>([]);
  const [lastHint, setLastHint] = useState<string | null>(null);
  // Squares a hint has filled for the player, locked like the starting photographs.
  const [placedByHint, setPlacedByHint] = useState<number[]>([]);
  const [puzzle, setPuzzle] = useState<PhotoCrosswordPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [cells, setCells] = useState<Array<PhotoGamePhoto | null>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[] | null>(null);
  const [finished, setFinished] = useState<"solved" | "revealed" | null>(null);
  const [message, setMessage] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragPath = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [dockSticky, setDockSticky] = useState(false);
  useEffect(() => {
    const cancel = () => {
      if (!dragPath.current) return;
      dragPath.current = null;
      setDragged(null);
      setDropTarget(null);
      setSelected(null);
      setMessage("");
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) {
      setDockHeight(0);
      setDockSticky(false);
      return;
    }
    const measure = () => {
      const height = Math.ceil(dock.getBoundingClientRect().height);
      const top = Number.parseFloat(getComputedStyle(dock).insetBlockStart) || 8;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const fits =
        !finished &&
        window.matchMedia("(max-width: 960px)").matches &&
        height + top + 144 <= viewport;
      setDockSticky(fits);
      setDockHeight(fits ? height : 0);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [puzzle, finished]);
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  const setDailyUrl = (on: boolean) => {
    if (hasSearchParam("daily") === on) return;
    const params = new URLSearchParams(searchParams);
    if (on) params.set("daily", "");
    else params.delete("daily");
    replaceSearchParams(params);
  };
  const deal = (
    next: PhotoCrosswordPuzzle | null,
    roundSettings: RoundSettings,
    day: string | null,
  ) => {
    if (!next) {
      setMessage(
        "There are not enough photographs for this grid. Try a smaller grid or another puzzle.",
      );
      return;
    }
    dragPath.current = null;
    setDragged(null);
    setDropTarget(null);
    setRound(roundSettings);
    setDaily(day);
    setDailyUrl(day !== null);
    setPuzzle(next);
    setTiles(next.tiles);
    setRevealedClues([]);
    setLastHint(null);
    setPlacedByHint([]);
    const seeds = new Set(crosswordSeedIndices(next.size, roundSettings.prefill));
    setCells(
      Array.from({ length: next.size ** 2 }, (_, index) =>
        seeds.has(index) ? next.solution[index]! : null,
      ),
    );
    setSelected(null);
    setChecked(null);
    setFinished(null);
    setMessage("");
  };
  const start = () => deal(buildPhotoCrossword(photos, settings.size), settings, null);
  const startDaily = () => {
    if (todaysResult) return;
    deal(dailyCrosswordPuzzle(photos, today.day), DAILY_SETTINGS, today.day);
  };
  // `?daily` opens today's board, or its result once it has been played.
  useEffect(() => {
    if (dailyRequested.current || !urlReady || loading || !stats || !photos.length) return;
    dailyRequested.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- a linked daily opens once the URL and stored record are readable after hydration; dealing writes the URL and refs, so it cannot run in render
    if (hasSearchParam("daily") && !stats.dailies[today.day]) startDaily();
  });
  const { mode, prefill } = round;
  const size = puzzle?.size ?? settings.size;
  // Recorded where the round ends, so a re-render can never count it twice.
  const finish = (outcome: "solved" | "revealed") => {
    setFinished(outcome);
    record({
      won: outcome === "solved",
      ...(daily
        ? {
            daily: {
              day: daily,
              summary: dailySummary(outcome, size, revealedClues.length + placedByHint.length),
            },
          }
        : {}),
    });
  };
  const seedIndices = new Set(crosswordSeedIndices(size, prefill));
  const isFixed = (index: number) => seedIndices.has(index) || placedByHint.includes(index);
  const showClue = (axis: "row" | "column", index: number) =>
    mode === "visible" ||
    !!finished ||
    revealedClues.some((clue) => clue.axis === axis && clue.index === index);
  const remainingHints = size * 2 - revealedClues.length;
  const showClueKey = mode === "visible" || !!finished || revealedClues.length > 0;
  const place = (index: number, path = selected) => {
    if (finished || isFixed(index)) return;
    if (!path) {
      if (cells[index]) {
        setSelected(cells[index]!.path);
        setMessage(
          "Choose another square to move this photograph. If it is occupied, the photographs swap.",
        );
      }
      return;
    }
    const photo = tiles.find((item) => item.path === path);
    if (!photo || cells.some((item, cell) => item?.path === path && isFixed(cell))) return;
    const next = [...cells];
    const previous = next.findIndex((item) => item?.path === path);
    if (previous >= 0) next[previous] = next[index]!;
    next[index] = photo;
    setCells(next);
    setSelected(null);
    setChecked(null);
    setMessage("");
  };
  const used = new Set(cells.filter(Boolean).map((photo) => photo!.path));
  const revealHint = () => {
    if (!puzzle) return;
    const next = Array.from({ length: size }, (_, index) => [
      { axis: "row" as const, index },
      { axis: "column" as const, index },
    ])
      .flat()
      .find(
        (clue) =>
          !revealedClues.some((shown) => shown.axis === clue.axis && shown.index === clue.index),
      );
    if (!next) return;
    setRevealedClues([...revealedClues, next]);
    setChecked(null);
    const question = (next.axis === "row" ? puzzle.rows : puzzle.columns)[next.index]!;
    const clue = `${next.axis === "row" ? `Row ${next.index + 1}` : `Column ${columnLetter(next.index)}`} · ${crosswordClue(question)}`;
    setLastHint(clue);
    setMessage(
      `${clue}. ${remainingHints - 1} ${remainingHints - 1 === 1 ? "clue" : "clues"} still hidden.`,
    );
  };
  // The square a placing hint fills next: an empty one first, then one holding
  // the wrong photograph. The photograph is the solution's for that square, so
  // the rest of the solution stays reachable whatever else is on the board.
  const nextPlacement = puzzle
    ? (() => {
        const open = Array.from({ length: size ** 2 }, (_, index) => index).filter(
          (index) => !isFixed(index) && cells[index]?.path !== puzzle.solution[index]!.path,
        );
        return open.find((index) => !cells[index]) ?? open[0];
      })()
    : undefined;
  const placeHint = () => {
    if (!puzzle || finished || nextPlacement === undefined) return;
    const photo = puzzle.solution[nextPlacement]!;
    const next = [...cells];
    const previous = next.findIndex((item) => item?.path === photo.path);
    if (previous >= 0) next[previous] = next[nextPlacement]!;
    next[nextPlacement] = photo;
    setCells(next);
    setPlacedByHint([...placedByHint, nextPlacement]);
    setSelected(null);
    setChecked(null);
    const square = `Row ${Math.floor(nextPlacement / size) + 1}, column ${columnLetter(nextPlacement % size)}`;
    setLastHint(`${square} · placed`);
    setMessage(`A photograph is placed and locked in ${square}.`);
  };
  const label = (index: number) =>
    `Row ${Math.floor(index / size) + 1}${showClue("row", Math.floor(index / size)) ? `: ${crosswordClue(puzzle!.rows[Math.floor(index / size)]!)}` : ""}; column ${columnLetter(index % size)}${showClue("column", index % size) ? `: ${crosswordClue(puzzle!.columns[index % size]!)}` : ""}${placedByHint.includes(index) ? "; placed by a hint" : isFixed(index) ? "; fixed starting photograph" : cells[index] ? "; occupied" : "; empty"}`;
  const checkGrid = () => {
    if (!puzzle || finished) return;

    if (mode === "hidden" && remainingHints > 0) {
      const resolved = resolveHiddenCrossword(puzzle, cells, revealedClues);
      if (resolved) {
        setPuzzle(resolved);
        setChecked(cells.map(() => true));
        setMessage("Every row and column shares a connection.");
        finish("solved");
      } else {
        setChecked(null);
        setMessage(
          checkHiddenCrossword(puzzle, cells, revealedClues)
            ? "Placed photographs fit the hidden connections so far."
            : "Some rows or columns do not share a connection. Move photographs or ask for a hint.",
        );
      }
      return;
    }
    const result = checkPhotoCrossword(puzzle, cells);
    setChecked(result);
    const count = result.filter(Boolean).length;
    setMessage(`${count} of ${size ** 2} photographs fit both clues.`);
    if (result.every(Boolean)) finish("solved");
  };
  const giveUp = () => {
    if (!puzzle || finished) return;
    setCells(puzzle.solution);
    setChecked(null);
    setSelected(null);
    finish("revealed");
    setMessage("");
    endDrag();
  };
  const endDrag = () => {
    dragPath.current = null;
    setDragged(null);
    setDropTarget(null);
    setSelected(null);
    setMessage("");
  };
  const beginDrag = (event: DragEvent<HTMLButtonElement>, path: string) => {
    if (finished || cells.some((photo, index) => photo?.path === path && isFixed(index))) {
      event.preventDefault();
      return;
    }
    dragPath.current = path;
    event.dataTransfer.setData("application/x-cross-exposure-photo", path);
    event.dataTransfer.effectAllowed = "move";
    // The native drag image carries the photograph; its source stays visible and dimmed.
    setDragged(path);
    setSelected(path);
    setMessage("Move the photograph to an unlocked square. Occupied squares swap photographs.");
  };
  const shortcuts: GameShortcut[] = [
    {
      key: "n",
      label: puzzle ? "New puzzle" : "Start",
      action: start,
      enabled: !puzzle || !!finished,
    },
    {
      key: "h",
      label: "Hint",
      action: revealHint,
      enabled: !!puzzle && !finished && mode === "hidden" && remainingHints > 0,
    },
    {
      key: "p",
      label: "Place a photo",
      action: placeHint,
      enabled: !!puzzle && !finished && nextPlacement !== undefined,
    },
    {
      key: "Escape",
      label: "Cancel selection",
      action: () => {
        setSelected(null);
        setMessage("");
        endDrag();
      },
      enabled: !!selected || !!dragged,
    },
    { key: "Enter", label: "Check grid", action: checkGrid, enabled: !!puzzle && !finished },
    { key: "g", label: "Give up", action: giveUp, enabled: !!puzzle && !finished },
  ];
  useGameShortcuts(shortcuts);
  if (!puzzle)
    return (
      <GameIntro game="cross-exposure">
        <p>
          {settings.mode === "hidden"
            ? "Find a shared subject for each row and column. Each photograph must fit both."
            : "Match each photograph to its row and column clues. Use each photograph once. More than one arrangement can work."}
        </p>
        <div className={styles.actions} role="group" aria-label="Clue mode">
          <Button
            active={settings.mode === "hidden"}
            aria-pressed={settings.mode === "hidden"}
            onClick={() => {
              setSettings((previous) => ({ ...previous, mode: "hidden" }));
            }}
          >
            Hidden connections
          </Button>
          <Button
            active={settings.mode === "visible"}
            aria-pressed={settings.mode === "visible"}
            onClick={() => {
              setSettings((previous) => ({ ...previous, mode: "visible" }));
            }}
          >
            Visible clues
          </Button>
        </div>
        <div className={styles.actions} role="group" aria-label="Grid size">
          {([3, 4, 5] as const).map((value) => (
            <Button
              key={value}
              active={settings.size === value}
              aria-pressed={settings.size === value}
              onClick={() => {
                setSettings((previous) => ({ ...previous, size: value }));
                setMessage("");
              }}
            >
              {value}×{value}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Starting photographs">
          {([0, 1, 2, 3, 4] as const).map((choice) => (
            <Button
              key={choice}
              aria-label={`${choice} starting photographs`}
              active={settings.prefill === choice}
              aria-pressed={settings.prefill === choice}
              onClick={() => setSettings((previous) => ({ ...previous, prefill: choice }))}
            >
              {choice}
            </Button>
          ))}
        </div>
        <Caption>
          {settings.prefill === 0
            ? "All squares start empty."
            : `${settings.prefill} fixed ${settings.prefill === 1 ? "photograph" : "photographs"}.`}
        </Caption>
        {message ? <p role="alert">{message}</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" onClick={start}>
            Start crossing
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          {stats && !todaysResult ? (
            <>
              <Button onClick={startDaily}>Daily #{today.number}</Button>
              <Caption>4×4 · Hidden connections</Caption>
            </>
          ) : null}
        </div>
        {todaysResult ? (
          <div className={styles.actions}>
            <Caption>
              Daily #{today.number} · {todaysResult.summary}
            </Caption>
            <ShareResult
              text={dailyShareText("cross-exposure", today.day, todaysResult.summary, shareOrigin)}
            />
          </div>
        ) : null}
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  return (
    <div
      className={styles.game}
      style={
        {
          "--crossword-dock-height": `${!finished && dockSticky ? dockHeight : 0}px`,
        } as CSSProperties
      }
    >
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
          {daily && stats?.dailies[daily] ? (
            <ShareResult
              text={dailyShareText(
                "cross-exposure",
                daily,
                stats.dailies[daily].summary,
                shareOrigin,
              )}
            />
          ) : null}
          <ResultNextSteps photos={puzzle.solution} />
        </div>
      ) : null}
      <div
        className={[styles.workspace, finished ? styles.workspaceFinished : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          ref={dockRef}
          className={[styles.boardDock, !finished && dockSticky ? styles.boardDockActive : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={styles.boardBar} role="group" aria-label="Crossword controls">
            <Caption>
              {cells.filter(Boolean).length} of {size ** 2} squares filled
            </Caption>
            {selected ? (
              <div className={styles.dockSelection} aria-hidden="true">
                <GamePhoto photo={tiles.find((photo) => photo.path === selected)!} />
              </div>
            ) : null}
            {mode === "hidden" && !finished && remainingHints > 0 ? (
              <Button aria-label="Hint" onClick={revealHint}>
                Hint · {remainingHints}
                <KeyHint aria-hidden="true">H</KeyHint>
              </Button>
            ) : null}
            {!finished && nextPlacement !== undefined ? (
              <Button onClick={placeHint}>
                Place a photo
                <KeyHint aria-hidden="true">P</KeyHint>
              </Button>
            ) : null}
          </div>
          {lastHint && !finished ? (
            <Caption className={styles.hintFeedback}>{lastHint}</Caption>
          ) : null}
          <div className={styles.boardScroll} role="region" aria-label="Crossword board">
            <table className={styles.board} style={{ "--crossword-size": size } as CSSProperties}>
              <colgroup>
                <col className={styles.rowColumn} />
                <col span={size} />
              </colgroup>
              <thead>
                <tr>
                  <td aria-hidden="true" />
                  {puzzle.columns.map((question, index) => (
                    <th
                      key={question.id}
                      scope="col"
                      aria-label={
                        showClue("column", index)
                          ? crosswordClue(question)
                          : `Column ${columnLetter(index)}`
                      }
                    >
                      {showClue("column", index) ? (
                        crosswordClue(question)
                      ) : (
                        <>
                          <span className={styles.fullClue} aria-hidden="true">
                            Column {columnLetter(index)}
                          </span>
                          <span className={styles.shortClue} aria-hidden="true">
                            {columnLetter(index)}
                          </span>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {puzzle.rows.map((question, row) => (
                  <tr key={question.id}>
                    <th
                      scope="row"
                      aria-label={showClue("row", row) ? crosswordClue(question) : `Row ${row + 1}`}
                    >
                      {showClue("row", row) ? (
                        <span className={styles.rowClue}>{crosswordClue(question)}</span>
                      ) : (
                        <>
                          <span className={styles.fullClue} aria-hidden="true">
                            Row {row + 1}
                          </span>
                          <span className={styles.shortClue} aria-hidden="true">
                            {row + 1}
                          </span>
                        </>
                      )}
                    </th>
                    {puzzle.columns.map((column, col) => {
                      const index = row * size + col;
                      return (
                        <td key={column.id}>
                          <button
                            type="button"
                            className={[
                              styles.cell,
                              isFixed(index) ? styles.fixed : "",
                              dragged === cells[index]?.path ? styles.dragging : "",
                              dragged && !isFixed(index) ? styles.dropAvailable : "",
                              dragged && isFixed(index) ? styles.dropBlocked : "",
                              dropTarget === index ? styles.dropTarget : "",
                              checked?.[index] === false ? styles.incorrect : "",
                              checked?.[index] === true ? styles.correct : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            aria-label={label(index)}
                            aria-pressed={!!cells[index] && selected === cells[index]!.path}
                            {...(checked?.[index] === false
                              ? { "aria-invalid": true as const }
                              : {})}
                            disabled={!!finished || isFixed(index)}
                            draggable={!!cells[index] && !finished && !isFixed(index)}
                            onDragStart={(event) => {
                              if (cells[index]) beginDrag(event, cells[index]!.path);
                            }}
                            onDragEnd={endDrag}
                            onDragOver={(event) => {
                              if (!dragPath.current || finished || isFixed(index)) {
                                event.dataTransfer.dropEffect = "none";
                                return;
                              }
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setDropTarget(index);
                            }}
                            onDragLeave={() =>
                              setDropTarget((target) => (target === index ? null : target))
                            }
                            onDrop={(event) => {
                              event.preventDefault();
                              const path = event.dataTransfer.getData(
                                "application/x-cross-exposure-photo",
                              );
                              if (path && path === dragPath.current) place(index, path);
                              endDrag();
                            }}
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
                            {isFixed(index) && !finished ? (
                              <span className={styles.seedMark} aria-hidden="true">
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  aria-hidden="true"
                                >
                                  <rect x="5" y="10" width="14" height="11" rx="2" />
                                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                                </svg>
                                <span>Fixed</span>
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
        </div>
        <div className={styles.sidePanel}>
          {showClueKey ? (
            <div className={styles.clueKey}>
              <section aria-label="Row clues">
                <Heading level={2}>Rows</Heading>
                <ol>
                  {puzzle.rows.map((question, index) =>
                    showClue("row", index) ? (
                      <li key={question.id}>
                        {index + 1} · {crosswordClue(question)}
                      </li>
                    ) : null,
                  )}
                </ol>
              </section>
              <section aria-label="Column clues">
                <Heading level={2}>Columns</Heading>
                <ol>
                  {puzzle.columns.map((question, index) =>
                    showClue("column", index) ? (
                      <li key={question.id}>
                        {columnLetter(index)} · {crosswordClue(question)}
                      </li>
                    ) : null,
                  )}
                </ol>
              </section>
            </div>
          ) : null}
          {!finished ? (
            <>
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Tray accepts pointer drops; all moves also have native button alternatives. */}
              <div
                className={[styles.tray, dropTarget === -1 ? styles.dropTarget : ""]
                  .filter(Boolean)
                  .join(" ")}
                role="group"
                aria-label="Available photographs"
                onDragOver={(event) => {
                  if (!dragPath.current || !used.has(dragPath.current)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(-1);
                }}
                onDragLeave={() => setDropTarget((target) => (target === -1 ? null : target))}
                onDrop={(event) => {
                  event.preventDefault();
                  const path = event.dataTransfer.getData("application/x-cross-exposure-photo");
                  if (path && path === dragPath.current) {
                    setCells(
                      cells.map((photo, index) =>
                        photo?.path === path && !isFixed(index) ? null : photo,
                      ),
                    );
                    setChecked(null);
                  }
                  endDrag();
                }}
              >
                {tiles
                  .filter((photo) => !used.has(photo.path))
                  .map((photo, index) => (
                    <button
                      type="button"
                      key={photo.path}
                      className={[styles.tile, dragged === photo.path ? styles.dragging : ""]
                        .filter(Boolean)
                        .join(" ")}
                      draggable
                      onDragStart={(event) => beginDrag(event, photo.path)}
                      onDragEnd={endDrag}
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
                <Button variant="primary" onClick={checkGrid}>
                  Check grid
                  <KeyHint aria-hidden="true">Enter</KeyHint>
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
                <Button variant="quiet" onClick={giveUp}>
                  Give up
                  <KeyHint aria-hidden="true">G</KeyHint>
                </Button>
              </div>
              {selected ? (
                <section className={styles.selectedPreview} aria-label="Selected photograph">
                  <Caption>Selected photograph</Caption>
                  <GamePhoto photo={tiles.find((photo) => photo.path === selected)!} />
                </section>
              ) : null}
            </>
          ) : (
            <div className={styles.actions}>
              <Button variant="primary" onClick={start}>
                Play again
                <KeyHint aria-hidden="true">N</KeyHint>
              </Button>
              <Button
                onClick={() => {
                  setPuzzle(null);
                  setFinished(null);
                  setDaily(null);
                  setDailyUrl(false);
                  setMessage("");
                }}
              >
                Change grid size
              </Button>
            </div>
          )}
          <p role="status">
            {message || (selected ? "Choose a square for the selected photograph." : "")}
          </p>
        </div>
      </div>
    </div>
  );
};
