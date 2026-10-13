import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildConnectionsPuzzle,
  checkConnection,
  shuffleGamePhotos,
  type ConnectionsPuzzle,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { Button, Caption, Heading, Icon } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameProgress } from "./GameFeedback";
import { GameDock } from "./GameDock";
import { useGameSettings } from "./useGameSettings";
import { GameShortcutHelp, useGameShortcuts } from "./useGameShortcuts";
import shuffleStyles from "./PhotoConnections.module.css";
import styles from "./PhotoGames.module.css";

export const PhotoConnections = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [settings, setSettings] = useGameSettings("connections");
  const { detail, hints, size, lives } = settings;
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [message, setMessage] = useState("");
  const attempted = useRef(new Set<string>());
  const resultRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const shufflePositions = useRef(new Map<string, DOMRect>());
  const animations = useRef<Animation[]>([]);
  const finished = gaveUp || (lives !== null && mistakes >= lives) || found.length === size;
  useLayoutEffect(() => {
    const previous = shufflePositions.current;
    shufflePositions.current = new Map();
    if (!previous.size || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const [path, before] of previous) {
      const tile = tileRefs.current.get(path);
      if (!tile || typeof tile.animate !== "function") continue;
      const after = tile.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (!x && !y) continue;
      animations.current.push(
        tile.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }],
          { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        ),
      );
    }
  }, [tiles]);
  useEffect(() => () => animations.current.forEach((animation) => animation.cancel()), []);
  const shuffle = () => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    shufflePositions.current = new Map(
      Array.from(tileRefs.current, ([path, tile]) => [path, tile.getBoundingClientRect()]),
    );
    setTiles(shuffleGamePhotos(tiles));
  };
  const deselect = () => {
    setSelected([]);
    setMessage("");
  };
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  const start = () => {
    const next = buildConnectionsPuzzle(photos, Math.random, size, detail);
    if (!next) {
      setMessage(
        `There are not enough photographs for ${size} distinct groups. Try a smaller board.`,
      );
      return;
    }
    setPuzzle(next);
    setTiles(next.tiles);
    setSelected([]);
    setFound([]);
    setMistakes(0);
    setGaveUp(false);
    setMessage("");
    attempted.current.clear();
  };
  const submit = () => {
    if (!puzzle || finished || selected.length !== size) return;
    const key = [...selected].sort().join("\n");
    if (attempted.current.has(key)) {
      setMessage("You’ve already tried that group.");
      return;
    }
    const result = checkConnection(puzzle, selected);
    if (result.kind === "match") {
      setFound([...found, result.group.id]);
      setSelected([]);
      setMessage(`${result.group.label} — connection found.`);
    } else {
      attempted.current.add(key);
      setMistakes(mistakes + 1);
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
      action: submit,
      enabled: !!puzzle && !finished && selected.length === size,
    },
    {
      key: "Escape",
      label: "Deselect",
      action: deselect,
      enabled: !!puzzle && !finished && !!selected.length,
    },
    { key: "s", label: "Shuffle", action: shuffle, enabled: !!puzzle && !finished },
    { key: "g", label: "Give up", action: () => setGaveUp(true), enabled: !!puzzle && !finished },
    { key: "n", label: "New game", action: start, enabled: !puzzle || finished },
  ];
  useGameShortcuts(shortcuts);
  if (!puzzle)
    return (
      <GameIntro game="connections">
        <p>
          Make {size} groups of {size} photographs. Each group must share a subject.
        </p>
        <div className={styles.actions} role="group" aria-label="Board size">
          {([4, 5, 6] as const).map((value) => (
            <Button
              key={value}
              active={size === value}
              aria-pressed={size === value}
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
              active={lives === value}
              aria-pressed={lives === value}
              onClick={() => setSettings((previous) => ({ ...previous, lives: value }))}
            >
              {value === null ? "Unlimited" : `${value} lives`}
            </Button>
          ))}
        </div>
        <div className={styles.actions} role="group" aria-label="Connection difficulty">
          <Button
            active={detail === "broad"}
            aria-pressed={detail === "broad"}
            onClick={() => setSettings((previous) => ({ ...previous, detail: "broad" }))}
          >
            Broad subjects
          </Button>
          <Button
            active={detail === "specific"}
            aria-pressed={detail === "specific"}
            onClick={() => setSettings((previous) => ({ ...previous, detail: "specific" }))}
          >
            Specific subjects
          </Button>
          <Button
            active={hints}
            aria-pressed={hints}
            aria-label={`One-away hints ${hints ? "on" : "off"}`}
            onClick={() => setSettings((previous) => ({ ...previous, hints: !previous.hints }))}
          >
            One-away hints
          </Button>
        </div>
        <Caption>Specific subjects use finer connections, such as lanterns or bicycles.</Caption>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start connecting
        </Button>
        <GameShortcutHelp shortcuts={shortcuts} />
      </GameIntro>
    );
  const visibleGroups = finished
    ? puzzle.groups
    : puzzle.groups.filter((group) => found.includes(group.id));
  return (
    <div className={styles.game}>
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
          {...(styles.connectionControls ? { className: styles.connectionControls } : {})}
        >
          <Caption>
            {selected.length} / {size} selected
          </Caption>
          <Button
            aria-label="Check connection"
            variant="primary"
            disabled={selected.length !== size}
            onClick={submit}
          >
            Check
          </Button>
          <Button
            size="icon"
            aria-label="Deselect"
            title="Deselect"
            disabled={!selected.length}
            onClick={deselect}
          >
            <Icon kind="close" />
          </Button>
          <Button size="icon" aria-label="Shuffle" title="Shuffle" onClick={shuffle}>
            <Icon kind="shuffle" />
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
          {visibleGroups.map((group) => (
            <section key={group.id} className={styles.connectionGroup}>
              <Heading level={2}>{group.label}</Heading>
              <PhotoChain photos={group.photos} linked={finished} numbered={false} />
            </section>
          ))}
        </div>
      ) : null}
      {!finished ? (
        <>
          <div
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
              .map((photo, index) => (
                <button
                  key={photo.path}
                  type="button"
                  className={[styles.choice, shuffleStyles.tile].join(" ")}
                  ref={(tile) => {
                    if (tile) tileRefs.current.set(photo.path, tile);
                    else tileRefs.current.delete(photo.path);
                  }}
                  aria-label={`Select photograph ${index + 1}`}
                  aria-pressed={selected.includes(photo.path)}
                  disabled={selected.length === size && !selected.includes(photo.path)}
                  onClick={() => {
                    setSelected(
                      selected.includes(photo.path)
                        ? selected.filter((path) => path !== photo.path)
                        : [...selected, photo.path],
                    );
                    setMessage("");
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
            <Button variant="quiet" onClick={() => setGaveUp(true)}>
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
              setMessage("");
            }}
          >
            Change board size
          </Button>
        </div>
      )}
      <GameShortcutHelp shortcuts={shortcuts} />
    </div>
  );
};
