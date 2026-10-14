import React from "react";
import { AppLink, useUrlSearchParams } from "../platform";
import { Button, Caption, LoadingIndicator } from "../ui";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";
import {
  findWanderEntry,
  meetsQuest,
  wanderExits,
  wanderKey,
  wanderQuest,
  type WanderQuest,
} from "../../util/wander";
import styles from "./ExploreWander.module.css";

/** How much of the walk the strip keeps in view; Back still retraces all of it. */
const TRAIL_SHOWN = 12;

/** Tags are stored with underscores; the cloud shows them with spaces too. */
const readable = (tag: string) => tag.replaceAll("_", " ");
const randomIndex = (length: number) => Math.floor(Math.random() * length);
const labelOf = (entry: EmbeddingSpaceEntry) =>
  entry.tags?.length ? entry.tags.map(readable).join(", ") : entry.label;

/**
 * A walk through the archive one photograph at a time, each step to one of its
 * neighbours in the full embedding space. No score: the cloud above is the map
 * and this is the ground.
 */
export const ExploreWander: React.FC<{
  /** The walk so far as photograph sources, oldest first, for the cloud to draw. */
  onTrailChange?: (sources: string[]) => void;
}> = ({ onTrailChange }) => {
  const { ready, searchParams, getSearchParam, replaceSearchParams } = useUrlSearchParams();
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [trail, setTrail] = React.useState<number[]>([]);
  const [quest, setQuest] = React.useState<WanderQuest | null>(null);
  const currentRef = React.useRef<HTMLAnchorElement>(null);
  const moved = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSpaceOnce()
      .then((space) => {
        if (!cancelled) setEntries(space.points);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Start where the URL says, or anywhere.
  React.useEffect(() => {
    if (!entries?.length || !ready || trail.length) return;
    const linked = findWanderEntry(entries, getSearchParam("wander"));
    setTrail([linked >= 0 ? linked : randomIndex(entries.length)]);
    // Only the first arrival chooses a start; later URL writes are our own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ready]);

  const current = trail.at(-1) ?? null;
  const here = entries && current !== null ? entries[current] : undefined;

  React.useEffect(() => {
    if (!entries) return;
    onTrailChange?.(trail.flatMap((index) => (entries[index] ? [entries[index].src] : [])));
  }, [entries, trail, onTrailChange]);

  // The URL follows the walk once the reader takes a step, so a link shares
  // the photograph it stands on; landing on a random start writes nothing.
  React.useEffect(() => {
    if (!moved.current || !here) return;
    const key = wanderKey(here);
    if (!key || getSearchParam("wander") === key) return;
    const params = new URLSearchParams(searchParams);
    params.set("wander", key);
    replaceSearchParams(params);
  }, [here, getSearchParam, searchParams, replaceSearchParams]);

  const go = (next: number[]) => {
    moved.current = true;
    setTrail(next);
    currentRef.current?.focus({ preventScroll: true });
  };
  const visited = React.useMemo(() => new Set(trail), [trail]);
  const exits = React.useMemo(
    () => (entries && current !== null ? wanderExits(entries, current, visited) : []),
    [entries, current, visited],
  );
  const questMet = meetsQuest(here, quest);

  if (failed) return <p>The walk could not be loaded.</p>;
  if (!entries || !here || current === null)
    return <LoadingIndicator label="Loading photographs…" />;

  const shown = trail.slice(-TRAIL_SHOWN);
  const hiddenSteps = trail.length - shown.length;
  return (
    <div className={styles.wander}>
      <div className={styles.here}>
        <AppLink href={here.href} className={styles.current} ref={currentRef}>
          <img src={here.src} alt={here.label} className={styles.photo} />
        </AppLink>
        <Caption>{labelOf(here)}</Caption>
      </div>
      <div className={styles.side}>
        <ul className={styles.exits} aria-label="Ways on">
          {exits.map((exit) => {
            const entry = entries[exit.index]!;
            return (
              <li key={exit.index}>
                <button
                  type="button"
                  className={styles.exit}
                  onClick={() => go([...trail, exit.index])}
                >
                  <img src={entry.src} alt="" className={styles.thumb} loading="lazy" />
                  <span className={styles.exitLabel}>{readable(exit.label)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={styles.actions}>
          <Button disabled={trail.length < 2} onClick={() => go(trail.slice(0, -1))}>
            Back
          </Button>
          <Button variant="quiet" onClick={() => go([randomIndex(entries.length)])}>
            Somewhere else
          </Button>
        </div>
        <div className={styles.quest}>
          {quest ? (
            <p role="status">
              {questMet ? "Found: " : "Find a photograph of "}
              <strong>{readable(quest.tags[0])}</strong> and{" "}
              <strong>{readable(quest.tags[1])}</strong>
              {questMet ? ` in ${trail.length - 1} steps.` : "."}
            </p>
          ) : null}
          <Button
            variant="quiet"
            onClick={() => {
              setQuest(wanderQuest(entries));
              if (trail.length > 1) setTrail([current]);
            }}
          >
            {quest ? "Another quest" : "Give me a quest"}
          </Button>
        </div>
      </div>
      {trail.length > 1 ? (
        <ol className={styles.trail} aria-label="Your walk">
          {hiddenSteps > 0 ? (
            <li className={styles.more}>+{hiddenSteps.toLocaleString("en-GB")}</li>
          ) : null}
          {shown.map((index, position) => {
            const step = hiddenSteps + position;
            const entry = entries[index]!;
            return (
              <li key={`${step}-${index}`}>
                <button
                  type="button"
                  className={styles.step}
                  aria-label={`Step ${step + 1}: ${entry.label}`}
                  {...(step === trail.length - 1 ? { "aria-current": "step" as const } : {})}
                  disabled={step === trail.length - 1}
                  onClick={() => go(trail.slice(0, step + 1))}
                >
                  <img src={entry.src} alt="" className={styles.trailThumb} loading="lazy" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
};
