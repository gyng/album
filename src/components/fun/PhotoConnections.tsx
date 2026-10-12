import { useEffect, useRef, useState } from "react";
import {
  buildConnectionsPuzzle,
  checkConnection,
  shuffleGamePhotos,
  type ConnectionsPuzzle,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { Button, Caption, Heading } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameProgress } from "./GameFeedback";
import styles from "./PhotoGames.module.css";

export const PhotoConnections = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [tiles, setTiles] = useState<PhotoGamePhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [message, setMessage] = useState("");
  const attempted = useRef(new Set<string>());
  const resultRef = useRef<HTMLDivElement>(null);
  const finished = gaveUp || mistakes >= 4 || found.length === 4;
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);
  const start = () => {
    const next = buildConnectionsPuzzle(photos);
    if (!next) {
      setMessage(
        "This archive doesn’t have enough photographs with four clear, distinct connections.",
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
          Find four groups of four photographs with a shared visual subject. Four mistakes end the
          round.
        </p>
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
        result.kind === "near" ? "One photograph away." : "That group doesn’t share a connection.",
      );
    }
  };
  const visibleGroups = finished
    ? puzzle.groups
    : puzzle.groups.filter((group) => found.includes(group.id));
  return (
    <div className={styles.game}>
      <div className={styles.roundProgress}>
        <p role="status">{message || `${found.length} of 4 connections found`}</p>
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
            <Heading level={1}>{found.length === 4 ? "All connected" : "The connections"}</Heading>
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
          <div className={styles.connectionChoices}>
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
                  disabled={selected.length === 4 && !selected.includes(photo.path)}
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
            <Button variant="primary" disabled={selected.length !== 4} onClick={submit}>
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
          <Caption>{selected.length} of 4 selected</Caption>
        </>
      ) : (
        <Button variant="primary" onClick={start}>
          Play again
        </Button>
      )}
    </div>
  );
};
