import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildConnectionsPuzzle,
  checkConnection,
  shuffleGamePhotos,
  type ConnectionsPuzzle,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { useUrlSearchParams } from "../platform";
import { Button, Caption, Heading, Icon, KeyHint } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameProgress } from "./GameFeedback";
import { GameDock } from "./GameDock";
import { useGameReadiness } from "./GameReadiness";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
  useShareOrigin,
} from "./GameRecord";
import { useGameSettings, type GameSettingsRegistry } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import { useGameShortcuts } from "./useGameShortcuts";
import shuffleStyles from "./PhotoConnections.module.css";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoGames.module.css";

type RoundSettings = GameSettingsRegistry["connections"];

/** Everyone's daily board is the same: four groups of four broad subjects, four lives. */
const DAILY_SETTINGS: RoundSettings = { size: 4, detail: "broad", hints: true, lives: 4 };

/** Today's board, identical on every device whatever order the archive arrived in. */
export const dailyConnectionsPuzzle = (photos: PhotoGamePhoto[], day?: string) =>
  buildConnectionsPuzzle(
    dailyPhotoOrder(photos),
    dailyPuzzle("connections", day).random(),
    DAILY_SETTINGS.size,
    DAILY_SETTINGS.detail,
  );

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Spoiler-free: how the round went, never which photographs or subjects.
const dailySummary = (
  outcome: "won" | "lost" | "gave-up",
  found: number,
  mistakes: number,
  size: number,
) =>
  outcome === "won"
    ? `${size}×${size} · ${mistakes ? plural(mistakes, "mistake") : "No mistakes"}`
    : `${outcome === "gave-up" ? "Gave up" : "Out of lives"} · ${found} of ${size} connections`;

export const PhotoConnections = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [settings, setSettings] = useGameSettings("connections");
  // The board in play keeps the settings it was dealt with; a daily's are fixed and never saved.
  const [round, setRound] = useState<RoundSettings>(settings);
  const [daily, setDaily] = useState<string | null>(null);
  const { hints, size, lives } = round;
  const { stats, record } = useGameStats("connections");
  const shareOrigin = useShareOrigin();
  const { loading } = useGameReadiness();
  const {
    ready: urlReady,
    searchParams,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const today = dailyPuzzle("connections");
  const todaysResult = stats?.dailies[today.day];
  const dailyRequested = useRef(false);
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [autoCheck, setAutoCheck] = useState(true);
  const [found, setFound] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [message, setMessage] = useState("");
  const attempted = useRef(new Set<string>());
  const resultRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const [dockHeight, setDockHeight] = useState(0);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const matchedRefs = useRef(new Map<string, HTMLLIElement>());
  const shufflePositions = useRef(new Map<string, DOMRect>());
  const animations = useRef<Animation[]>([]);
  const finished = gaveUp || (lives !== null && mistakes >= lives) || found.length === size;
  useLayoutEffect(() => {
    const previous = shufflePositions.current;
    shufflePositions.current = new Map();
    if (!previous.size || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const [path, before] of previous) {
      const tile = tileRefs.current.get(path) ?? matchedRefs.current.get(path);
      if (!tile || typeof tile.animate !== "function") continue;
      const after = tile.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      const scaleX = before.width / after.width;
      const scaleY = before.height / after.height;
      if (!x && !y && scaleX === 1 && scaleY === 1) continue;
      animations.current.push(
        tile.animate(
          [
            { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` },
            { transform: "translate(0, 0) scale(1)" },
          ],
          { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        ),
      );
    }
  }, [tiles, found, finished]);
  useEffect(() => () => animations.current.forEach((animation) => animation.cancel()), []);
  const capturePositions = () => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    shufflePositions.current = new Map(
      Array.from([...tileRefs.current, ...matchedRefs.current], ([path, tile]) => [
        path,
        tile.getBoundingClientRect(),
      ]),
    );
  };
  const shuffle = () => {
    capturePositions();
    setTiles(shuffleGamePhotos(tiles));
  };
  const deselect = () => {
    setSelected([]);
    setMessage("");
  };
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  // A solved group's tiles leave the board, taking focus with them.
  useEffect(() => {
    const latest = found.at(-1);
    if (latest && !finished) groupRefs.current.get(latest)?.focus({ preventScroll: true });
  }, [found, finished]);
  useEffect(() => {
    if (puzzle) boardRef.current?.focus();
  }, [puzzle]);
  const setDailyUrl = (on: boolean) => {
    if (hasSearchParam("daily") === on) return;
    const params = new URLSearchParams(searchParams);
    if (on) params.set("daily", "");
    else params.delete("daily");
    replaceSearchParams(params);
  };
  const deal = (
    next: ConnectionsPuzzle | null,
    roundSettings: RoundSettings,
    day: string | null,
  ) => {
    if (!next) {
      setMessage(
        `There are not enough photographs for ${roundSettings.size} distinct groups. Try a smaller board.`,
      );
      return;
    }
    setRound(roundSettings);
    setDaily(day);
    setDailyUrl(day !== null);
    setPuzzle(next);
    setTiles(next.tiles);
    setSelected([]);
    setFound([]);
    setMistakes(0);
    setGaveUp(false);
    setMessage("");
    attempted.current.clear();
  };
  const start = () =>
    deal(
      buildConnectionsPuzzle(photos, Math.random, settings.size, settings.detail),
      settings,
      null,
    );
  const startDaily = () => {
    if (todaysResult) return;
    deal(dailyConnectionsPuzzle(photos, today.day), DAILY_SETTINGS, today.day);
  };
  // `?daily` opens today's board, or its result once it has been played.
  useEffect(() => {
    if (dailyRequested.current || !urlReady || loading || !stats || !photos.length) return;
    dailyRequested.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- a linked daily opens once the URL and stored record are readable after hydration; dealing writes the URL and refs, so it cannot run in render
    if (hasSearchParam("daily") && !stats.dailies[today.day]) startDaily();
  });
  // Recorded where the round ends, so a re-render can never count it twice.
  const finish = (outcome: "won" | "lost" | "gave-up", foundCount: number, mistakeCount: number) =>
    record({
      won: outcome === "won",
      ...(daily
        ? { daily: { day: daily, summary: dailySummary(outcome, foundCount, mistakeCount, size) } }
        : {}),
    });
  const giveUp = () => {
    if (!puzzle || finished) return;
    setGaveUp(true);
    finish("gave-up", found.length, mistakes);
  };
  const shake = (paths: string[]) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const path of paths) {
      const tile = tileRefs.current.get(path);
      if (typeof tile?.animate !== "function") continue;
      animations.current.push(
        tile.animate(
          [0, -8, 7, -5, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
          { duration: 360, easing: "ease-in-out" },
        ),
      );
    }
  };
  const submit = (selection = selected) => {
    if (!puzzle || finished || selection.length !== size) return;
    const key = [...selection].sort().join("\n");
    if (attempted.current.has(key)) {
      shake(selection);
      setMessage("You’ve already tried that group.");
      return;
    }
    const result = checkConnection(puzzle, selection);
    if (result.kind === "match") {
      capturePositions();
      setFound([...found, result.group.id]);
      setSelected([]);
      setMessage(`${result.group.label} — connection found.`);
      if (found.length + 1 === size) finish("won", size, mistakes);
    } else {
      shake(selection);
      attempted.current.add(key);
      setMistakes(mistakes + 1);
      if (lives !== null && mistakes + 1 >= lives) finish("lost", found.length, mistakes + 1);
      setMessage(
        result.kind === "near" && hints
          ? "One photograph away."
          : "That group doesn’t share a connection.",
      );
    }
  };
  const shortcuts = [
    {
      key: "Enter",
      label: "Check connection",
      action: () => submit(),
      enabled: !!puzzle && !finished && selected.length === size,
    },
    {
      key: "Escape",
      label: "Deselect",
      action: deselect,
      enabled: !!puzzle && !finished && !!selected.length,
    },
    { key: "s", label: "Shuffle", action: shuffle, enabled: !!puzzle && !finished },
    { key: "g", label: "Give up", action: giveUp, enabled: !!puzzle && !finished },
    { key: "n", label: "New game", action: start, enabled: !puzzle || finished },
  ];
  useGameShortcuts(shortcuts);
  if (!puzzle)
    return (
      <GameIntro game="connections">
        <p>
          Make {settings.size} groups of {settings.size} photographs. Each group must share a
          subject.
        </p>
        <div className={styles.actions} role="group" aria-label="Board size">
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
              {value}×{value}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Lives">
          {([null, 4, 6, 8] as const).map((value) => (
            <Button
              key={value ?? "unlimited"}
              active={settings.lives === value}
              aria-pressed={settings.lives === value}
              onClick={() => setSettings((previous) => ({ ...previous, lives: value }))}
            >
              {value === null ? "Unlimited" : `${value} lives`}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Connection difficulty">
          <Button
            active={settings.detail === "broad"}
            aria-pressed={settings.detail === "broad"}
            onClick={() => setSettings((previous) => ({ ...previous, detail: "broad" }))}
          >
            Broad subjects
          </Button>
          <Button
            active={settings.detail === "specific"}
            aria-pressed={settings.detail === "specific"}
            onClick={() => setSettings((previous) => ({ ...previous, detail: "specific" }))}
          >
            Specific subjects
          </Button>
          <Button
            active={settings.hints}
            aria-pressed={settings.hints}
            aria-label={`One-away hints ${settings.hints ? "on" : "off"}`}
            onClick={() => setSettings((previous) => ({ ...previous, hints: !previous.hints }))}
          >
            One-away hints
          </Button>
        </div>
        <Caption>Specific subjects use finer connections, such as lanterns or bicycles.</Caption>
        {message ? <p role="alert">{message}</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" onClick={start}>
            Start connecting
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          {stats && !todaysResult ? (
            <>
              <Button onClick={startDaily}>Daily #{today.number}</Button>
              <Caption>4×4 · 4 lives</Caption>
            </>
          ) : null}
        </div>
        {todaysResult ? (
          <div className={styles.actions}>
            <Caption>
              Daily #{today.number} · {todaysResult.summary}
            </Caption>
            <ShareResult
              text={dailyShareText("connections", today.day, todaysResult.summary, shareOrigin)}
            />
          </div>
        ) : null}
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  const visibleGroups = finished
    ? puzzle.groups
    : puzzle.groups.filter((group) => found.includes(group.id));
  return (
    <div
      className={styles.game}
      style={{ "--connections-dock-height": `${dockHeight}px` } as React.CSSProperties}
    >
      <div className={styles.roundProgress}>
        <p role="status">{message || `${found.length} of ${size} connections found`}</p>
        <div className={styles.actions}>
          <Caption>
            {lives === null
              ? `${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"} · Unlimited lives`
              : `${Math.max(0, lives - mistakes)} mistakes remaining`}
          </Caption>
          {lives !== null ? (
            <GameProgress current={Math.max(0, lives - mistakes)} total={lives} />
          ) : null}
        </div>
      </div>
      {!finished ? (
        <GameDock
          label="Connection controls"
          onStickyHeightChange={setDockHeight}
          {...(styles.connectionControls ? { className: styles.connectionControls } : {})}
        >
          <Caption>
            {selected.length} / {size} selected
          </Caption>
          <Button
            aria-label="Check connection"
            variant="primary"
            disabled={selected.length !== size}
            onClick={() => submit()}
          >
            Check
            <KeyHint aria-hidden="true">Enter</KeyHint>
          </Button>
          <Button
            aria-label="Auto check"
            aria-pressed={autoCheck}
            active={autoCheck}
            onClick={() => {
              setAutoCheck(!autoCheck);
              if (!autoCheck) submit();
            }}
          >
            Auto check
          </Button>
          <Button
            aria-label="Deselect"
            title="Deselect"
            disabled={!selected.length}
            onClick={deselect}
          >
            <Icon kind="close" />
            <KeyHint aria-hidden="true">Esc</KeyHint>
          </Button>
          <Button aria-label="Shuffle" title="Shuffle" onClick={shuffle}>
            <Icon kind="shuffle" />
            <KeyHint aria-hidden="true">S</KeyHint>
          </Button>
        </GameDock>
      ) : null}
      {visibleGroups.length ? (
        <div
          className={styles.result}
          ref={resultRef}
          {...(finished
            ? { role: "region", "aria-label": "Connections result", tabIndex: -1 }
            : {})}
        >
          {finished ? (
            <Heading level={1}>
              {found.length === size ? "All connected" : "The connections"}
            </Heading>
          ) : null}
          {finished && daily && stats?.dailies[daily] ? (
            <ShareResult
              text={dailyShareText("connections", daily, stats.dailies[daily].summary, shareOrigin)}
            />
          ) : null}
          {finished ? <ResultNextSteps photos={puzzle.tiles} /> : null}
          {visibleGroups.map((group) => (
            <section
              key={group.id}
              ref={(element) => {
                if (element) groupRefs.current.set(group.id, element);
                else groupRefs.current.delete(group.id);
              }}
              tabIndex={-1}
              aria-label={group.label}
              className={styles.connectionGroup}
            >
              <Heading level={2}>{group.label}</Heading>
              <ol
                aria-label="Connected photographs"
                className={[styles.chain, shuffleStyles.matchedRow].join(" ")}
                style={{ "--connection-columns": size } as React.CSSProperties}
              >
                {group.photos.map((photo) => (
                  <li
                    key={photo.path}
                    className={shuffleStyles.matchedPhoto}
                    ref={(element) => {
                      if (element) matchedRefs.current.set(photo.path, element);
                      else matchedRefs.current.delete(photo.path);
                    }}
                  >
                    <GamePhoto photo={photo} link={finished} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
      {!finished ? (
        <>
          <div
            ref={boardRef}
            tabIndex={-1}
            role="group"
            aria-label="Photographs"
            className={[styles.connectionChoices, shuffleStyles.board].join(" ")}
            style={{ "--connection-columns": size } as React.CSSProperties}
          >
            {tiles
              .filter(
                (photo) =>
                  !puzzle.groups.some(
                    (group) =>
                      found.includes(group.id) &&
                      group.photos.some((item) => item.path === photo.path),
                  ),
              )
              .map((photo) => (
                <button
                  key={photo.path}
                  type="button"
                  className={[styles.choice, shuffleStyles.tile].join(" ")}
                  ref={(tile) => {
                    if (tile) tileRefs.current.set(photo.path, tile);
                    else tileRefs.current.delete(photo.path);
                  }}
                  aria-pressed={selected.includes(photo.path)}
                  disabled={selected.length === size && !selected.includes(photo.path)}
                  onClick={() => {
                    const next = selected.includes(photo.path)
                      ? selected.filter((path) => path !== photo.path)
                      : [...selected, photo.path];
                    setSelected(next);
                    setMessage("");
                    if (autoCheck && next.length === size) submit(next);
                  }}
                >
                  <GamePhoto photo={photo} />
                  {selected.includes(photo.path) ? (
                    <span className={styles.selectionMark} aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
          {selected.length ? (
            <section className={styles.selectionPreview} aria-label="Selected photographs">
              <Caption>Selected shots</Caption>
              <PhotoChain
                photos={selected.map((path) => tiles.find((photo) => photo.path === path)!)}
                linked={false}
                numbered={false}
              />
            </section>
          ) : null}
          <div className={styles.actions}>
            <Button variant="quiet" onClick={giveUp}>
              Give up
              <KeyHint aria-hidden="true">G</KeyHint>
            </Button>
          </div>
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
              setDaily(null);
              setDailyUrl(false);
              setMessage("");
            }}
          >
            Change board size
          </Button>
        </div>
      )}
    </div>
  );
};
