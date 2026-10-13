import { useEffect, useRef, useState } from "react";
import { Button, Caption, LoadingIndicator, KeyHint } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameDock } from "./GameDock";
import { PhotoChain } from "./GamePhoto";
import { GameProgress } from "./GameFeedback";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import {
  HANGMAN_MISSES,
  HANGMAN_INITIAL_CLUES,
  addHangmanSubjectGuess,
  buildPhotoHangman,
  hangmanSubjectStatus,
  wrongHangmanSubjects,
  type PhotoHangmanPuzzle,
} from "../../util/photoHangman";
import type { PhotoGamePhoto } from "../../util/photoGames";
import styles from "./PhotoHangman.module.css";
import { useGameShortcuts } from "./useGameShortcuts";

const subjectLabel = (subject: string) => subject[0]! + subject.slice(1).toLowerCase();

export const PhotoHangman = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<PhotoHangmanPuzzle | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [viewed, setViewed] = useState<{ misses: number; index: number } | null>(null);
  const [readyPaths, setReadyPaths] = useState<string[]>([]);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [dockHeight, setDockHeight] = useState(0);
  const [error, setError] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const status = puzzle ? hangmanSubjectStatus(puzzle, guesses) : "playing";
  const misses = puzzle ? wrongHangmanSubjects(puzzle, guesses).length : 0;
  const finished = status !== "playing";
  const [gaveUp, setGaveUp] = useState(false);
  const ended = finished || gaveUp;
  useEffect(() => {
    if (!ended) return;
    const frame = requestAnimationFrame(() => resultRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ended]);
  const start = () => {
    const next = buildPhotoHangman(photos, Math.random, puzzle?.answer);
    if (!next) {
      setError("This archive needs at least eight photographs of each of two subjects.");
      return;
    }
    setPuzzle(next);
    setGuesses([]);
    setQuery("");
    setViewed(null);
    setReadyPaths([]);
    setFailedPath(null);
    setImageAttempt(0);
    setGaveUp(false);
    setError("");
  };
  const shortcuts = [
    {
      key: "N",
      label: puzzle ? "Play again" : "Start guessing",
      action: start,
      enabled: !puzzle || ended,
    },
    {
      key: "/",
      label: "Filter subjects",
      action: () => searchRef.current?.focus(),
      enabled: Boolean(puzzle && !ended),
    },
    {
      key: "G",
      label: "Give up",
      action: () => setGaveUp(true),
      enabled: Boolean(puzzle && !ended),
    },
  ];
  useGameShortcuts(shortcuts);
  if (!puzzle)
    return (
      <GameIntro game="photo-hangman">
        <p>
          Guess the subject that connects the photographs. You start with two clues. Each wrong
          guess reveals another. Six misses end the round.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <Button variant="primary" onClick={start}>
          Start guessing
          <KeyHint aria-hidden="true">N</KeyHint>
        </Button>
      </GameIntro>
    );
  const revealed = Math.min(misses + HANGMAN_INITIAL_CLUES, puzzle.photos.length);
  const clueIndex = viewed?.misses === misses ? viewed.index : revealed - 1;
  const clueIndices = !ended && misses === 0 && viewed === null ? [0, 1] : [clueIndex];
  const ready = [...new Set([...clueIndices, 0, 1])].every((index) =>
    readyPaths.includes(puzzle.photos[index]!.path),
  );
  const answer =
    status === "won"
      ? guesses.find((guess) => puzzle.acceptedAnswers.includes(guess))!
      : puzzle.answer;
  const choices = puzzle.subjects.filter((subject) =>
    subject.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const last = guesses.at(-1);
  const feedback = ended
    ? status === "won"
      ? "You found the shared subject."
      : "The shared subject is revealed below."
    : last
      ? `${subjectLabel(last)} doesn’t connect the full set. Another photograph revealed.`
      : "Find the subject shared by the photographs.";
  return (
    <div
      className={styles.game}
      style={{ "--hangman-dock-height": `${dockHeight}px` } as React.CSSProperties}
    >
      <div className={styles.play}>
        <GameDock
          label="Photographic clues"
          active={!ended}
          onStickyHeightChange={setDockHeight}
          {...(styles.clues ? { className: styles.clues } : {})}
        >
          <div className={styles.progress}>
            <Caption>
              {revealed} / {puzzle.photos.length} {ended ? "clues used" : "photographs"}
            </Caption>
            {!ended ? (
              <>
                <Caption>{HANGMAN_MISSES - misses} misses left</Caption>
                <GameProgress current={HANGMAN_MISSES - misses} total={HANGMAN_MISSES} />
              </>
            ) : null}
          </div>
          <figure className={styles.frame} aria-label="Current photographic clue">
            <div className={clueIndices.length === 2 ? styles.initialPair : styles.singleClue}>
              {clueIndices.map((index) => {
                const photo = puzzle.photos[index]!;
                return (
                  <div key={photo.path} className={styles.frame}>
                    <img
                      key={`${photo.path}:${imageAttempt}`}
                      src={
                        getResizedAlbumImageSrc(photo.path) +
                        (imageAttempt ? `?retry=${imageAttempt}` : "")
                      }
                      className={styles.photo}
                      alt={
                        ended
                          ? photo.caption || subjectLabel(answer)
                          : `Photographic clue ${index + 1}`
                      }
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        const complete = () => {
                          if (image.isConnected) {
                            setReadyPaths((previous) => [...previous, photo.path]);
                            setFailedPath((previous) =>
                              previous === photo.path ? null : previous,
                            );
                          }
                        };
                        const fail = () => {
                          if (image.isConnected) {
                            setFailedPath(photo.path);
                            setReadyPaths((previous) =>
                              previous.filter((path) => path !== photo.path),
                            );
                          }
                        };
                        if (typeof image.decode === "function")
                          void image.decode().then(complete, fail);
                        else complete();
                      }}
                      onError={() => {
                        setFailedPath(photo.path);
                        setReadyPaths((previous) => previous.filter((path) => path !== photo.path));
                      }}
                    />
                    {!readyPaths.includes(photo.path) && failedPath !== photo.path ? (
                      <div className={styles.loading}>
                        <LoadingIndicator label="Loading photograph…" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </figure>
          {clueIndices.some((index) => failedPath === puzzle.photos[index]!.path) ? (
            <div role="alert">
              <p>The photograph could not be loaded.</p>
              <Button
                onClick={() => {
                  setFailedPath(null);
                  setImageAttempt((attempt) => attempt + 1);
                }}
              >
                Retry photograph
              </Button>
            </div>
          ) : null}
          {revealed > 1 ? (
            <div className={styles.history} role="group" aria-label="Revealed photographs">
              {puzzle.photos.slice(0, revealed).map((clue, index) => (
                <button
                  key={clue.path}
                  type="button"
                  className={styles.thumbnail}
                  aria-label={`View clue ${index + 1}`}
                  aria-pressed={clueIndex === index}
                  onClick={() => {
                    setViewed({ misses, index });
                    setImageAttempt(0);
                  }}
                >
                  <img src={getResizedAlbumImageSrc(clue.path)} alt="" />
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          ) : null}
        </GameDock>
        <div className={styles.guessing}>
          <div role="status" className={styles.feedback}>
            {feedback}
          </div>
          {!ended ? (
            <>
              <h2>Choose a subject</h2>
              <label className={styles.filter}>
                Filter subjects
                <input
                  className={styles.search}
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div
                className={styles.subjects}
                role="group"
                aria-label="Subject choices"
                aria-busy={!ready}
              >
                {choices.map((subject) => (
                  <Button
                    key={subject}
                    aria-label={`Guess ${subject.toLowerCase()}`}
                    {...(styles.subject ? { className: styles.subject } : {})}
                    data-used={guesses.includes(subject)}
                    disabled={!ready || guesses.includes(subject)}
                    onClick={() => {
                      if (!ready) return;
                      searchRef.current?.blur();
                      setGuesses((previous) => addHangmanSubjectGuess(puzzle, previous, subject));
                      setQuery("");
                    }}
                  >
                    {subjectLabel(subject)}
                    {guesses.includes(subject) ? <span aria-hidden="true"> ×</span> : null}
                  </Button>
                ))}
              </div>
              {!choices.length ? <p>No matching subjects.</p> : null}
              <Button
                onClick={() => {
                  searchRef.current?.blur();
                  setGaveUp(true);
                }}
              >
                Give up
                <KeyHint aria-hidden="true">G</KeyHint>
              </Button>
            </>
          ) : (
            <section
              ref={resultRef}
              tabIndex={-1}
              aria-label="Photo Hangman result"
              className={styles.result}
            >
              <h2>{subjectLabel(answer)}</h2>
              <p>
                {status === "won"
                  ? `Solved using ${revealed} ${revealed === 1 ? "photograph" : "photographs"}.`
                  : `${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"} · ${misses} ${misses === 1 ? "miss" : "misses"}.`}
              </p>
              <PhotoChain photos={puzzle.photos} numbered={false} />
              <Button onClick={start}>
                Play again<KeyHint aria-hidden="true">N</KeyHint>
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
