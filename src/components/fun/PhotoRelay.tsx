import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import {
  buildRelayPuzzle,
  scoreRelay,
  type PhotoGamePhoto,
  type RelayPuzzle,
} from "../../util/photoGames";
import { GameProgress, GameScore } from "./GameFeedback";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import styles from "./PhotoGames.module.css";

export const PhotoRelay = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<RelayPuzzle | null>(null);
  const [order, setOrder] = useState<PhotoGamePhoto[]>([]);
  const [finished, setFinished] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const choiceRefs = useRef(new Map<string, HTMLButtonElement>());
  const finishRef = useRef<HTMLButtonElement>(null);
  const requestedFocus = useRef<{ path: string } | { finish: true } | null>(null);
  useEffect(() => {
    const request = requestedFocus.current;
    if (!request) return;
    requestedFocus.current = null;
    if ("finish" in request) finishRef.current?.focus();
    else choiceRefs.current.get(request.path)?.focus();
  }, [order]);
  useEffect(() => {
    if (finished) resultRef.current?.focus();
    else if (puzzle) boardRef.current?.focus();
  }, [finished, puzzle]);
  const start = () => {
    const next = buildRelayPuzzle(photos);
    setError(next ? null : "There aren't enough comparable photographs for a relay.");
    setPuzzle(next);
    setOrder([]);
    setFinished(false);
    setGaveUp(false);
  };
  const finish = (abandoned: boolean) => {
    setFinished(true);
    setGaveUp(abandoned);
  };
  if (photos.length < 7)
    return <p>Photo Relay needs at least seven indexed photographs with image similarity data.</p>;
  if (!puzzle)
    return (
      <div className={styles.game}>
        {error ? <p role="alert">{error}</p> : null}
        <p>
          Arrange five photographs between a start and a finish. Aim for a smooth visual change from
          one frame to the next.
        </p>
        <Button variant="primary" onClick={start}>
          Start relay
        </Button>
      </div>
    );
  return (
    <div className={styles.game}>
      {!finished ? (
        <>
          <div className={styles.endpoints} ref={boardRef} tabIndex={-1}>
            <figure className={styles.frame}>
              <Caption as="figcaption">Start</Caption>
              <GamePhoto photo={puzzle.start} />
            </figure>
            <figure className={styles.frame}>
              <Caption as="figcaption">Finish</Caption>
              <GamePhoto photo={puzzle.end} />
            </figure>
          </div>
          <div className={styles.roundProgress}>
            <p role="status">{order.length} of 5 links placed</p>
            <GameProgress current={order.length} total={5} />
          </div>
          <ol className={styles.relaySlots} aria-label="Your relay links">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} data-filled={!!order[index]}>
                {order[index] ? <GamePhoto photo={order[index]!} /> : <span>{index + 1}</span>}
              </li>
            ))}
          </ol>
          <div className={styles.choices}>
            {puzzle.tiles.map((photo, index) => {
              const position = order.findIndex((item) => item.path === photo.path);
              return (
                <button
                  type="button"
                  key={photo.path}
                  className={styles.choice}
                  aria-label={`Choose photograph ${index + 1}`}
                  ref={(element) => {
                    if (element) choiceRefs.current.set(photo.path, element);
                    else choiceRefs.current.delete(photo.path);
                  }}
                  aria-pressed={position >= 0}
                  disabled={position >= 0}
                  onClick={(event) => {
                    const next = [...order, photo];
                    if (event.detail === 0) {
                      const available = puzzle.tiles.find(
                        (tile) => !next.some((item) => item.path === tile.path),
                      );
                      requestedFocus.current = available
                        ? { path: available.path }
                        : { finish: true };
                    }
                    setOrder(next);
                  }}
                >
                  <GamePhoto photo={photo} />
                  <span>{position >= 0 ? `Link ${position + 1}` : `Photograph ${index + 1}`}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <Button
              ref={finishRef}
              variant="primary"
              disabled={order.length !== 5}
              onClick={() => finish(false)}
            >
              Finish relay
            </Button>
            <Button
              onClick={(event) => {
                const previous = order.at(-1);
                if (event.detail === 0 && previous)
                  requestedFocus.current = { path: previous.path };
                setOrder(order.slice(0, -1));
              }}
              disabled={!order.length}
            >
              Undo last link
            </Button>
            <Button variant="quiet" onClick={() => finish(true)}>
              Give up
            </Button>
          </div>
        </>
      ) : (
        <div
          className={styles.result}
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Relay result"
        >
          <Heading level={1}>{gaveUp ? "The suggested route" : "Your relay"}</Heading>
          {!gaveUp ? <GameScore label="Visual flow" score={scoreRelay(puzzle, order)} /> : null}
          <PhotoChain photos={[puzzle.start, ...(gaveUp ? puzzle.solution : order), puzzle.end]} />
          {!gaveUp ? (
            <>
              <Caption>
                Your route’s rank among all 120 possible orders, using similarity between
                neighbouring photographs.
              </Caption>
              <details>
                <summary>Compare the suggested route</summary>
                <PhotoChain photos={[puzzle.start, ...puzzle.solution, puzzle.end]} />
              </details>
            </>
          ) : null}
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
        </div>
      )}
    </div>
  );
};
