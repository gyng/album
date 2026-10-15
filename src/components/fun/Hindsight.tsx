import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Caption, Heading, KeyHint } from "../ui";
import { useUrlSearchParams } from "../platform";
import { formatExifWallClockDateTime } from "../../util/exifTime";
import {
  buildHindsightPuzzle,
  formatHindsightGap,
  scoreHindsight,
  type HindsightPhoto,
  type HindsightPuzzle,
  type HindsightSettings,
} from "../../util/hindsight";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { GameProgress, GameScore } from "./GameFeedback";
import { GamePhoto } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import { useGameReadiness } from "./GameReadiness";
import { GameDock } from "./GameDock";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
  useShareOrigin,
} from "./GameRecord";
import { readGameStats, useGameStats } from "./useGameStats";
import { useGameSettings } from "./useGameSettings";
import { useGameShortcuts } from "./useGameShortcuts";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoGames.module.css";
import hindsightStyles from "./Hindsight.module.css";

/** Everyone plays the same daily, whatever their own settings. */
const DAILY_SETTINGS: HindsightSettings = { size: 5, spread: "years" };

const SPREADS = [
  {
    value: "place",
    label: "Same place, different shot",
    detail: "Within 75 metres, at least ten minutes apart.",
  },
  { value: "years", label: "Across the years", detail: "At least three months between any two." },
  { value: "trip", label: "One trip", detail: "One album, all within two weeks." },
] as const;

const summaryOf = (size: number, score: number) => `${size} photographs · ${score}% in order`;

type Daily = { day: string; number: number };
type FocusRequest =
  | { path: string }
  | { check: true }
  | { slot: number; move: "earlier" | "later" };

export const Hindsight = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const { loading } = useGameReadiness();
  const [settings, setSettings] = useGameSettings("hindsight");
  const { stats, record } = useGameStats("hindsight");
  const shareOrigin = useShareOrigin();
  const {
    ready: urlReady,
    searchParams,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const [puzzle, setPuzzle] = useState<HindsightPuzzle | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [order, setOrder] = useState<HindsightPhoto[]>([]);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const activeDrag = useRef<string | null>(null);
  const recorded = useRef<HindsightPuzzle | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLOListElement>(null);
  const choiceRefs = useRef(new Map<string, HTMLButtonElement>());
  const checkRef = useRef<HTMLButtonElement>(null);
  const requestedFocus = useRef<FocusRequest | null>(null);
  const size = puzzle?.hand.length ?? settings.size;

  useEffect(() => {
    const request = requestedFocus.current;
    if (!request) return;
    requestedFocus.current = null;
    if ("check" in request) checkRef.current?.focus();
    else if ("slot" in request) {
      // Follow the moved photograph. At either end its own direction is
      // disabled, so the opposite move takes focus instead.
      const slot = boardRef.current?.children[request.slot];
      const opposite = request.move === "earlier" ? "later" : "earlier";
      [request.move, opposite]
        .map((move) => slot?.querySelector<HTMLButtonElement>(`[data-move="${move}"]`))
        .find((button) => button && !button.disabled)
        ?.focus();
    } else choiceRefs.current.get(request.path)?.focus();
  }, [order]);
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);

  const cancelDrag = () => {
    activeDrag.current = null;
    setDragged(null);
    setDropTarget(null);
  };
  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    return () => window.removeEventListener("blur", cancelDrag);
  }, []);

  const setDailyParam = (on: boolean) => {
    if (hasSearchParam("daily") === on) return;
    const params = new URLSearchParams(searchParams);
    if (on) params.set("daily", "");
    else params.delete("daily");
    replaceSearchParams(params);
  };
  const deal = (next: HindsightPuzzle | null, nextDaily: Daily | null) => {
    setMessage(next ? "" : "There are not enough dated photographs for this choice.");
    setPuzzle(next);
    setDaily(next ? nextDaily : null);
    setOrder([]);
    setFinished(false);
    cancelDrag();
  };
  const start = () => {
    setDailyParam(false);
    deal(buildHindsightPuzzle(photos, settings), null);
  };
  const startDaily = () => {
    const today = dailyPuzzle("hindsight");
    // The archive arrives in random order: sort it, or the seed deals differently.
    const next = buildHindsightPuzzle(dailyPhotoOrder(photos), DAILY_SETTINGS, today.random());
    setDailyParam(!!next);
    deal(next, { day: today.day, number: today.number });
  };
  const backToSetup = () => {
    setDailyParam(false);
    setPuzzle(null);
    setDaily(null);
    setFinished(false);
    cancelDrag();
  };

  // A `?daily` link opens straight onto today's board, once the archive is ready.
  const dailyOpened = useRef(false);
  useEffect(() => {
    if (dailyOpened.current || !urlReady || loading || !photos.length) return;
    dailyOpened.current = true;
    if (hasSearchParam("daily")) startDaily();
    // Runs once: startDaily reads the same props this effect waits for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlReady, loading, photos]);

  const finish = () => {
    if (!puzzle || order.length !== puzzle.hand.length) return;
    cancelDrag();
    setFinished(true);
    if (recorded.current === puzzle) return;
    recorded.current = puzzle;
    // A daily already finished today is practice: its answers are known.
    if (daily && readGameStats("hindsight").dailies[daily.day]) return;
    const result = scoreHindsight(puzzle.solution, order);
    record({
      won: result.perfect,
      score: result.score,
      ...(daily ? { daily: { day: daily.day, summary: summaryOf(size, result.score) } } : {}),
    });
  };

  useGameShortcuts(
    [
      { key: "Escape", label: "Cancel drag", action: cancelDrag, enabled: !!dragged },
      {
        key: "Enter",
        label: "Check order",
        action: finish,
        enabled: !!puzzle && !finished && order.length === size,
      },
      {
        key: "n",
        label: puzzle ? "Play again" : "Start",
        action: start,
        enabled: !puzzle || finished,
      },
    ],
    photos.length > 0,
  );

  const beginDrag = (event: DragEvent<HTMLElement>, path: string) => {
    activeDrag.current = path;
    event.dataTransfer.setData("text/plain", path);
    event.dataTransfer.effectAllowed = "move";
    setDragged(path);
    setDropTarget(null);
  };
  // A photograph can only land in the next free slot, so that is the slot a
  // drag over any later, empty one highlights and fills.
  const landingSlot = (index: number) =>
    Math.min(
      index,
      order.length - (order.some((photo) => photo.path === activeDrag.current) ? 1 : 0),
    );
  const move = (index: number, to: number, keyboard: boolean) => {
    if (keyboard) requestedFocus.current = { slot: to, move: to < index ? "earlier" : "later" };
    const next = [...order];
    [next[to], next[index]] = [next[index]!, next[to]!];
    setOrder(next);
  };

  if (!loading && photos.filter((photo) => photo.takenAt).length < 4)
    return <p>There are not enough dated photographs for Hindsight yet.</p>;

  if (!puzzle) {
    const today = dailyPuzzle("hindsight");
    const playedToday = stats?.dailies[today.day];
    return (
      <GameIntro game="hindsight">
        <p>Put {settings.size} photographs in the order they were taken.</p>
        <div className={styles.actions} role="group" aria-label="Photographs">
          {([4, 5, 6] as const).map((value) => (
            <Button
              key={value}
              active={settings.size === value}
              aria-pressed={settings.size === value}
              onClick={() => {
                setSettings((previous) => ({ ...previous, size: value }));
                setMessage("");
              }}
            >
              {value}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Time apart">
          {SPREADS.map(({ value, label }) => (
            <Button
              key={value}
              active={settings.spread === value}
              aria-pressed={settings.spread === value}
              onClick={() => {
                setSettings((previous) => ({ ...previous, spread: value }));
                setMessage("");
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Caption>{SPREADS.find((item) => item.value === settings.spread)!.detail}</Caption>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start Hindsight
          <KeyHint aria-hidden="true">N</KeyHint>
        </Button>
        <div className={hindsightStyles.daily}>
          <Button onClick={startDaily}>Daily #{today.number}</Button>
          <Caption as="span" size="sm">
            {playedToday
              ? `Played today · ${playedToday.summary}`
              : "Five photographs across the years, the same for everyone today."}
          </Caption>
        </div>
        <GameStatsLine stats={stats} formatBest={(value) => `${value}%`} />
      </GameIntro>
    );
  }

  if (finished) {
    const result = scoreHindsight(puzzle.solution, order);
    const placed = new Map(order.map((photo, index) => [photo.path, index]));
    return (
      <div
        className={[styles.game, styles.result].join(" ")}
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Hindsight result"
      >
        <Heading level={1}>{result.perfect ? "Perfect hindsight" : "As they were taken"}</Heading>
        {daily ? <Caption>Daily #{daily.number}</Caption> : null}
        <GameScore label="In order" score={result.score} />
        <Caption>
          {result.inOrder} of {result.pairs} pairs the right way round · {result.inPlace} of {size}{" "}
          in the right place
        </Caption>
        <ol className={hindsightStyles.reveal} aria-label="Order taken">
          {puzzle.solution.map((photo, index) => {
            const yours = placed.get(photo.path)!;
            const previous = puzzle.solution[index - 1];
            return (
              <li key={photo.path} data-correct={yours === index}>
                <GamePhoto photo={photo} link />
                <span className={hindsightStyles.when}>
                  <strong>{index + 1}</strong>{" "}
                  {formatExifWallClockDateTime(photo.takenAt) ?? photo.takenAt}
                </span>
                {previous ? (
                  <Caption as="span" size="sm">
                    {formatHindsightGap(photo.time - previous.time)}
                  </Caption>
                ) : null}
                <Caption as="span" size="sm">
                  {yours === index ? "In place" : `You placed it ${yours + 1}`}
                </Caption>
              </li>
            );
          })}
        </ol>
        <ResultNextSteps photos={puzzle.solution} />
        <div className={styles.actions}>
          {daily ? (
            <ShareResult
              text={dailyShareText(
                "hindsight",
                daily.day,
                summaryOf(size, result.score),
                shareOrigin,
              )}
            />
          ) : null}
          <Button variant="primary" onClick={start}>
            Play again
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          <Button variant="quiet" onClick={backToSetup}>
            Change settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.game}
      style={
        {
          "--hindsight-dock-height": `${dockHeight}px`,
          "--hindsight-size": size,
        } as React.CSSProperties
      }
    >
      {daily ? <Caption>Daily #{daily.number}</Caption> : null}
      <div className={hindsightStyles.workspace}>
        <div className={hindsightStyles.board}>
          <div className={styles.roundProgress}>
            <p role="status">
              {order.length} of {size} placed
            </p>
            <GameProgress current={order.length} total={size} />
          </div>
          <ol
            className={[styles.relaySlots, hindsightStyles.slots].join(" ")}
            aria-label="Your order, oldest first"
            ref={boardRef}
          >
            {Array.from({ length: size }, (_, index) => (
              // Native drag/drop supplements the move and remove buttons below.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={index}
                data-filled={!!order[index]}
                data-drop-active={!!dragged}
                data-drop-hover={dropTarget === index}
                data-dragging={order[index]?.path === dragged}
                onDragOver={(event) => {
                  if (!activeDrag.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(landingSlot(index));
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropTarget((current) => (current === landingSlot(index) ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const path = event.dataTransfer.getData("text/plain");
                  const photo =
                    path === activeDrag.current
                      ? puzzle.hand.find((item) => item.path === path)
                      : null;
                  cancelDrag();
                  if (!photo) return;
                  const next = order.filter((item) => item.path !== path);
                  next.splice(landingSlot(index), 0, photo);
                  setOrder(next);
                }}
              >
                {order[index] ? (
                  <>
                    <div
                      className={styles.dragFrame}
                      draggable
                      onDragStart={(event) => beginDrag(event, order[index]!.path)}
                      onDragEnd={cancelDrag}
                    >
                      <GamePhoto photo={order[index]!} />
                    </div>
                    <div className={[styles.slotActions, hindsightStyles.slotActions].join(" ")}>
                      <Button
                        variant="quiet"
                        aria-label={`Move photograph ${index + 1} earlier`}
                        data-move="earlier"
                        disabled={index === 0}
                        onClick={(event) => move(index, index - 1, event.detail === 0)}
                      >
                        ←
                      </Button>
                      <Button
                        variant="quiet"
                        aria-label={`Remove photograph ${index + 1}`}
                        onClick={(event) => {
                          if (event.detail === 0)
                            requestedFocus.current = { path: order[index]!.path };
                          setOrder(order.filter((_, position) => position !== index));
                        }}
                      >
                        ×
                      </Button>
                      <Button
                        variant="quiet"
                        aria-label={`Move photograph ${index + 1} later`}
                        data-move="later"
                        disabled={index === order.length - 1}
                        onClick={(event) => move(index, index + 1, event.detail === 0)}
                      >
                        →
                      </Button>
                    </div>
                  </>
                ) : (
                  <span>{index === 0 ? "Oldest" : index === size - 1 ? "Newest" : index + 1}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <GameDock
          {...(hindsightStyles.reference ? { className: hindsightStyles.reference } : {})}
          label="Order so far"
          onStickyHeightChange={setDockHeight}
        >
          <ol className={hindsightStyles.miniOrder} aria-hidden="true">
            {Array.from({ length: size }, (_, index) => (
              <li key={index}>
                {order[index] ? (
                  <GamePhoto photo={order[index]!} />
                ) : (
                  <span className={hindsightStyles.empty}>{index + 1}</span>
                )}
              </li>
            ))}
          </ol>
          <div className={hindsightStyles.referenceActions}>
            <Caption size="sm">
              {order.length} / {size} placed
            </Caption>
            <Button
              disabled={!order.length}
              onClick={(event) => {
                const control =
                  boardRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                control?.scrollIntoView({
                  block: "center",
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
                });
                if (event.detail === 0) control?.focus({ preventScroll: true });
              }}
            >
              Edit order
            </Button>
          </div>
        </GameDock>
        <div className={hindsightStyles.tray}>
          <div className={[styles.choices, hindsightStyles.choices].join(" ")}>
            {puzzle.hand.map((photo, index) => {
              const position = order.findIndex((item) => item.path === photo.path);
              return (
                <button
                  type="button"
                  key={photo.path}
                  className={[styles.choice, hindsightStyles.choice].join(" ")}
                  data-dragging={dragged === photo.path}
                  ref={(element) => {
                    if (element) choiceRefs.current.set(photo.path, element);
                    else choiceRefs.current.delete(photo.path);
                  }}
                  aria-pressed={position >= 0}
                  draggable={position < 0}
                  onDragStart={(event) => beginDrag(event, photo.path)}
                  onDragEnd={cancelDrag}
                  disabled={position >= 0}
                  onClick={(event) => {
                    const next = [...order, photo];
                    if (event.detail === 0) {
                      const available = puzzle.hand.find(
                        (item) => !next.some((placed) => placed.path === item.path),
                      );
                      requestedFocus.current = available
                        ? { path: available.path }
                        : { check: true };
                    }
                    setOrder(next);
                  }}
                >
                  <GamePhoto photo={photo} />
                  <span>
                    {position >= 0 ? `Placed ${position + 1}` : `Photograph ${index + 1}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Button ref={checkRef} variant="primary" disabled={order.length !== size} onClick={finish}>
          Check order
          <KeyHint aria-hidden="true">Enter</KeyHint>
        </Button>
        <Button
          onClick={(event) => {
            const previous = order.at(-1);
            if (event.detail === 0 && previous) requestedFocus.current = { path: previous.path };
            setOrder(order.slice(0, -1));
          }}
          disabled={!order.length}
        >
          Undo last
        </Button>
        <Button variant="quiet" onClick={backToSetup}>
          Change settings
        </Button>
      </div>
    </div>
  );
};
