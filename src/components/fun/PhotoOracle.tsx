import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import {
  answerOracle,
  chooseOracleQuestion,
  buildOracleCohort,
  shuffleGamePhotos,
  oracleDiscoveryQuestion,
  oracleDiscoveryCandidates,
  taggedOracleQuestions,
  ORACLE_QUESTIONS,
  type OracleCandidate,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { GamePhoto } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import styles from "./PhotoGames.module.css";

export const PhotoOracle = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [mode, setMode] = useState<"mind" | "discover">("mind");
  const [cohort, setCohort] = useState<PhotoGamePhoto[]>([]);
  const [secret, setSecret] = useState<PhotoGamePhoto | null>(null);
  const [stage, setStage] = useState<"lobby" | "choose" | "remember" | "questions" | "finished">(
    "lobby",
  );
  const [candidates, setCandidates] = useState<OracleCandidate[]>([]);
  const [answers, setAnswers] = useState<
    Array<{ id: string; question: string; answer: "yes" | "no" | "unsure" }>
  >([]);
  const [confirmed, setConfirmed] = useState<PhotoGamePhoto | null>(null);
  const [history, setHistory] = useState<
    Array<{ candidates: OracleCandidate[]; answers: typeof answers }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(() => photos.filter((photo) => photo.caption || photo.tags), [photos]);
  const questions = useMemo(
    () => [...ORACLE_QUESTIONS, ...taggedOracleQuestions(eligible)],
    [eligible],
  );
  const start = (nextMode: "mind" | "discover" = mode) => {
    const selection =
      nextMode === "mind"
        ? buildOracleCohort(eligible)
        : shuffleGamePhotos([...new Map(eligible.map((photo) => [photo.path, photo])).values()]);
    if (selection.length < 2) {
      setError("These photographs are too alike for the oracle's questions.");
      return;
    }
    setMode(nextMode);
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
  const gameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage !== "lobby") gameRef.current?.focus();
  }, [stage, isGuess, candidates.length]);
  if (eligible.length < 2)
    return <p>Photo Oracle needs at least two photographs with captions or tags.</p>;
  if (stage === "lobby")
    return (
      <GameIntro game="oracle">
        {error ? <p role="alert">{error}</p> : null}
        <p>
          Choose a photograph and keep it in mind. Answer visual questions while the oracle tries to
          find it.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => start("mind")}>
            Meet the oracle
          </Button>
          <Button onClick={() => start("discover")}>Find me a photograph</Button>
        </div>
        <Caption>
          Discovery follows your preferences until one photograph remains, or the archive cannot
          distinguish the remaining matches.
        </Caption>
      </GameIntro>
    );
  return (
    <div className={styles.game} ref={gameRef} tabIndex={-1}>
      {stage === "choose" ? (
        <>
          <Heading level={1}>Choose a photograph to remember</Heading>
          <div className={styles.choices}>
            {cohort.map((photo, index) => (
              <button
                key={photo.path}
                type="button"
                className={styles.choice}
                aria-label={`Remember photograph ${index + 1}`}
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
        </>
      ) : null}
      {stage === "remember" && secret ? (
        <>
          <figure className={`${styles.frame} ${styles.secret}`}>
            <GamePhoto photo={secret} />
            <figcaption>Keep this photograph in mind.</figcaption>
          </figure>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setStage("questions")}>
              I have my photograph
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
            <>
              <Heading level={1}>
                {mode === "mind" ? "Is this your photograph?" : "A photograph for you"}
              </Heading>
              {mode === "discover" && candidates.length > 1 ? (
                <p role="status">
                  Your answers leave {candidates.length} matches. No further questions can separate
                  them; browse the matches or go back to change an answer.
                </p>
              ) : null}
              <div className={styles.secret}>
                <GamePhoto photo={top.photo} />
              </div>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setConfirmed(top.photo);
                    setStage("finished");
                  }}
                >
                  {mode === "mind" ? "That's it" : "Keep this one"}
                </Button>
                <Button
                  disabled={candidates.length <= 1}
                  onClick={() => {
                    setHistory([...history, { candidates, answers }]);
                    setCandidates(candidates.filter((item) => item.photo.path !== top.photo.path));
                  }}
                >
                  {mode === "mind" ? "Not this one" : "Another match"}
                </Button>
              </div>
            </>
          ) : question ? (
            <>
              <Caption>
                Question {answers.length + 1} · {candidates.length} possible photographs
              </Caption>
              <p className={styles.question} role="status">
                {mode === "mind" ? question.label : oracleDiscoveryQuestion(question)}
              </p>
              <div className={styles.actions}>
                {(["yes", "no", "unsure"] as const).map((answer) => (
                  <Button
                    key={answer}
                    variant={answer === "unsure" ? "quiet" : "surface"}
                    onClick={() => {
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
                          question:
                            mode === "mind" ? question.label : oracleDiscoveryQuestion(question),
                          answer,
                        },
                      ]);
                    }}
                  >
                    {answer === "yes" ? "Yes" : answer === "no" ? "No" : "Not sure"}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p>No candidates left. Reveal the photograph or start again.</p>
          )}
          <div className={styles.actions}>
            <Button
              disabled={!history.length}
              onClick={() => {
                const previous = history.at(-1)!;
                setCandidates(previous.candidates);
                setAnswers(previous.answers);
                setHistory(history.slice(0, -1));
              }}
            >
              Back
            </Button>
            <Button
              variant="quiet"
              disabled={mode === "discover" && !top}
              onClick={() => {
                if (mode === "discover" && top) setConfirmed(top.photo);
                setStage("finished");
              }}
            >
              {mode === "mind" ? "Give up" : "Show a match now"}
            </Button>
          </div>
        </>
      ) : null}
      {stage === "finished" && (secret || confirmed) ? (
        <div className={styles.result} role="region" aria-label="Oracle result">
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
          {answers.length ? (
            <details>
              <summary>The oracle&apos;s questions</summary>
              <ol>
                {answers.map((answer) => (
                  <li key={answer.id}>
                    {answer.question} —{" "}
                    {answer.answer === "unsure"
                      ? "Not sure"
                      : answer.answer === "yes"
                        ? "Yes"
                        : "No"}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <Button variant="primary" onClick={() => start()}>
            Play again
          </Button>
          <Button variant="quiet" onClick={() => setStage("lobby")}>
            Change mode
          </Button>
        </div>
      ) : null}
    </div>
  );
};
