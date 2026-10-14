import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading, KeyHint, LoadingIndicator } from "../ui";
import { ProgressBar } from "../ProgressBar";
import { useUrlSearchParams } from "../platform";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { captionProblem, scoreTextAgainstArchive, type TextScore } from "../../util/semanticGames";
import { GameScore } from "./GameFeedback";
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
import captionStyles from "./CaptionIt.module.css";

type Daily = { day: string; number: number };
type Attempt = { caption: string; yours: TextScore; index: TextScore | null };

const MAX_CAPTION_LENGTH = 120;
const outOf100 = (value: number) => `${value}/100`;
const rankPhrase = (score: TextScore) =>
  score.rank === 1
    ? "first of all"
    : `${score.rank.toLocaleString("en-GB")} of ${score.total.toLocaleString("en-GB")}`;
const summaryOf = (score: TextScore) =>
  `${score.score ?? 0}/100 · ranked ${score.rank === 1 ? "first" : `#${score.rank}`}`;

export const CaptionIt = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const { loading } = useGameReadiness();
  const { stats, record } = useGameStats("caption-it");
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
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const previousTarget = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const recorded = useRef<PhotoGamePhoto | null>(null);
  const eligible = photos.filter((photo) => photo.caption.length >= 20 && photo.vector.length > 0);

  useEffect(() => {
    if (attempt) resultRef.current?.focus();
  }, [attempt]);

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
    setDraft("");
    setMessage("");
    setAttempt(null);
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
    const today = dailyPuzzle("caption-it");
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

  const submit = async () => {
    if (!target || encoder.busy) return;
    const caption = draft.trim();
    const problem = captionProblem(caption);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage("");
    const vector = await encoder.encode(caption);
    if (!vector) return;
    const yours = scoreTextAgainstArchive(vector, photos, target.path);
    if (!yours) {
      setMessage("That caption could not be compared with the archive. Try other words.");
      return;
    }
    // The index's own caption, scored the same way, is the bar to beat.
    const indexVector = await encoder.encode(target.caption);
    const index = indexVector ? scoreTextAgainstArchive(indexVector, photos, target.path) : null;
    setAttempt({ caption, yours, index });
    if (recorded.current === target) return;
    recorded.current = target;
    // A daily already finished today is practice: the photograph is known.
    if (daily && readGameStats("caption-it").dailies[daily.day]) return;
    record({
      won: yours.found,
      ...(yours.score === null ? {} : { score: yours.score }),
      ...(daily ? { daily: { day: daily.day, summary: summaryOf(yours) } } : {}),
    });
  };

  useGameShortcuts(
    [
      {
        key: "N",
        label: target ? "Another photograph" : "Start Caption It",
        action: start,
        enabled: eligible.length > 0 && (!target || Boolean(attempt)),
      },
    ],
    eligible.length > 0,
  );

  if (!loading && !eligible.length)
    return <p>There are no photographs ready for Caption It yet.</p>;

  if (!target) {
    const today = dailyPuzzle("caption-it");
    const playedToday = stats?.dailies[today.day];
    return (
      <GameIntro game="caption-it">
        <p>
          Caption a photograph. The best caption picks it out of the whole archive: describe what
          makes it this photograph and no other.
        </p>
        <Caption>Scoring downloads a 155 MB language model the first time.</Caption>
        <Button variant="primary" onClick={start}>
          Start Caption It
          <KeyHint aria-hidden="true">N</KeyHint>
        </Button>
        <div className={captionStyles.daily}>
          <Button onClick={startDaily}>Daily #{today.number}</Button>
          <Caption as="span" size="sm">
            {playedToday
              ? `Played today · ${playedToday.summary}`
              : "One photograph for everyone today."}
          </Caption>
        </div>
        <GameStatsLine stats={stats} formatBest={outOf100} />
      </GameIntro>
    );
  }

  if (attempt) {
    const { yours, index } = attempt;
    return (
      <div
        className={[styles.game, styles.result].join(" ")}
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Caption It result"
      >
        <Heading level={1}>{yours.found ? "Picked out" : "Not picked out"}</Heading>
        {daily ? <Caption>Daily #{daily.number}</Caption> : null}
        <div className={captionStyles.result} data-picked-out={yours.nearest.path === target.path}>
          <GamePhoto photo={target} link />
          <figure className={styles.frame}>
            <Caption as="figcaption">The archive’s caption</Caption>
            <p className={captionStyles.indexCaption}>{target.caption}</p>
          </figure>
          {yours.nearest.path !== target.path ? (
            <figure className={styles.frame}>
              <Caption as="figcaption">What your caption fits best</Caption>
              <GamePhoto photo={yours.nearest} link />
            </figure>
          ) : null}
          <div className={captionStyles.yours}>
            <GameScore label="Fit" score={yours.score} band />
            <figure className={styles.frame}>
              <Caption as="figcaption">Your caption</Caption>
              <blockquote className={styles.prompt}>{attempt.caption}</blockquote>
            </figure>
            <Caption>
              Your caption ranked this photograph {rankPhrase(yours)}.
              {index
                ? ` The archive’s own caption ranked it ${rankPhrase(index)}${
                    index.rank > yours.rank ? " — yours did better" : ""
                  }.`
                : ""}
            </Caption>
          </div>
        </div>
        <ResultNextSteps photos={[target]} />
        <div className={styles.actions}>
          {daily ? (
            <ShareResult
              text={dailyShareText("caption-it", daily.day, summaryOf(yours), shareOrigin)}
            />
          ) : null}
          <Button variant="primary" onClick={start}>
            Another photograph
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          <Button
            onClick={() => {
              setDraft(attempt.caption);
              setAttempt(null);
            }}
          >
            Rewrite this caption
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.game}>
      {daily ? <Caption>Daily #{daily.number}</Caption> : null}
      <div className={captionStyles.layout}>
        <GamePhoto photo={target} />
        <form
          className={captionStyles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className={captionStyles.label} htmlFor="caption-it-text">
            Your caption
          </label>
          <textarea
            id="caption-it-text"
            className={captionStyles.text}
            value={draft}
            maxLength={MAX_CAPTION_LENGTH}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Caption size="sm">
            {draft.length} / {MAX_CAPTION_LENGTH}
          </Caption>
          {encoder.busy ? (
            <div role="status" aria-busy="true">
              <LoadingIndicator
                label={encoder.progress < 100 ? encoder.stage : "Comparing with the archive…"}
              />
              {encoder.progress < 100 ? <ProgressBar progress={encoder.progress} /> : null}
            </div>
          ) : null}
          {encoder.error ? <p role="alert">{encoder.error}</p> : null}
          {message ? <p role="alert">{message}</p> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={encoder.busy || !draft.trim()}>
              Score caption
            </Button>
            <Button variant="quiet" onClick={start}>
              Another photograph
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
