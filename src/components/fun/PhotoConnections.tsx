import { useEffect, useRef, useState } from "react";
import {
  buildConnectionsPuzzle,
  checkConnection,
  shuffleGamePhotos,
  type ConnectionsPuzzle,
  type ConnectionSize,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { Button, Caption, Heading } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameProgress } from "./GameFeedback";
import styles from "./PhotoGames.module.css";

export const PhotoConnections = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [detail, setDetail] = useState<"broad" | "specific">("broad");
  const [hints, setHints] = useState(true);
  const [size, setSize] = useState<ConnectionSize>(4);
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [message, setMessage] = useState("");
  const attempted = useRef(new Set<string>());
  const resultRef = useRef<HTMLDivElement>(null);
  const finished = gaveUp || mistakes >= 4 || found.length === size;
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  const start = () => {
    const next = buildConnectionsPuzzle(photos, Math.random, size, detail);
    if (!next) {
      setMessage(
        `This archive doesn’t have enough photographs with ${size} clear, distinct connections. Try a smaller board.`,
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
  if (!puzzle)
    return (
      <GameIntro game="connections">
        <p>
          Find {size} groups of {size} photographs with a shared visual subject. Four mistakes end
          the round.
        </p>
        <div className={styles.actions} role="group" aria-label="Board size">
          {([4, 5, 6] as const).map((value) => (
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
        <div className={styles.actions} role="group" aria-label="Connection difficulty">
          <Button
            active={detail === "broad"}
            aria-pressed={detail === "broad"}
            onClick={() => setDetail("broad")}
          >
            Broad subjects
          </Button>
          <Button
            active={detail === "specific"}
            aria-pressed={detail === "specific"}
            onClick={() => setDetail("specific")}
          >
            Specific subjects
          </Button>
          <Button active={hints} aria-pressed={hints} onClick={() => setHints(!hints)}>
            One-away hints {hints ? "on" : "off"}
          </Button>
        </div>
        <Caption>Specific subjects use finer connections, such as lanterns or bicycles.</Caption>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start connecting
        </Button>
      </GameIntro>
    );
  const submit = () => {
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
  const visibleGroups = finished
    ? puzzle.groups
    : puzzle.groups.filter((group) => found.includes(group.id));
  return (
    <div className={styles.game}>
      <div className={styles.roundProgress}>
        <p role="status">{message || `${found.length} of ${size} connections found`}</p>
        <div className={styles.actions}>
          <Caption>{4 - mistakes} mistakes remaining</Caption>
          <GameProgress current={4 - mistakes} total={4} />
        </div>
      </div>
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
            className={styles.connectionChoices}
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
                  className={styles.choice}
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
            <Button variant="primary" disabled={selected.length !== size} onClick={submit}>
              Check connection
            </Button>
            <Button disabled={!selected.length} onClick={() => setSelected([])}>
              Deselect
            </Button>
            <Button onClick={() => setTiles(shuffleGamePhotos(tiles))}>Shuffle</Button>
            <Button variant="quiet" onClick={() => setGaveUp(true)}>
              Give up
            </Button>
          </div>
          <Caption>
            {selected.length} of {size} selected
          </Caption>
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
    </div>
  );
};
