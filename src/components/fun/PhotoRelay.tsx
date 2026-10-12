import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import {
  buildRelayPuzzle,
  scoreRelay,
  relayLinkSimilarities,
  type PhotoGamePhoto,
  type RelayPuzzle,
} from "../../util/photoGames";
import { GameProgress, GameScore } from "./GameFeedback";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import styles from "./PhotoGames.module.css";

export const PhotoRelay = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<RelayPuzzle | null>(null);
  const [order, setOrder] = useState<PhotoGamePhoto[]>([]);
  const [finished, setFinished] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
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
    setDragged(null);
  };
  const finish = (abandoned: boolean) => {
    setFinished(true);
    setGaveUp(abandoned);
  };
  if (photos.length < 7)
    return <p>Photo Relay needs at least seven indexed photographs with image similarity data.</p>;
  if (!puzzle)
    return (
      <GameIntro game="relay">
        {error ? <p role="alert">{error}</p> : null}
        <p>
          Arrange five photographs between a start and a finish. Aim for a smooth visual change from
          one frame to the next.
        </p>
        <Button variant="primary" onClick={start}>
          Start relay
        </Button>
      </GameIntro>
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
              // Native drag/drop supplements the move and remove buttons below.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={index}
                data-filled={!!order[index]}
                data-drop-active={!!dragged}
                onDragOver={(event) => {
                  if (dragged) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const path = event.dataTransfer.getData("text/plain");
                  const photo = puzzle.tiles.find((tile) => tile.path === path);
                  if (!photo) return;
                  const next = order.filter((item) => item.path !== path);
                  next.splice(Math.min(index, next.length), 0, photo);
                  setOrder(next);
                  setDragged(null);
                }}
              >
                {order[index] ? (
                  <div
                    className={styles.dragFrame}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", order[index]!.path);
                      event.dataTransfer.effectAllowed = "move";
                      setDragged(order[index]!.path);
                    }}
                    onDragEnd={() => setDragged(null)}
                  >
                    <GamePhoto photo={order[index]!} />
                  </div>
                ) : (
                  <span>{index + 1}</span>
                )}
                {order[index] ? (
                  <div className={styles.slotActions}>
                    <Button
                      variant="quiet"
                      aria-label={`Move link ${index + 1} earlier`}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...order];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        setOrder(next);
                      }}
                    >
                      ←
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={`Remove link ${index + 1}`}
                      onClick={(event) => {
                        if (event.detail === 0)
                          requestedFocus.current = { path: order[index]!.path };
                        setOrder(order.filter((_, position) => position !== index));
                      }}
                    >
                      ×
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={`Move link ${index + 1} later`}
                      disabled={index === order.length - 1}
                      onClick={() => {
                        const next = [...order];
                        [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                        setOrder(next);
                      }}
                    >
                      →
                    </Button>
                  </div>
                ) : null}
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
                  draggable={position < 0}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", photo.path);
                    event.dataTransfer.effectAllowed = "move";
                    setDragged(photo.path);
                  }}
                  onDragEnd={() => setDragged(null)}
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
          <PhotoChain
            photos={[puzzle.start, ...(gaveUp ? puzzle.solution : order), puzzle.end]}
            similarities={relayLinkSimilarities([
              puzzle.start,
              ...(gaveUp ? puzzle.solution : order),
              puzzle.end,
            ])}
          />
          {!gaveUp ? (
            <>
              <Caption>
                Your route’s rank among all 120 possible orders. Link percentages show cosine
                similarity between image embeddings.
              </Caption>
              <details>
                <summary>Compare the suggested route</summary>
                <PhotoChain
                  photos={[puzzle.start, ...puzzle.solution, puzzle.end]}
                  similarities={relayLinkSimilarities([
                    puzzle.start,
                    ...puzzle.solution,
                    puzzle.end,
                  ])}
                />
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
