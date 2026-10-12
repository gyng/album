import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import {
  answerOracle,
  chooseOracleQuestion,
  shuffleGamePhotos,
  type OracleCandidate,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { GamePhoto } from "./GamePhoto";
import styles from "./PhotoGames.module.css";

export const PhotoOracle = ({ photos }: { photos: PhotoGamePhoto[] }) => {
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
  const eligible = photos.filter((photo) => photo.caption || photo.tags);
  const start = () => {
    const selection = shuffleGamePhotos(eligible).slice(0, 12);
    setCohort(selection);
    setSecret(null);
    setCandidates(selection.map((photo) => ({ photo, weight: 1 / selection.length })));
    setAnswers([]);
    setConfirmed(null);
    setStage("choose");
  };
  const question = chooseOracleQuestion(
    candidates,
    answers.map((answer) => answer.id),
  );
  const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  const isGuess = !question || answers.length >= 8 || (top && top.weight / total >= 0.85);
  const gameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage !== "lobby") gameRef.current?.focus();
  }, [stage, isGuess, candidates.length]);
  if (eligible.length < 2)
    return <p>Photo Oracle needs at least two photographs with captions or tags.</p>;
  if (stage === "lobby")
    return (
      <div className={styles.game}>
        <p>
          Choose a photograph and keep it in mind. Answer visual questions while the oracle tries to
          find it.
        </p>
        <Button variant="primary" onClick={start}>
          Meet the oracle
        </Button>
      </div>
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
          {isGuess && top ? (
            <>
              <Heading level={1}>Is this your photograph?</Heading>
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
                  That&apos;s it
                </Button>
                <Button
                  onClick={() =>
                    setCandidates(candidates.filter((item) => item.photo.path !== top.photo.path))
                  }
                >
                  Not this one
                </Button>
              </div>
            </>
          ) : question ? (
            <>
              <Caption>
                Question {answers.length + 1} · {candidates.length} possible photographs
              </Caption>
              <p className={styles.question} role="status">
                {question.label}
              </p>
              <div className={styles.actions}>
                {(["yes", "no", "unsure"] as const).map((answer) => (
                  <Button
                    key={answer}
                    variant={answer === "unsure" ? "quiet" : "surface"}
                    onClick={() => {
                      setCandidates(answerOracle(candidates, question, answer));
                      setAnswers([
                        ...answers,
                        { id: question.id, question: question.label, answer },
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
          <Button variant="quiet" onClick={() => setStage("finished")}>
            Give up
          </Button>
        </>
      ) : null}
      {stage === "finished" && secret ? (
        <div className={styles.result} role="region" aria-label="Oracle result">
          <Heading level={1}>
            {confirmed ? "A frame of mind, found" : "The photograph in mind"}
          </Heading>
          <div className={styles.secret}>
            <GamePhoto photo={confirmed ?? secret} link />
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
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
        </div>
      ) : null}
    </div>
  );
};
