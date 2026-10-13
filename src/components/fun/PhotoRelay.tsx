import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Caption, Heading, KeyHint } from "../ui";
import {
  buildRelayPuzzle,
  scoreRelay,
  relayLinkSimilarities,
  type PhotoGamePhoto,
  type RelayPuzzle,
} from "../../util/photoGames";
import { describeRelayLinks } from "../../util/photoRelay";
import { GameProgress, GameScore } from "./GameFeedback";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import { useGameReadiness } from "./GameReadiness";
import { GameDock } from "./GameDock";
import styles from "./PhotoGames.module.css";
import relayStyles from "./PhotoRelay.module.css";
import { useGameShortcuts } from "./useGameShortcuts";

export const PhotoRelay = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const { loading } = useGameReadiness();
  const [puzzle, setPuzzle] = useState<RelayPuzzle | null>(null);
  const [order, setOrder] = useState<PhotoGamePhoto[]>([]);
  const [finished, setFinished] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const activeDrag = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLOListElement>(null);
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
  const cancelDrag = () => {
    activeDrag.current = null;
    setDragged(null);
    setDropTarget(null);
  };
  const beginDrag = (event: DragEvent<HTMLElement>, path: string) => {
    activeDrag.current = path;
    event.dataTransfer.setData("text/plain", path);
    event.dataTransfer.effectAllowed = "move";
    setDragged(path);
    setDropTarget(null);
  };
  const start = () => {
    const next = buildRelayPuzzle(photos);
    setError(next ? null : "There aren't enough comparable photographs for a relay.");
    setPuzzle(next);
    setOrder([]);
    setFinished(false);
    setGaveUp(false);
    cancelDrag();
  };
  const finish = (abandoned: boolean) => {
    cancelDrag();
    setFinished(true);
    setGaveUp(abandoned);
  };
  const shortcuts = [
    { key: "Escape", label: "Cancel drag", action: cancelDrag, enabled: !!dragged },
    {
      key: "Enter",
      label: "Finish relay",
      action: () => finish(false),
      enabled: !!puzzle && !finished && order.length === 5,
    },
    { key: "g", label: "Give up", action: () => finish(true), enabled: !!puzzle && !finished },
    {
      key: "n",
      label: puzzle ? "Play again" : "Start relay",
      action: start,
      enabled: !puzzle || finished,
    },
  ];
  useGameShortcuts(shortcuts, photos.length >= 7);
  useEffect(() => {
    const clear = () => {
      activeDrag.current = null;
      setDragged(null);
      setDropTarget(null);
    };
    window.addEventListener("blur", clear);
    return () => window.removeEventListener("blur", clear);
  }, []);
  if (!loading && photos.length < 7)
    return <p>There are not enough photographs ready for a relay yet.</p>;
  if (!puzzle)
    return (
      <GameIntro game="relay">
        {error ? <p role="alert">{error}</p> : null}
        <p>
          Connect the start and finish with five photographs. Make each pair share a subject, colour
          or shape.
        </p>
        <Button variant="primary" onClick={start}>
          Start relay
          <KeyHint aria-hidden="true">N</KeyHint>
        </Button>
      </GameIntro>
    );
  return (
    <div className={styles.game}>
      {!finished ? (
        <>
          <Caption>
            Aim for small visual changes between neighbours. Your score covers the whole chain.
          </Caption>
          <div className={relayStyles.workspace}>
            <div className={relayStyles.board}>
              <div
                className={[styles.endpoints, relayStyles.endpoints].join(" ")}
                ref={boardRef}
                tabIndex={-1}
              >
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
              <ol
                className={[styles.relaySlots, relayStyles.slots].join(" ")}
                aria-label="Your relay links"
                ref={slotsRef}
              >
                {Array.from({ length: 5 }, (_, index) => (
                  // Native drag/drop supplements the move and remove buttons below.
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                  <li
                    key={index}
                    data-filled={!!order[index]}
                    data-drop-active={!!dragged}
                    data-drop-hover={dropTarget === index}
                    data-dragging={order[index]?.path === dragged}
                    onDragOver={(event) => {
                      if (!activeDrag.current) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(index);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setDropTarget((current) => (current === index ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const path = event.dataTransfer.getData("text/plain");
                      const photo =
                        path === activeDrag.current
                          ? puzzle.tiles.find((tile) => tile.path === path)
                          : null;
                      cancelDrag();
                      if (!photo) return;
                      const next = order.filter((item) => item.path !== path);
                      next.splice(Math.min(index, next.length), 0, photo);
                      setOrder(next);
                    }}
                  >
                    {order[index] ? (
                      <div
                        className={styles.dragFrame}
                        draggable
                        onDragStart={(event) => beginDrag(event, order[index]!.path)}
                        onDragEnd={cancelDrag}
                      >
                        <GamePhoto photo={order[index]!} />
                      </div>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                    {order[index] ? (
                      <div className={[styles.slotActions, relayStyles.slotActions].join(" ")}>
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
            </div>
            <GameDock
              {...(relayStyles.reference ? { className: relayStyles.reference } : {})}
              label="Relay reference"
            >
              <ol className={relayStyles.miniChain} aria-hidden="true">
                {[
                  puzzle.start,
                  ...Array.from({ length: 5 }, (_, index) => order[index] ?? null),
                  puzzle.end,
                ].map((photo, index) => (
                  <li key={index}>
                    <span>{index === 0 ? "Start" : index === 6 ? "Finish" : index}</span>
                    {photo ? (
                      <GamePhoto photo={photo} />
                    ) : (
                      <span className={relayStyles.empty}>·</span>
                    )}
                  </li>
                ))}
              </ol>
              <div className={relayStyles.referenceActions}>
                <Caption size="sm">{order.length} / 5 links</Caption>
                <Button
                  disabled={!order.length}
                  onClick={(event) => {
                    const control =
                      slotsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                    control?.scrollIntoView({
                      block: "center",
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "auto"
                        : "smooth",
                    });
                    if (event.detail === 0) control?.focus({ preventScroll: true });
                  }}
                >
                  Edit links
                </Button>
              </div>
            </GameDock>
            <div className={relayStyles.tray}>
              <div className={[styles.choices, relayStyles.choices].join(" ")}>
                {puzzle.tiles.map((photo, index) => {
                  const position = order.findIndex((item) => item.path === photo.path);
                  return (
                    <button
                      type="button"
                      key={photo.path}
                      className={[styles.choice, relayStyles.choice].join(" ")}
                      data-dragging={dragged === photo.path}
                      aria-label={`Choose photograph ${index + 1}`}
                      ref={(element) => {
                        if (element) choiceRefs.current.set(photo.path, element);
                        else choiceRefs.current.delete(photo.path);
                      }}
                      aria-pressed={position >= 0}
                      draggable={position < 0}
                      onDragStart={(event) => beginDrag(event, photo.path)}
                      onDragEnd={cancelDrag}
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
                      <span>
                        {position >= 0 ? `Link ${position + 1}` : `Photograph ${index + 1}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <Button
              ref={finishRef}
              variant="primary"
              disabled={order.length !== 5}
              onClick={() => finish(false)}
            >
              Finish relay
              <KeyHint aria-hidden="true">Enter</KeyHint>
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
              <KeyHint aria-hidden="true">G</KeyHint>
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
          <Caption>
            {gaveUp
              ? "This route has the closest overall visual matches between neighbours."
              : "Your score compares your order with all 120 possible orders. A score of 100 is the smoothest route; 50 is around the middle."}
          </Caption>
          <Caption>
            Resemblance measures how similar each pair looks to the image matcher. Shared subjects
            come from captions and tags. They can suggest a link, but do not determine the score.
          </Caption>
          <PhotoChain
            photos={[puzzle.start, ...(gaveUp ? puzzle.solution : order), puzzle.end]}
            similarities={relayLinkSimilarities([
              puzzle.start,
              ...(gaveUp ? puzzle.solution : order),
              puzzle.end,
            ])}
          />
          <ol className={relayStyles.linkReasons} aria-label="Relay connections">
            {describeRelayLinks([
              puzzle.start,
              ...(gaveUp ? puzzle.solution : order),
              puzzle.end,
            ]).map((link) => (
              <li key={link.from}>
                <strong>
                  Photographs {link.from} → {link.to}
                </strong>
                <span>
                  {link.similarity === null
                    ? "Resemblance unavailable"
                    : `${link.similarity}% resemblance`}
                </span>
                <span>
                  {link.subjects.length
                    ? `Shared subjects: ${link.subjects.join(" · ")}`
                    : "No shared indexed subject"}
                </span>
              </li>
            ))}
          </ol>
          {gaveUp && order.length ? (
            <details>
              <summary>Your unfinished route</summary>
              <PhotoChain
                photos={[puzzle.start, ...order, puzzle.end]}
                similarities={relayLinkSimilarities([puzzle.start, ...order, puzzle.end])}
              />
            </details>
          ) : null}
          {!gaveUp ? (
            <>
              {(() => {
                const links = relayLinkSimilarities([puzzle.start, ...order, puzzle.end]);
                const measured = links.filter((value): value is number => value !== null);
                if (!measured.length) return null;
                const weakest = links.indexOf(Math.min(...measured));
                return (
                  <Caption>
                    Biggest jump: photographs {weakest + 1} → {weakest + 2} ({links[weakest]}%
                    resemblance). Average across your chain:{" "}
                    {Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length)}
                    %.
                  </Caption>
                );
              })()}
              <details>
                <summary>Compare the smoothest route</summary>
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
            <KeyHint aria-hidden="true">N</KeyHint>
          </Button>
        </div>
      )}
    </div>
  );
};
