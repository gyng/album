import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Caption, Heading, KeyHint } from "../ui";
import {
  answerOracle,
  chooseOracleQuestion,
  buildOracleCohort,
  shuffleGamePhotos,
  oracleDiscoveryQuestion,
  oracleDiscoveryCandidates,
  oracleQuestionsFor,
  type OracleCandidate,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { GamePhoto } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import { useGameSettings } from "./useGameSettings";
import styles from "./PhotoGames.module.css";
import oracleStyles from "./PhotoOracle.module.css";
import { useGameReadiness } from "./GameReadiness";
import { useGameShortcuts } from "./useGameShortcuts";
import { useGameStats } from "./useGameStats";
import { GameStatsLine } from "./GameRecord";
import { ResultNextSteps } from "./ResultNextSteps";

type OracleAnswer = { id: string; question: string; answer: "yes" | "no" | "unsure" };

const answerLabel = (answer: OracleAnswer["answer"]) =>
  answer === "yes" ? "Yes" : answer === "no" ? "No" : "Not sure";

const AnswerTrail = ({ answers }: { answers: OracleAnswer[] }) => {
  if (!answers.length) return null;
  return (
    <section className={oracleStyles.trail} aria-label="Your answers">
      <h2 className={oracleStyles.trailHeading}>Your answers</h2>
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Preserve Safari list semantics when CSS hides the markers. */}
      <ol className={oracleStyles.trailList} role="list" reversed start={answers.length}>
        {[...answers].reverse().map((answer, index) => (
          <li key={answer.id} className={oracleStyles.trailRow}>
            <span className={oracleStyles.number} aria-hidden="true">
              {answers.length - index}
            </span>
            <span className={oracleStyles.trailQuestion}>{answer.question}</span>
            <span
              className={[
                oracleStyles.badge,
                answer.answer === "yes"
                  ? oracleStyles.yes
                  : answer.answer === "no"
                    ? oracleStyles.no
                    : oracleStyles.unsure,
              ].join(" ")}
            >
              {answerLabel(answer.answer)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const PhotoOracle = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const { loading } = useGameReadiness();
  const { stats, record } = useGameStats("oracle");
  const [settings, setSettings] = useGameSettings("oracle");
  const { mode } = settings;
  const [cohort, setCohort] = useState<PhotoGamePhoto[]>([]);
  const [secret, setSecret] = useState<PhotoGamePhoto | null>(null);
  const [stage, setStage] = useState<"lobby" | "choose" | "remember" | "questions" | "finished">(
    "lobby",
  );
  const [candidates, setCandidates] = useState<OracleCandidate[]>([]);
  const [answers, setAnswers] = useState<OracleAnswer[]>([]);
  const [confirmed, setConfirmed] = useState<PhotoGamePhoto | null>(null);
  const [history, setHistory] = useState<
    Array<{ candidates: OracleCandidate[]; answers: typeof answers }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(() => photos.filter((photo) => photo.caption || photo.tags), [photos]);
  const questions = useMemo(() => oracleQuestionsFor(eligible), [eligible]);
  const start = (nextMode: "mind" | "discover" = mode) => {
    const selection =
      nextMode === "mind"
        ? buildOracleCohort(eligible)
        : shuffleGamePhotos([...new Map(eligible.map((photo) => [photo.path, photo])).values()]);
    if (selection.length < 2) {
      setError("These photographs are too alike. The oracle needs more variety.");
      return;
    }
    setSettings({ mode: nextMode });
    setError(null);
    setCohort(selection);
    setSecret(null);
    setCandidates(selection.map((photo) => ({ photo, weight: 1 / selection.length })));
    setAnswers([]);
    setConfirmed(null);
    setHistory([]);
    setStage(nextMode === "mind" ? "choose" : "questions");
  };
  const question = chooseOracleQuestion(
    candidates,
    answers.map((answer) => answer.id),
    questions,
  );
  const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  const isGuess =
    !question || candidates.length === 1 || (mode === "mind" && top && top.weight / total >= 0.85);
  // Each view names its own focus target. A new question only changes the
  // persistent status text, so focus stays on the answer the player chose.
  const focusRef = useRef<HTMLElement | null>(null);
  const focusTarget = (element: HTMLElement | null) => {
    focusRef.current = element;
  };
  const matchesNoteId = useId();
  const hasQuestion = Boolean(question);
  const hasTop = Boolean(top);
  useEffect(() => {
    if (stage !== "lobby") focusRef.current?.focus();
  }, [stage, isGuess, hasQuestion, hasTop]);
  const handleAnswer = (answer: "yes" | "no" | "unsure") => {
    if (stage !== "questions" || !question || isGuess) return;
    setHistory([...history, { candidates, answers }]);
    setCandidates(
      mode === "discover"
        ? oracleDiscoveryCandidates(candidates, question, answer)
        : answerOracle(candidates, question, answer),
    );
    setAnswers([
      ...answers,
      {
        id: question.id,
        question: mode === "mind" ? question.label : oracleDiscoveryQuestion(question),
        answer,
      },
    ]);
  };
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setCandidates(previous.candidates);
    setAnswers(previous.answers);
    setHistory(history.slice(0, -1));
  };
  // Neither mode has a player win or a score, so a finished round only counts
  // towards games played and the streak.
  const finishRound = (photo: PhotoGamePhoto | null) => {
    if (stage === "finished") return;
    if (photo) setConfirmed(photo);
    record({ won: false });
    setStage("finished");
  };
  const keep = () => {
    if (!top) return;
    finishRound(top.photo);
  };
  const another = () => {
    if (!top || candidates.length <= 1) return;
    setHistory([...history, { candidates, answers }]);
    setCandidates(candidates.filter((item) => item.photo.path !== top.photo.path));
  };
  const shortcuts = [
    {
      key: "N",
      label: "New round",
      action: () => start(mode),
      enabled: stage === "lobby" || stage === "finished",
    },
    {
      key: "1",
      label: isGuess ? "Keep this photograph" : "Yes",
      action: () => (isGuess ? keep() : handleAnswer("yes")),
      enabled: stage === "questions" && Boolean(isGuess ? top : question),
    },
    {
      key: "2",
      label: isGuess ? "Another photograph" : "No",
      action: () => (isGuess ? another() : handleAnswer("no")),
      enabled: stage === "questions" && Boolean(isGuess ? top && candidates.length > 1 : question),
    },
    {
      key: "3",
      label: "Not sure",
      action: () => handleAnswer("unsure"),
      enabled: stage === "questions" && !isGuess && Boolean(question),
    },
    {
      key: "B",
      label: "Previous answer",
      action: back,
      enabled: stage === "questions" && history.length > 0,
    },
    {
      key: "Space",
      label: "I have my photograph",
      action: () => setStage("questions"),
      enabled: stage === "remember",
    },
  ];
  useGameShortcuts(shortcuts);
  if (!loading && eligible.length < 2)
    return <p>The oracle needs more photographs. Try another game.</p>;
  if (stage === "lobby")
    return (
      <GameIntro game="oracle">
        {error ? <p role="alert">{error}</p> : null}
        <p>
          {mode === "discover"
            ? "Answer a few questions. Find a photograph that suits your mood."
            : "Choose a photograph. Can the oracle read your mind?"}
        </p>
        <GameStatsLine stats={stats} wins={false} best={null} />
        <div className={styles.actions}>
          <Button
            variant={mode === "mind" ? "primary" : "surface"}
            aria-pressed={mode === "mind"}
            onClick={() => start("mind")}
          >
            Meet the oracle
            {mode === "mind" ? <KeyHint aria-hidden="true">N</KeyHint> : null}
          </Button>
          <Button
            variant={mode === "discover" ? "primary" : "surface"}
            aria-pressed={mode === "discover"}
            onClick={() => start("discover")}
          >
            Find me a photograph
            {mode === "discover" ? <KeyHint aria-hidden="true">N</KeyHint> : null}
          </Button>
        </div>
      </GameIntro>
    );
  return (
    <div className={styles.game}>
      {stage === "choose" ? (
        <section
          ref={focusTarget}
          tabIndex={-1}
          aria-label="Choose a photograph to remember"
          className={styles.game}
        >
          <Heading level={1}>Choose a photograph to remember</Heading>
          <div className={styles.choices}>
            {cohort.map((photo, index) => (
              <button
                key={photo.path}
                type="button"
                className={styles.choice}
                onClick={() => {
                  setSecret(photo);
                  setStage("remember");
                }}
              >
                <GamePhoto photo={photo} />
                <span>Photograph {index + 1}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {stage === "remember" && secret ? (
        <>
          <figure ref={focusTarget} tabIndex={-1} className={`${styles.frame} ${styles.secret}`}>
            <GamePhoto photo={secret} />
            <figcaption>Keep this photograph in mind.</figcaption>
          </figure>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setStage("questions")}>
              I have my photograph
              <KeyHint aria-hidden="true">Space</KeyHint>
            </Button>
            <Button variant="quiet" onClick={() => setStage("choose")}>
              Choose another
            </Button>
          </div>
        </>
      ) : null}
      {stage === "questions" ? (
        <>
          <div className={styles.roundProgress}>
            <Caption>
              {answers.length} {answers.length === 1 ? "question" : "questions"} answered ·{" "}
              {candidates.length} {candidates.length === 1 ? "photograph" : "photographs"} remaining
            </Caption>
          </div>
          {isGuess && top ? (
            <section
              ref={focusTarget}
              tabIndex={-1}
              className={styles.game}
              aria-label={mode === "mind" ? "Is this your photograph?" : "A photograph for you"}
              {...(mode === "discover" && candidates.length > 1
                ? { "aria-describedby": matchesNoteId }
                : {})}
            >
              <Heading level={1}>
                {mode === "mind" ? "Is this your photograph?" : "A photograph for you"}
              </Heading>
              {mode === "discover" && candidates.length > 1 ? (
                <p id={matchesNoteId}>
                  {candidates.length} matches remain. The oracle has run out of questions. Choose a
                  match, or change an answer.
                </p>
              ) : null}
              <div className={styles.secret}>
                <GamePhoto photo={top.photo} />
              </div>
              <div className={styles.actions}>
                <Button variant="primary" onClick={keep}>
                  {mode === "mind" ? "That's it" : "Keep this one"}
                  <KeyHint aria-hidden="true">1</KeyHint>
                </Button>
                <Button disabled={candidates.length <= 1} onClick={another}>
                  {mode === "mind" ? "Not this one" : "Another match"}
                  <KeyHint aria-hidden="true">2</KeyHint>
                </Button>
              </div>
            </section>
          ) : question ? (
            <div className={oracleStyles.currentQuestion}>
              <Caption>Question {answers.length + 1}</Caption>
              <p className={styles.question} role="status" ref={focusTarget} tabIndex={-1}>
                <span key={question.id} className={oracleStyles.questionText}>
                  {mode === "mind" ? question.label : oracleDiscoveryQuestion(question)}
                </span>
              </p>
              <div className={styles.actions}>
                {(["yes", "no", "unsure"] as const).map((answer) => (
                  <Button
                    key={answer}
                    variant={answer === "unsure" ? "quiet" : "surface"}
                    onClick={() => handleAnswer(answer)}
                  >
                    {answer === "yes" ? "Yes" : answer === "no" ? "No" : "Not sure"}
                    <KeyHint aria-hidden="true">
                      {answer === "yes" ? "1" : answer === "no" ? "2" : "3"}
                    </KeyHint>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p ref={focusTarget} tabIndex={-1}>
              No photographs match. Reveal the answer, or start again.
            </p>
          )}
          <div className={styles.actions}>
            <Button disabled={!history.length} onClick={back}>
              Back
              <KeyHint aria-hidden="true">B</KeyHint>
            </Button>
            <Button
              variant="quiet"
              disabled={mode === "discover" && !top}
              onClick={() => finishRound(mode === "discover" && top ? top.photo : null)}
            >
              {mode === "mind" ? "Give up" : "Show a match now"}
            </Button>
          </div>

          <AnswerTrail answers={answers} />
        </>
      ) : null}
      {stage === "finished" && (secret || confirmed) ? (
        <div
          className={styles.result}
          ref={focusTarget}
          tabIndex={-1}
          role="region"
          aria-label="Oracle result"
        >
          <Heading level={1}>
            {mode === "discover"
              ? "Your discovery"
              : confirmed
                ? "A frame of mind, found"
                : "The photograph in mind"}
          </Heading>
          <div className={styles.secret}>
            <GamePhoto photo={(confirmed ?? secret)!} link />
          </div>
          <Caption>
            {answers.length} {answers.length === 1 ? "question" : "questions"} answered
          </Caption>
          <AnswerTrail answers={answers} />
          <ResultNextSteps photos={[(confirmed ?? secret)!]} />
          <Button variant="primary" onClick={() => start()}>
            Play again
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
          <Button variant="quiet" onClick={() => setStage("lobby")}>
            Change mode
          </Button>
        </div>
      ) : null}
    </div>
  );
};
