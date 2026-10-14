import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading, Input, KeyHint, LoadingIndicator } from "../ui";
import { ProgressBar } from "../ProgressBar";
import { useUrlSearchParams } from "../platform";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import {
  normaliseGuess,
  scoreTextAgainstArchive,
  warmerBlur,
  warmerTemperature,
  type Temperature,
} from "../../util/semanticGames";
import { GamePhoto } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import { useGameReadiness } from "./GameReadiness";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
  useShareOrigin,
} from "./GameRecord";
import { readGameStats, useGameStats } from "./useGameStats";
import { useGameShortcuts } from "./useGameShortcuts";
import { useTextEncoder } from "./useTextEncoder";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoGames.module.css";
import warmerStyles from "./Warmer.module.css";

type Guess = { text: string; rank: number; total: number; temperature: Temperature };
type Daily = { day: string; number: number };

const MAX_GUESS_LENGTH = 60;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "es"}`;
const summaryOf = (found: boolean, guesses: number) =>
  found ? `Found in ${plural(guesses, "guess")}` : `Gave up after ${plural(guesses, "guess")}`;
const rankText = (guess: Pick<Guess, "rank" | "total">) =>
  `#${guess.rank.toLocaleString("en-GB")} of ${guess.total.toLocaleString("en-GB")}`;

export const Warmer = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const { loading } = useGameReadiness();
  const { stats, record } = useGameStats("warmer");
  const shareOrigin = useShareOrigin();
  const {
    ready: urlReady,
    searchParams,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const encoder = useTextEncoder();
  const [target, setTarget] = useState<PhotoGamePhoto | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<"found" | "gave-up" | null>(null);
  const previousTarget = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const recorded = useRef<PhotoGamePhoto | null>(null);
  const eligible = photos.filter((photo) => photo.caption.length >= 20 && photo.vector.length > 0);

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  const setDailyParam = (on: boolean) => {
    if (hasSearchParam("daily") === on) return;
    const params = new URLSearchParams(searchParams);
    if (on) params.set("daily", "");
    else params.delete("daily");
    replaceSearchParams(params);
  };
  const deal = (next: PhotoGamePhoto | null, nextDaily: Daily | null) => {
    encoder.cancel();
    previousTarget.current = next?.path ?? null;
    setTarget(next);
    setDaily(next ? nextDaily : null);
    setGuesses([]);
    setDraft("");
    setMessage("");
    setOutcome(null);
  };
  const start = () => {
    setDailyParam(false);
    deal(
      shuffleGamePhotos(eligible.filter((photo) => photo.path !== previousTarget.current))[0] ??
        eligible[0] ??
        null,
      null,
    );
  };
  const startDaily = () => {
    const today = dailyPuzzle("warmer");
    // The archive arrives in random order: sort it, or the seed picks differently.
    const order = dailyPhotoOrder(eligible);
    const next = order[Math.floor(today.random()() * order.length)] ?? null;
    setDailyParam(!!next);
    deal(next, { day: today.day, number: today.number });
  };

  // A `?daily` link opens straight onto today's photograph, once the archive is ready.
  const dailyOpened = useRef(false);
  useEffect(() => {
    if (dailyOpened.current || !urlReady || loading || !eligible.length) return;
    dailyOpened.current = true;
    if (hasSearchParam("daily")) startDaily();
    // Runs once: startDaily reads the same props this effect waits for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlReady, loading, photos]);

  const finish = (found: boolean, count: number) => {
    encoder.cancel();
    setOutcome(found ? "found" : "gave-up");
    if (!target || recorded.current === target) return;
    recorded.current = target;
    // A daily already finished today is practice: its answer is known.
    if (daily && readGameStats("warmer").dailies[daily.day]) return;
    record({
      won: found,
      ...(daily ? { daily: { day: daily.day, summary: summaryOf(found, count) } } : {}),
    });
  };

  const guess = async () => {
    if (!target || encoder.busy || outcome) return;
    const text = normaliseGuess(draft);
    if (!text) return;
    if (guesses.some((previous) => previous.text === text)) {
      setMessage(`You already tried “${text}”.`);
      return;
    }
    setMessage("");
    const vector = await encoder.encode(text);
    if (!vector) return;
    const result = scoreTextAgainstArchive(vector, photos, target.path);
    if (!result) {
      setMessage("That guess could not be compared with the photograph. Try other words.");
      return;
    }
    const next = [
      ...guesses,
      {
        text,
        rank: result.rank,
        total: result.total,
        temperature: warmerTemperature(result.rank, result.total),
      },
    ];
    setGuesses(next);
    setDraft("");
    if (result.found) finish(true, next.length);
    else inputRef.current?.focus();
  };

  useGameShortcuts(
    [
      {
        key: "N",
        label: target ? "Play again" : "Start Warmer",
        action: start,
        enabled: eligible.length > 0 && (!target || Boolean(outcome)),
      },
    ],
    eligible.length > 0,
  );

  if (!loading && !eligible.length) return <p>There are no photographs ready for Warmer yet.</p>;

  if (!target) {
    const today = dailyPuzzle("warmer");
    const playedToday = stats?.dailies[today.day];
    return (
      <GameIntro game="warmer">
        <p>
          Find a hidden photograph by describing it. Every guess is ranked against the whole
          archive, and the closer it gets, the sharper the photograph.
        </p>
        <Caption>The first guess downloads a 155 MB language model.</Caption>
        <Button variant="primary" onClick={start}>
          Start Warmer
          <KeyHint aria-hidden="true">N</KeyHint>
        </Button>
        <div className={warmerStyles.daily}>
          <Button onClick={startDaily}>Daily #{today.number}</Button>
          <Caption as="span" size="sm">
            {playedToday
              ? `Played today · ${playedToday.summary}`
              : "One photograph for everyone today."}
          </Caption>
        </div>
        <GameStatsLine stats={stats} best={null} />
      </GameIntro>
    );
  }

  const ranked = [...guesses].sort((a, b) => a.rank - b.rank);
  const best = ranked[0] ?? null;
  const latest = guesses.at(-1) ?? null;

  if (outcome) {
    const found = outcome === "found";
    return (
      <div
        className={[styles.game, styles.result].join(" ")}
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Warmer result"
      >
        <Heading level={1}>{found ? "Found it" : "The hidden photograph"}</Heading>
        {daily ? <Caption>Daily #{daily.number}</Caption> : null}
        <p>{summaryOf(found, guesses.length)}</p>
        <div className={[styles.comparison, styles.comparisonSingle].join(" ")}>
          <figure className={styles.frame}>
            <GamePhoto photo={target} link />
            <Caption as="figcaption">{target.caption}</Caption>
          </figure>
        </div>
        {ranked.length ? (
          <section className={styles.result}>
            <Heading level={2}>Closest guesses</Heading>
            <ol className={warmerStyles.guesses}>
              {ranked.slice(0, 5).map((item) => (
                <li key={item.text} data-temperature={item.temperature.id}>
                  <span className={warmerStyles.word}>{item.text}</span>
                  <span>{item.temperature.label}</span>
                  <span className={warmerStyles.rank}>{rankText(item)}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <ResultNextSteps photos={[target]} />
        <div className={styles.actions}>
          {daily ? (
            <ShareResult
              text={dailyShareText(
                "warmer",
                daily.day,
                summaryOf(found, guesses.length),
                shareOrigin,
              )}
            />
          ) : null}
          <Button variant="primary" onClick={start}>
            Play again
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
        </div>
      </div>
    );
  }

  const blur = warmerBlur(best?.rank ?? null, best?.total ?? photos.length);
  return (
    <div className={styles.game}>
      {daily ? <Caption>Daily #{daily.number}</Caption> : null}
      <div className={warmerStyles.layout}>
        <div className={warmerStyles.hidden}>
          <img
            src={getResizedAlbumImageSrc(target.path)}
            alt="The hidden photograph, blurred"
            className={styles.photo}
            style={{ filter: `blur(${blur}px)` }}
          />
        </div>
        <div className={warmerStyles.play}>
          <form
            className={warmerStyles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void guess();
            }}
          >
            <label className={warmerStyles.label} htmlFor="warmer-guess">
              What is in the photograph?
            </label>
            <div className={styles.actions}>
              <Input
                id="warmer-guess"
                ref={inputRef}
                className={warmerStyles.input}
                value={draft}
                maxLength={MAX_GUESS_LENGTH}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={encoder.busy || !draft.trim()}>
                Guess
              </Button>
            </div>
          </form>
          {encoder.busy ? (
            <div role="status" aria-busy="true">
              <LoadingIndicator
                label={encoder.progress < 100 ? encoder.stage : "Comparing your guess…"}
              />
              {encoder.progress < 100 ? <ProgressBar progress={encoder.progress} /> : null}
            </div>
          ) : null}
          {encoder.error ? <p role="alert">{encoder.error}</p> : null}
          {message ? <p role="alert">{message}</p> : null}
          <p role="status" className={warmerStyles.latest}>
            {latest ? `“${latest.text}” · ${latest.temperature.label} · ${rankText(latest)}` : ""}
          </p>
          {ranked.length ? (
            <ol className={warmerStyles.guesses} aria-label="Your guesses, closest first">
              {ranked.map((item) => (
                <li
                  key={item.text}
                  data-temperature={item.temperature.id}
                  data-latest={item === latest}
                >
                  <span className={warmerStyles.word}>{item.text}</span>
                  <span>{item.temperature.label}</span>
                  <span className={warmerStyles.rank}>{rankText(item)}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className={styles.actions}>
            <Button variant="quiet" onClick={() => finish(false, guesses.length)}>
              Give up
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
