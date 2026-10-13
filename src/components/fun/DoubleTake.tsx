import { useEffect, useRef, useState } from "react";
import { buildDoubleTakeDeck, doubleTakePoints, type DoubleTakePair } from "../../util/doubleTake";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { exifDayKey } from "../../util/exifTime";
import { Button, Caption, Heading, Icon } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameProgress, GameScore } from "./GameFeedback";
import { GamePhoto } from "./GamePhoto";
import { GameShortcutHelp, useGameShortcuts } from "./useGameShortcuts";
import { useGameSettings } from "./useGameSettings";
import styles from "./DoubleTake.module.css";

type Phase =
  | "lobby"
  | "preparing"
  | "loading"
  | "first"
  | "second"
  | "guess"
  | "paused"
  | "error"
  | "reveal"
  | "summary";

// The display clock only starts when both full images have decoded.
const preload = (src: string, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("Photograph loading cancelled"));
    const deadline = window.setTimeout(
      () => finish(new Error("Photograph loading timed out")),
      15000,
    );
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      if (typeof image.decode === "function")
        image.decode().then(
          () => finish(),
          () => finish(new Error("Photograph couldn’t decode")),
        );
      else finish();
    };
    image.onerror = () => finish(new Error("Photograph unavailable"));
    image.src = src;
  });

export const DoubleTake = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [deck, setDeck] = useState<DoubleTakePair[]>([]);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [settings, setSettings] = useGameSettings("doubleTake");
  const { slower } = settings;
  const [attempt, setAttempt] = useState(0);
  const [replayed, setReplayed] = useState(false);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [points, setPoints] = useState(0);
  const [message, setMessage] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const pair = deck[round];
  const duration = slower ? 3000 : Math.max(650, 1000 - streak * 100);

  useEffect(() => {
    if (phase !== "preparing") return;
    const task = window.setTimeout(() => {
      try {
        const next = buildDoubleTakeDeck(photos);
        if (!next.length) {
          setMessage(
            "There aren’t enough well-located, visually similar pairs in this archive yet.",
          );
          setPhase("lobby");
          return;
        }
        setDeck(next);
        setPhase("loading");
      } catch {
        setMessage("The pairs couldn’t be prepared. Try again.");
        setPhase("lobby");
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [phase, photos]);

  useEffect(() => {
    if (phase !== "loading" || !pair) return;
    let cancelled = false;
    const controller = new AbortController();
    Promise.all(
      pair.photos.map((photo) => preload(getResizedAlbumImageSrc(photo.path), controller.signal)),
    )
      .then(() => {
        if (!cancelled) setPhase(document.hidden ? "paused" : "first");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [phase, pair, attempt]);

  useEffect(() => {
    if (phase !== "first" && phase !== "second") return;
    if (document.hidden) {
      setPhase("paused");
      return;
    }
    const timer = window.setTimeout(
      () => setPhase(phase === "first" ? "second" : "guess"),
      duration,
    );
    return () => window.clearTimeout(timer);
  }, [phase, duration]);

  useEffect(() => {
    const interrupt = () => {
      if (document.hidden)
        setPhase((current) =>
          ["first", "second", "loading"].includes(current) ? "paused" : current,
        );
    };
    document.addEventListener("visibilitychange", interrupt);
    return () => document.removeEventListener("visibilitychange", interrupt);
  }, []);

  useEffect(() => {
    if (phase === "reveal" || phase === "summary") resultRef.current?.focus();
  }, [phase]);

  const start = () => {
    setMessage("");
    setRound(0);
    setScore(0);
    setStreak(0);
    setCorrectCount(0);
    setAnswer(null);
    setPoints(0);
    setReplayed(false);
    setPhase("preparing");
  };

  const watch = (replay = false) => {
    if (replay) setReplayed(true);
    setAttempt((value) => value + 1);
    setPhase("loading");
  };
  const choose = (guess: boolean | null) => {
    if (!pair || phase === "reveal" || phase === "summary") return;
    const correct = guess === pair.samePlace;
    const earned = doubleTakePoints(correct, streak, replayed);
    setAnswer(guess);
    setPoints(earned);
    setScore((value) => value + earned);
    setCorrectCount((value) => value + Number(correct));
    setStreak(correct ? streak + 1 : 0);
    setPhase("reveal");
  };

  const next = () => {
    if (round + 1 === deck.length) setPhase("summary");
    else {
      setRound(round + 1);
      setAnswer(null);
      setReplayed(false);
      setPhase("loading");
    }
  };
  const shortcuts = [
    {
      key: "n",
      label: "New game",
      action: start,
      enabled: phase === "lobby" || phase === "summary",
    },
    { key: "1", label: "Same place", action: () => choose(true), enabled: phase === "guess" },
    {
      key: "2",
      label: "Different places",
      action: () => choose(false),
      enabled: phase === "guess",
    },
    { key: "r", label: "Replay pair", action: () => watch(true), enabled: phase === "guess" },
    {
      key: "Space",
      label: phase === "reveal" ? "Next pair" : "Watch again",
      action: phase === "reveal" ? next : () => watch(),
      enabled: ["reveal", "paused", "error"].includes(phase),
    },
    { key: "Enter", label: "Next pair", action: next, enabled: phase === "reveal" },
  ];
  useGameShortcuts(shortcuts);

  if (phase === "preparing")
    return (
      <div className={styles.placeholder}>
        <span className={styles.spinner} aria-hidden="true" />
        <p role="status">Finding visual doubles…</p>
        <Button variant="quiet" onClick={() => setPhase("lobby")}>
          Cancel
        </Button>
      </div>
    );
  if (phase === "lobby")
    return (
      <GameIntro game="double-take">
        <p>Two photographs. A similar look. Were they taken in the same place?</p>
        <Caption>
          Same place means within 75 metres, on different days. Different places are at least 5 km
          apart.
        </Caption>
        <div className={styles.actions}>
          <Button
            aria-pressed={slower}
            active={slower}
            onClick={() => setSettings({ slower: !slower })}
          >
            Longer look · {slower ? "3 seconds" : "off"}
          </Button>
        </div>
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" onClick={start}>
          Start Double Take
        </Button>
        <GameShortcutHelp shortcuts={shortcuts} />
      </GameIntro>
    );

  if (phase === "summary")
    return (
      <div
        className={styles.game}
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Double Take results"
      >
        <Heading level={1}>
          {correctCount === deck.length ? "An eye for places" : "The double takes"}
        </Heading>
        <GameScore score={Math.round((correctCount / deck.length) * 100)} label="Accuracy" />
        <p>
          {correctCount} of {deck.length} correct · {score} points
        </p>
        <Button variant="primary" onClick={start}>
          Play again
        </Button>
        <Button onClick={() => setPhase("lobby")}>Change viewing time</Button>
        <GameShortcutHelp shortcuts={shortcuts} />
      </div>
    );

  if (!pair) return null;
  const revealed = phase === "reveal";
  const flash = phase === "first" ? 0 : phase === "second" ? 1 : null;
  return (
    <div className={styles.game}>
      <div className={styles.progress}>
        <Caption>
          Pair {round + 1} of {deck.length}
        </Caption>
        <GameProgress current={round + 1} total={deck.length} />
        <Caption>{score} points</Caption>
      </div>
      {revealed ? (
        <div
          className={styles.game}
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Pair revealed"
        >
          {answer !== null ? (
            <div
              className={styles.verdict}
              data-correct={answer === pair.samePlace}
              role="status"
              key={round}
            >
              <span className={styles.verdictIcon} aria-hidden="true">
                <Icon kind={answer === pair.samePlace ? "sparkles" : "close"} />
              </span>
              <strong>{answer === pair.samePlace ? "Correct" : "Not quite"}</strong>
              <span>{points ? `+${points} points` : "No points this round"}</span>
            </div>
          ) : null}
          <Heading level={1}>
            {answer === null
              ? "The places revealed"
              : answer === pair.samePlace
                ? "Good eye"
                : "A convincing double"}
          </Heading>
          <p>
            {pair.samePlace ? "Same place" : "Different places"} ·{" "}
            {pair.distanceMetres < 1000
              ? `${Math.round(pair.distanceMetres)} metres apart`
              : `${(pair.distanceMetres / 1000).toFixed(1)} km apart`}
          </p>
          <div className={styles.reveal}>
            {pair.photos.map((photo) => (
              <figure key={photo.path}>
                <GamePhoto photo={photo} link />
                <figcaption>
                  {photo.location?.label || "Recorded location"}
                  <Caption>{exifDayKey(photo.location!.date)}</Caption>
                </figcaption>
              </figure>
            ))}
          </div>
          {answer === null ? <p>No points this round</p> : null}
          {points > 100 ? <Caption>{points - 100} streak bonus</Caption> : null}
          {replayed ? (
            <Caption>
              Replayed pairs earn 100 points for a correct answer, without a streak bonus.
            </Caption>
          ) : null}
          <Button variant="primary" onClick={next}>
            {round + 1 === deck.length ? "See results" : "Next pair"}
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.stage} aria-live="polite">
            {flash !== null ? (
              <>
                <img
                  key={flash}
                  className={styles.flash}
                  src={getResizedAlbumImageSrc(pair.photos[flash].path)}
                  alt={`Photograph ${flash + 1}`}
                />
                <span className={styles.lookLabel} aria-hidden="true">
                  {flash === 0 ? "First look" : "Second look"}
                </span>
                <span
                  key={`clock-${flash}`}
                  className={styles.clock}
                  style={{ animationDuration: `${duration}ms` }}
                  aria-hidden="true"
                />
              </>
            ) : (
              <div className={styles.placeholder}>
                {phase === "loading" ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    <p role="status">Preparing both photographs…</p>
                  </>
                ) : phase === "guess" ? (
                  <Heading level={2}>Same place?</Heading>
                ) : phase === "paused" ? (
                  <p>The pair was interrupted. Watch both photographs again.</p>
                ) : (
                  <p role="alert">A photograph couldn’t load. Try the pair again.</p>
                )}
              </div>
            )}
          </div>
          <div className={styles.actions}>
            {phase === "guess" ? (
              <>
                <Button variant="primary" onClick={() => choose(true)}>
                  Same place
                </Button>
                <Button variant="primary" onClick={() => choose(false)}>
                  Different places
                </Button>
                <Button onClick={() => watch(true)}>Replay pair</Button>
              </>
            ) : null}
            {phase === "paused" ? (
              <Button variant="primary" onClick={() => watch()}>
                Watch again
              </Button>
            ) : null}
            {phase === "error" ? (
              <Button variant="primary" onClick={() => watch()}>
                Retry photographs
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => choose(null)}>
              Give up this pair
            </Button>
          </div>
          {phase === "guess" ? (
            <Caption>
              100 points for a correct answer, plus up to 100 for a streak. Replay removes the
              streak bonus.
            </Caption>
          ) : null}
        </>
      )}
      <GameShortcutHelp shortcuts={shortcuts} />
    </div>
  );
};
