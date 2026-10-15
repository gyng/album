import React from "react";
import { AppLink, useUrlSearchParams } from "../platform";
import { Button, Caption, LoadingIndicator, buttonStyles } from "../ui";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";
import {
  findWanderEntry,
  wanderExits,
  wanderJump,
  wanderScenes,
  wanderKey,
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
 * A walk through visual neighbours, with wider jumps into unexplored scenes.
 * No score: the cloud above is the map
 * and this is the ground.
 */
export const ExploreWander: React.FC<{
  /** The walk so far as photograph sources, oldest first, for the cloud to draw. */
  onTrailChange?: (sources: string[]) => void;
  initialIndex?: number;
  questLink?: boolean;
  onVisit?: (entry: EmbeddingSpaceEntry, steps: number) => void;
}> = ({ onTrailChange, initialIndex, questLink = true, onVisit }) => {
  const { ready, searchParams, getSearchParam, replaceSearchParams } = useUrlSearchParams();
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [trail, setTrail] = React.useState<number[]>([]);
  const [explored, setExplored] = React.useState<Set<number>>(() => new Set());
  const [steps, setSteps] = React.useState(0);
  const currentRef = React.useRef<HTMLAnchorElement>(null);
  const moved = React.useRef(false);
  const [motion, setMotion] = React.useState({ x: 0, y: 12 });

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
    const first =
      initialIndex !== undefined && entries[initialIndex]
        ? initialIndex
        : linked >= 0
          ? linked
          : randomIndex(entries.length);
    setTrail([first]);
    setExplored(new Set([first]));
    // Only the first arrival chooses a start; later URL writes are our own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ready]);

  const current = trail.at(-1) ?? null;
  const here = entries && current !== null ? entries[current] : undefined;

  React.useEffect(() => {
    if (here) onVisit?.(here, steps);
  }, [here, steps, onVisit]);

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

  const go = (next: number[], direction = { x: 0, y: 12 }) => {
    if (next.at(-1) !== current) setSteps((previous) => previous + 1);
    setMotion(direction);
    moved.current = true;
    setTrail(next);
    setExplored((previous) => new Set([...previous, ...next]));
    currentRef.current?.focus({ preventScroll: true });
  };
  const visited = explored;
  const exits = React.useMemo(
    () => (entries && current !== null ? wanderExits(entries, current, visited) : []),
    [entries, current, visited],
  );
  const scenes = React.useMemo(
    () => (entries && current !== null ? wanderScenes(entries, current, visited) : []),
    [entries, current, visited],
  );
  const hasUnexplored =
    !!entries && entries.some((_, index) => index !== current && !visited.has(index));

  if (failed) return <p>The walk could not be loaded.</p>;
  if (!entries || !here || current === null)
    return <LoadingIndicator label="Loading photographs…" />;

  const shown = trail.slice(-TRAIL_SHOWN);
  const hiddenSteps = trail.length - shown.length;
  return (
    <div className={styles.wander}>
      <div className={styles.journey}>
        <div className={styles.here}>
          <AppLink href={here.href} className={styles.current} ref={currentRef}>
            <img
              key={here.src}
              src={here.src}
              alt={here.label}
              className={styles.photo}
              style={
                {
                  "--wander-x": `${motion.x}px`,
                  "--wander-y": `${motion.y}px`,
                } as React.CSSProperties
              }
            />
          </AppLink>
          <Caption>{labelOf(here)}</Caption>
        </div>
        <ul className={styles.exits} aria-label="Ways on">
          {exits.map((exit, position) => {
            const entry = entries[exit.index]!;
            return (
              <li key={exit.index}>
                <button
                  type="button"
                  className={styles.exit}
                  onClick={() => {
                    const offsets = [
                      { x: 0, y: -20 },
                      { x: 20, y: -12 },
                      { x: 24, y: 0 },
                      { x: 16, y: 16 },
                      { x: -16, y: 16 },
                      { x: -24, y: 0 },
                    ];
                    go([...trail, exit.index], offsets[position]);
                  }}
                >
                  <img src={entry.src} alt="" className={styles.thumb} loading="lazy" />
                  <span className={styles.exitLabel}>{readable(exit.label)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={styles.side}>
        <div className={styles.actions}>
          <Button disabled={trail.length < 2} onClick={() => go(trail.slice(0, -1))}>
            Back
          </Button>
          <Button
            variant="accent"
            disabled={!hasUnexplored}
            onClick={() => {
              const next = wanderJump(entries, current, visited);
              if (next !== null) go([...trail, next], { x: 0, y: 20 });
            }}
          >
            Take a leap
          </Button>
          {!hasUnexplored ? (
            <Button
              onClick={() => {
                const next = entries.length > 1 ? (current + 1) % entries.length : current;
                setExplored(new Set([next]));
                setSteps(0);
                moved.current = true;
                setTrail([next]);
              }}
            >
              Start again
            </Button>
          ) : null}
        </div>
        {scenes.length ? (
          <div className={styles.sceneJumps}>
            <Caption>Change scene</Caption>
            <div className={styles.actions} role="group" aria-label="Change scene">
              {scenes.map((scene) => (
                <Button
                  key={scene.id}
                  onClick={() => {
                    const next = wanderJump(entries, current, visited, Math.random, scene.id);
                    if (next !== null) go([...trail, next], { x: 0, y: 20 });
                  }}
                >
                  {scene.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {!hasUnexplored ? <Caption>You’ve explored every photograph in this walk.</Caption> : null}
        {questLink ? (
          <AppLink
            className={[buttonStyles.base, buttonStyles.quiet].join(" ")}
            href={`/fun/wander?${new URLSearchParams({ mode: "quest", play: "1", ...(wanderKey(here) ? { wander: wanderKey(here)! } : {}) })}`}
          >
            Give me a quest
          </AppLink>
        ) : null}
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
