import { useEffect, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import {
  buildRelayPuzzle,
  scoreRelay,
  type PhotoGamePhoto,
  type RelayPuzzle,
} from "../../util/photoGames";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import styles from "./PhotoGames.module.css";

export const PhotoRelay = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [puzzle, setPuzzle] = useState<RelayPuzzle | null>(null);
  const [order, setOrder] = useState<PhotoGamePhoto[]>([]);
  const [finished, setFinished] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finished) resultRef.current?.focus();
    else if (puzzle) boardRef.current?.focus();
  }, [finished, puzzle]);
  const start = () => {
    setPuzzle(buildRelayPuzzle(photos));
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
              <Caption as="span">Start</Caption>
              <GamePhoto photo={puzzle.start} />
            </figure>
            <figure className={styles.frame}>
              <Caption as="span">Finish</Caption>
              <GamePhoto photo={puzzle.end} />
            </figure>
          </div>
          <p role="status">{order.length} of 5 links placed</p>
          {order.length > 0 ? <PhotoChain photos={order} /> : null}
          <div className={styles.choices}>
            {puzzle.tiles.map((photo, index) => {
              const position = order.findIndex((item) => item.path === photo.path);
              return (
                <button
                  type="button"
                  key={photo.path}
                  className={styles.choice}
                  aria-label={`Choose photograph ${index + 1}`}
                  disabled={position >= 0}
                  onClick={() => {
                    const next = [...order, photo];
                    setOrder(next);
                    if (next.length === 5) finish(false);
                  }}
                >
                  <GamePhoto photo={photo} />
                  <span>{position >= 0 ? `Link ${position + 1}` : `Photograph ${index + 1}`}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setOrder(order.slice(0, -1))} disabled={!order.length}>
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
          {!gaveUp ? (
            <p className={styles.score}>Visual flow: {scoreRelay(puzzle, order)} / 100</p>
          ) : null}
          <PhotoChain photos={[puzzle.start, ...(gaveUp ? puzzle.solution : order), puzzle.end]} />
          {!gaveUp ? (
            <>
              <Caption>Scored by visual similarity between neighbouring photographs.</Caption>
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
