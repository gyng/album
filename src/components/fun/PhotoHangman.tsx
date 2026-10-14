import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useUrlSearchParams } from "../platform";
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
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoHangman.module.css";
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

const subjectLabel = (subject: string) => subject[0]! + subject.slice(1).toLowerCase();

/**
 * Today's puzzle under the usual rules. It never avoids the previous answer, as an ordinary
 * round does: that would make the daily depend on what this player happened to play before.
 */
export const buildDailyPhotoHangman = (photos: PhotoGamePhoto[], day: string = localDayKey()) =>
  buildPhotoHangman(dailyPhotoOrder(photos), dailyPuzzle("photo-hangman", day).random());

const missCount = (misses: number) => `${misses} ${misses === 1 ? "miss" : "misses"}`;

/** Spoiler-free: whether it was solved and at what cost, never the subject. */
const dailySummary = (won: boolean, misses: number) =>
  `${won ? "Solved" : "Not solved"} · ${missCount(misses)}`;

export const PhotoHangman = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<PhotoHangmanPuzzle | null>(null);
  // The day of the daily being played; null for an ordinary round.
  const [daily, setDaily] = useState<string | null>(null);
  const { ready: urlReady, hasSearchParam } = useUrlSearchParams();
  const { stats, record } = useGameStats("photo-hangman");
  const shareOrigin = useShareOrigin();
  const dailyDescriptionId = useId();
  const [guesses, setGuesses] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [viewed, setViewed] = useState<{ misses: number; index: number } | null>(null);
  const [readyPaths, setReadyPaths] = useState<string[]>([]);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [round, setRound] = useState(0);
  // The subject just guessed, waiting for the next clue before focus moves on from it.
  const refocusAfter = useRef<string | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [error, setError] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const subjectsRef = useRef<HTMLDivElement>(null);
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
  const begin = (next: PhotoHangmanPuzzle | null, day: string | null) => {
    if (!next) {
      setError("This archive needs at least eight photographs of each of two subjects.");
      return;
    }
    setPuzzle(next);
    setDaily(day);
    setGuesses([]);
    setQuery("");
    setViewed(null);
    setReadyPaths([]);
    setFailedPath(null);
    setImageAttempt(0);
    setRound((previous) => previous + 1);
    refocusAfter.current = null;
    setGaveUp(false);
    setError("");
  };
  const start = () => begin(buildPhotoHangman(photos, Math.random, puzzle?.answer), null);
  const startDaily = () => {
    const day = localDayKey();
    begin(buildDailyPhotoHangman(photos, day), day);
  };
  const today = localDayKey();
  const todaysDaily = stats?.dailies[today];
  // A linked daily starts once the archive and the player's record are both known.
  const linkedDaily = useRef(false);
  const startLinkedDaily = useEffectEvent(startDaily);
  useEffect(() => {
    if (linkedDaily.current || !urlReady || !stats || !photos.length) return;
    linkedDaily.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- a linked daily opens once the URL and stored record are readable after hydration; dealing writes refs, so it cannot run in render
    if (hasSearchParam("daily") && !stats.dailies[localDayKey()]) startLinkedDaily();
  }, [urlReady, hasSearchParam, stats, photos.length]);
  // Score: misses to spare on a solved round, so higher is better; an unsolved round has none.
  const finish = (won: boolean, finalMisses: number) =>
    record({
      won,
      ...(won ? { score: HANGMAN_MISSES - finalMisses } : {}),
      ...(daily ? { daily: { day: daily, summary: dailySummary(won, finalMisses) } } : {}),
    });
  const giveUp = () => {
    if (!puzzle || ended) return;
    searchRef.current?.blur();
    finish(false, misses);
    setGaveUp(true);
  };
  const revealed = puzzle ? Math.min(misses + HANGMAN_INITIAL_CLUES, puzzle.photos.length) : 0;
  const clueIndex = viewed?.misses === misses ? viewed.index : revealed - 1;
  const clueIndices = !ended && misses === 0 && viewed === null ? [0, 1] : [clueIndex];
  const ready =
    !!puzzle &&
    [...new Set([...clueIndices, 0, 1])].every((index) =>
      readyPaths.includes(puzzle.photos[index]!.path),
    );
  // A wrong guess disables its own button and, while the next clue loads, every
  // other one, so focus would otherwise fall to the document.
  useEffect(() => {
    const subject = refocusAfter.current;
    if (!subject || !puzzle || (!ended && !ready)) return;
    refocusAfter.current = null;
    if (ended) return;
    const buttons = [...(subjectsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const after = puzzle.subjects.indexOf(subject);
    const open = buttons.filter((button) => !button.disabled);
    const next =
      open.find((button) => puzzle.subjects.indexOf(button.dataset.subject ?? "") > after) ??
      open[0];
    next?.focus();
    // Every guess replaces `guesses`, so this runs after each one as well as when its clue is ready.
  }, [guesses, puzzle, ready, ended]);
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
      action: giveUp,
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
        <div className={styles.lobbyActions}>
          <Button variant="primary" onClick={start}>
            Start guessing
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          {todaysDaily ? null : (
            <>
              <Button onClick={startDaily} aria-describedby={dailyDescriptionId}>
                Daily #{dailyNumber(today)}
              </Button>
              <Caption id={dailyDescriptionId} as="span">
                The same photographs for everyone today
              </Caption>
            </>
          )}
        </div>
        {todaysDaily ? (
          <div className={styles.lobbyActions}>
            <p className={styles.dailyResult}>
              Daily #{dailyNumber(today)} · {todaysDaily.summary}
            </p>
            <ShareResult
              text={dailyShareText("photo-hangman", today, todaysDaily.summary, shareOrigin)}
            />
          </div>
        ) : null}
        <GameStatsLine stats={stats} formatBest={(score) => missCount(HANGMAN_MISSES - score)} />
      </GameIntro>
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
                      key={`${round}:${photo.path}:${imageAttempt}`}
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
                ref={subjectsRef}
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
                    data-subject={subject}
                    data-used={guesses.includes(subject)}
                    disabled={!ready || guesses.includes(subject)}
                    onClick={() => {
                      if (!ready) return;
                      searchRef.current?.blur();
                      refocusAfter.current = subject;
                      const next = addHangmanSubjectGuess(puzzle, guesses, subject);
                      setGuesses(next);
                      setQuery("");
                      const outcome = hangmanSubjectStatus(puzzle, next);
                      if (next !== guesses && outcome !== "playing")
                        finish(outcome === "won", wrongHangmanSubjects(puzzle, next).length);
                    }}
                  >
                    {subjectLabel(subject)}
                    {guesses.includes(subject) ? <span aria-hidden="true"> ×</span> : null}
                  </Button>
                ))}
              </div>
              {!choices.length ? <p>No matching subjects.</p> : null}
              <Button onClick={giveUp}>
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
              {daily ? (
                <ShareResult
                  text={dailyShareText(
                    "photo-hangman",
                    daily,
                    dailySummary(status === "won", misses),
                    shareOrigin,
                  )}
                />
              ) : null}
              <PhotoChain photos={puzzle.photos} numbered={false} />
              <ResultNextSteps photos={puzzle.photos} />
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
