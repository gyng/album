import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Caption, Heading, KeyHint, LoadingIndicator } from "../ui";
import { ProgressBar } from "../ProgressBar";
import { useUrlSearchParams } from "../platform";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { captionProblem, scoreTextAgainstArchive, type TextScore } from "../../util/semanticGames";
import {
  bannedWordProblem,
  bannedWordsFor,
  captionBudgetProblem,
  captionWords,
  dealCaptionSet,
  dealLookalikes,
  scoreCaptionSet,
  separation,
  SET_NEAR_TOP,
  type CaptionBudget,
  type CaptionMode,
  type SetScore,
} from "../../util/captionModes";
import { fitBand } from "../../util/fitBand";
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
import { useGameSettings } from "./useGameSettings";
import { useGameShortcuts } from "./useGameShortcuts";
import { useTextEncoder } from "./useTextEncoder";
import { ResultNextSteps } from "./ResultNextSteps";
import styles from "./PhotoGames.module.css";
import captionStyles from "./CaptionIt.module.css";

type Daily = { day: string; number: number };
/**
 * `photos` is the photograph to caption, then its lookalikes; or the three of a set.
 * `banned` is empty and `words` null unless the player chose them.
 */
type Puzzle = {
  mode: CaptionMode;
  photos: PhotoGamePhoto[];
  words: CaptionBudget;
  banned: string[];
};
type Attempt =
  | { mode: "single"; caption: string; yours: TextScore; index: TextScore | null }
  | {
      mode: "lookalikes";
      caption: string;
      yours: TextScore;
      ahead: number;
      behind: string[];
      indexAhead: number | null;
    }
  | { mode: "set"; caption: string; set: SetScore };

const MODES = [
  { value: "single", label: "One photograph", detail: null },
  {
    value: "lookalikes",
    label: "Lookalikes",
    detail: "Caption a photograph so it cannot be mistaken for the three most like it.",
  },
  {
    value: "set",
    label: "A set of three",
    detail: "One caption for three photographs from one album.",
  },
] as const;
const BUDGETS = [
  { value: null, label: "Any length" },
  { value: 12, label: "12 words" },
  { value: 8, label: "8 words" },
  { value: 5, label: "5 words" },
] as const;
const BANNED_COUNT = 3;

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
  const [settings, setSettings] = useGameSettings("caption");
  const shareOrigin = useShareOrigin();
  const {
    ready: urlReady,
    searchParams,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const encoder = useTextEncoder();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const previousTarget = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const recorded = useRef<Puzzle | null>(null);
  const eligible = photos.filter((photo) => photo.caption.length >= 20 && photo.vector.length > 0);
  const target = puzzle?.photos[0] ?? null;

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
  const deal = (next: Puzzle | null, nextDaily: Daily | null) => {
    encoder.cancel();
    previousTarget.current = next?.photos[0]?.path ?? null;
    setPuzzle(next);
    setDaily(next ? nextDaily : null);
    setDraft("");
    setMessage("");
    setAttempt(null);
  };
  const start = () => {
    setDailyParam(false);
    const fresh = eligible.filter((photo) => photo.path !== previousTarget.current);
    const pool = fresh.length ? fresh : eligible;
    let dealt: PhotoGamePhoto[] | null;
    if (settings.mode === "lookalikes") {
      const lookalikes = dealLookalikes(
        pool,
        photos.filter((photo) => photo.vector.length > 0),
      );
      dealt = lookalikes ? [lookalikes.photo, ...lookalikes.lookalikes] : null;
    } else if (settings.mode === "set") dealt = dealCaptionSet(pool);
    else dealt = shuffleGamePhotos(pool).slice(0, 1);
    if (!dealt?.length) {
      setMessage("The archive has no photographs that suit this mode yet.");
      return;
    }
    deal(
      {
        mode: settings.mode,
        photos: dealt,
        words: settings.words,
        // Lookalikes ban the photograph's own words; the lookalikes may share them.
        banned: settings.banned
          ? bannedWordsFor(
              settings.mode === "lookalikes" ? dealt.slice(0, 1) : dealt,
              photos,
              BANNED_COUNT,
            )
          : [],
      },
      null,
    );
  };
  const startDaily = () => {
    const today = dailyPuzzle("caption-it");
    // The archive arrives in random order: sort it, or the seed picks differently.
    const order = dailyPhotoOrder(eligible);
    const next = order[Math.floor(today.random()() * order.length)] ?? null;
    setDailyParam(!!next);
    // Everyone plays the same daily: one photograph, whatever the player's own rules.
    deal(next ? { mode: "single", photos: [next], words: null, banned: [] } : null, {
      day: today.day,
      number: today.number,
    });
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

  const recordOnce = (won: boolean, score: number | null, summary: string) => {
    if (!puzzle || recorded.current === puzzle) return;
    recorded.current = puzzle;
    // A daily already finished today is practice: the photograph is known.
    if (daily && readGameStats("caption-it").dailies[daily.day]) return;
    record({
      won,
      ...(score === null ? {} : { score }),
      ...(daily ? { daily: { day: daily.day, summary } } : {}),
    });
  };

  const submit = async () => {
    if (!puzzle || !target || encoder.busy) return;
    const caption = draft.trim();
    const problem =
      captionProblem(caption) ??
      captionBudgetProblem(caption, puzzle.words) ??
      bannedWordProblem(caption, puzzle.banned);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage("");
    const vector = await encoder.encode(caption);
    if (!vector) return;
    if (puzzle.mode === "set") {
      const set = scoreCaptionSet(vector, puzzle.photos, photos);
      if (!set) {
        setMessage("That caption could not be compared with the archive. Try other words.");
        return;
      }
      setAttempt({ mode: "set", caption, set });
      // Fits of three photographs are not one fit: a set records wins only.
      recordOnce(set.won, null, "");
      return;
    }
    const yours = scoreTextAgainstArchive(vector, photos, target.path);
    if (!yours) {
      setMessage("That caption could not be compared with the archive. Try other words.");
      return;
    }
    // The index's own caption, scored the same way, is the bar to beat.
    const indexVector = await encoder.encode(target.caption);
    if (puzzle.mode === "lookalikes") {
      const lookalikes = { photo: target, lookalikes: puzzle.photos.slice(1) };
      const { ahead, behind } = separation(vector, lookalikes);
      const indexAhead = indexVector ? separation(indexVector, lookalikes).ahead : null;
      setAttempt({ mode: "lookalikes", caption, yours, ahead, behind, indexAhead });
      recordOnce(ahead === lookalikes.lookalikes.length, yours.score, "");
      return;
    }
    const index = indexVector ? scoreTextAgainstArchive(indexVector, photos, target.path) : null;
    setAttempt({ mode: "single", caption, yours, index });
    recordOnce(yours.found, yours.score, summaryOf(yours));
  };

  const againLabel = puzzle && puzzle.mode !== "single" ? "Deal again" : "Another photograph";
  useGameShortcuts(
    [
      {
        key: "N",
        label: puzzle ? againLabel : "Start Caption It",
        action: start,
        enabled: eligible.length > 0 && (!puzzle || Boolean(attempt)),
      },
    ],
    eligible.length > 0,
  );

  if (!loading && !eligible.length)
    return <p>There are no photographs ready for Caption It yet.</p>;

  if (!puzzle || !target) {
    const today = dailyPuzzle("caption-it");
    const playedToday = stats?.dailies[today.day];
    const modeDetail = MODES.find((item) => item.value === settings.mode)!.detail;
    return (
      <GameIntro game="caption-it">
        <p>
          Caption a photograph. The best caption picks it out of the whole archive: describe what
          makes it this photograph and no other.
        </p>
        <div className={styles.actions} role="group" aria-label="Mode">
          {MODES.map(({ value, label }) => (
            <Button
              key={value}
              active={settings.mode === value}
              aria-pressed={settings.mode === value}
              onClick={() => {
                setSettings((previous) => ({ ...previous, mode: value }));
                setMessage("");
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        {modeDetail ? <Caption>{modeDetail}</Caption> : null}
        <div className={styles.actions} role="group" aria-label="Word budget">
          {BUDGETS.map(({ value, label }) => (
            <Button
              key={label}
              active={settings.words === value}
              aria-pressed={settings.words === value}
              onClick={() => setSettings((previous) => ({ ...previous, words: value }))}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className={styles.actions}>
          <Button
            active={settings.banned}
            aria-pressed={settings.banned}
            onClick={() => setSettings((previous) => ({ ...previous, banned: !previous.banned }))}
          >
            Ban {BANNED_COUNT} words
          </Button>
          <Caption as="span" size="sm">
            The words that would make it easiest.
          </Caption>
        </div>
        <Caption>Scoring downloads a 207 MB language model the first time.</Caption>
        {message ? <p role="alert">{message}</p> : null}
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

  const rewrite = (caption: string) => {
    setDraft(caption);
    setAttempt(null);
  };
  const yourCaption = (caption: string) => (
    <figure className={styles.frame}>
      <Caption as="figcaption">Your caption</Caption>
      <blockquote className={styles.prompt}>{caption}</blockquote>
    </figure>
  );
  const archiveCaption = (
    <figure className={styles.frame}>
      <Caption as="figcaption">The archive’s caption</Caption>
      <p className={captionStyles.indexCaption}>{target.caption}</p>
    </figure>
  );

  if (attempt) {
    let heading: string;
    let body: ReactNode;
    if (attempt.mode === "set") {
      const { set } = attempt;
      heading = set.won
        ? "All three picked out"
        : `${set.found} of ${puzzle.photos.length} picked out`;
      body = (
        <div className={captionStyles.setResult}>
          <ul className={captionStyles.set}>
            {puzzle.photos.map((photo, index) => {
              const score = set.scores[index]!;
              return (
                <li key={photo.path}>
                  <GamePhoto photo={photo} link />
                  <Caption>
                    {[score.score === null ? null : fitBand(score.score), rankPhrase(score)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Caption>
                </li>
              );
            })}
          </ul>
          <div className={captionStyles.yours}>
            <GameScore label="Fit across the set" score={set.fit} band />
            {yourCaption(attempt.caption)}
            <Caption>
              A photograph is picked out when it ranks in the top {SET_NEAR_TOP * 100}% of the
              archive.
            </Caption>
          </div>
        </div>
      );
    } else if (attempt.mode === "lookalikes") {
      const lookalikes = puzzle.photos.slice(1);
      const { yours, ahead, behind, indexAhead } = attempt;
      heading = ahead === lookalikes.length ? "Told apart" : "Mistaken for a lookalike";
      body = (
        <div className={captionStyles.result}>
          <GamePhoto photo={target} link />
          {archiveCaption}
          <figure className={styles.frame}>
            <Caption as="figcaption">Its lookalikes</Caption>
            <ul className={captionStyles.set}>
              {lookalikes.map((photo) => (
                <li key={photo.path}>
                  <GamePhoto photo={photo} link />
                  <Caption>
                    {behind.includes(photo.path) ? "Fits your caption better" : "Told apart"}
                  </Caption>
                </li>
              ))}
            </ul>
          </figure>
          <div className={captionStyles.yours}>
            <GameScore label="Fit" score={yours.score} band />
            {yourCaption(attempt.caption)}
            <Caption>
              Your caption told it apart from {ahead} of its {lookalikes.length} lookalikes.
              {indexAhead === null
                ? ""
                : ` The archive’s own caption managed ${indexAhead}${
                    indexAhead < ahead ? " — yours did better" : ""
                  }.`}
            </Caption>
          </div>
        </div>
      );
    } else {
      const { yours, index } = attempt;
      heading = yours.found ? "Picked out" : "Not picked out";
      body = (
        <div className={captionStyles.result} data-picked-out={yours.nearest.path === target.path}>
          <GamePhoto photo={target} link />
          {archiveCaption}
          {yours.nearest.path !== target.path ? (
            <figure className={styles.frame}>
              <Caption as="figcaption">What your caption fits best</Caption>
              <GamePhoto photo={yours.nearest} link />
            </figure>
          ) : null}
          <div className={captionStyles.yours}>
            <GameScore label="Fit" score={yours.score} band />
            {yourCaption(attempt.caption)}
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
      );
    }
    return (
      <div
        className={[styles.game, styles.result].join(" ")}
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Caption It result"
      >
        <Heading level={1}>{heading}</Heading>
        {daily ? <Caption>Daily #{daily.number}</Caption> : null}
        {body}
        <ResultNextSteps photos={puzzle.mode === "set" ? puzzle.photos : [target]} />
        <div className={styles.actions}>
          {daily && attempt.mode === "single" ? (
            <ShareResult
              text={dailyShareText("caption-it", daily.day, summaryOf(attempt.yours), shareOrigin)}
            />
          ) : null}
          <Button variant="primary" onClick={start}>
            {againLabel}
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          <Button onClick={() => rewrite(attempt.caption)}>Rewrite this caption</Button>
        </div>
      </div>
    );
  }

  const wordCount = captionWords(draft).length;
  return (
    <div className={styles.game}>
      {daily ? <Caption>Daily #{daily.number}</Caption> : null}
      <div
        className={[captionStyles.layout, puzzle.mode === "set" ? captionStyles.layoutStacked : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {puzzle.mode === "set" ? (
          <ul className={captionStyles.set} aria-label="The set">
            {puzzle.photos.map((photo) => (
              <li key={photo.path}>
                <GamePhoto photo={photo} />
              </li>
            ))}
          </ul>
        ) : puzzle.mode === "lookalikes" ? (
          <div className={captionStyles.lookalikes}>
            <GamePhoto photo={target} />
            <Caption>Not these</Caption>
            <ul className={captionStyles.set} aria-label="Its lookalikes">
              {puzzle.photos.slice(1).map((photo) => (
                <li key={photo.path}>
                  <GamePhoto photo={photo} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <GamePhoto photo={target} />
        )}
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
          {puzzle.banned.length ? (
            <p className={captionStyles.banned}>
              Without{" "}
              {puzzle.banned.map((word, index) => (
                <span key={word}>
                  {index ? ", " : ""}
                  <strong>{word}</strong>
                </span>
              ))}
            </p>
          ) : null}
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
            {puzzle.words === null
              ? `${draft.length} / ${MAX_CAPTION_LENGTH}`
              : `${wordCount} / ${puzzle.words} words`}
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
              {againLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
