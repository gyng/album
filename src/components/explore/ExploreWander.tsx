import React from "react";
import { AppLink, useUrlSearchParams } from "../platform";
import { Button, Caption, Input, LoadingIndicator, buttonStyles } from "../ui";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";
import {
  findWanderEntry,
  wanderExits,
  wanderJump,
  wanderScenes,
  wanderKey,
  wanderKeyword,
  wanderCanEscape,
  wanderTravelAfter,
  type WanderTravel,
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
  photoLinks?: boolean;
  escapeInterval?: number;
  onVisit?: (
    entry: EmbeddingSpaceEntry,
    steps: number,
    context: { explored: ReadonlySet<number>; travel: WanderTravel },
  ) => void;
}> = ({
  onTrailChange,
  initialIndex,
  questLink = true,
  photoLinks = true,
  escapeInterval = 0,
  onVisit,
}) => {
  const { ready, searchParams, getSearchParam, replaceSearchParams } = useUrlSearchParams();
  const [entries, setEntries] = React.useState<EmbeddingSpaceEntry[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [trail, setTrail] = React.useState<number[]>([]);
  const [explored, setExplored] = React.useState<Set<number>>(() => new Set());
  const [steps, setSteps] = React.useState(0);
  const [localSteps, setLocalSteps] = React.useState(0);
  const travel = React.useMemo(
    () => ({ interval: escapeInterval, localSteps }),
    [escapeInterval, localSteps],
  );
  const [keyword, setKeyword] = React.useState("");
  const [keywordMessage, setKeywordMessage] = React.useState("");
  const currentRef = React.useRef<HTMLDivElement>(null);
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
    if (here) onVisit?.(here, steps, { explored, travel });
  }, [here, steps, onVisit, explored, travel]);

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
    const destination = next.at(-1);
    if (destination !== current) setSteps((previous) => previous + 1);
    if (entries && current !== null && destination !== undefined && !explored.has(destination)) {
      setLocalSteps(wanderTravelAfter(entries, current, destination, travel).localSteps);
    }
    setKeywordMessage("");
    setMotion(direction);
    moved.current = true;
    setTrail(next);
    setExplored((previous) => new Set([...previous, ...next]));
    currentRef.current?.focus({ preventScroll: true });
  };
  const visited = explored;
  const exits = React.useMemo(
    () => (entries && current !== null ? wanderExits(entries, current, visited, 6, travel) : []),
    [entries, current, visited, travel],
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

  const canEscape = wanderCanEscape(entries, current, visited, travel);
  const steer = (term: string, more = true) => {
    const next = wanderKeyword(entries, current, visited, term, more, travel);
    if (next === null) {
      setKeywordMessage(
        `No ${canEscape ? "unexplored" : "nearby unexplored"} photographs ${more ? "with" : "without"} “${readable(term.trim())}”.`,
      );
      return;
    }
    go([...trail, next], { x: more ? 20 : -20, y: 0 });
  };
  const subjects = [...new Set(here.tags ?? [])].slice(0, 3);
  const linkedKeywords = [...new Set(exits.flatMap((exit) => entries[exit.index]!.tags ?? []))]
    .filter((tag) => !here.tags?.includes(tag))
    .slice(0, 6);
  const shown = trail.slice(-TRAIL_SHOWN);
  const hiddenSteps = trail.length - shown.length;
  return (
    <div className={styles.wander}>
      <div className={styles.journey}>
        <div className={styles.here} ref={currentRef} tabIndex={-1}>
          {photoLinks ? (
            <AppLink href={here.href} className={styles.current}>
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
          ) : (
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
          )}
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
            disabled={!hasUnexplored || !canEscape}
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
                setLocalSteps(0);
                moved.current = true;
                setTrail([next]);
              }}
            >
              Start again
            </Button>
          ) : null}
        </div>
        {escapeInterval > 0 && hasUnexplored ? (
          <Caption>
            {canEscape
              ? "Wider jumps ready"
              : `Wider jumps in ${escapeInterval - localSteps} fresh local ${escapeInterval - localSteps === 1 ? "step" : "steps"} · dead ends unlock an escape.`}
          </Caption>
        ) : null}
        <div className={styles.sceneJumps}>
          <Caption>Follow a subject</Caption>
          {subjects.length ? (
            <div className={styles.subjects} role="group" aria-label="Steer by subject">
              {subjects.map((subject) => (
                <div className={styles.actions} key={subject}>
                  <Button
                    disabled={
                      wanderKeyword(entries, current, visited, subject, true, travel) === null
                    }
                    onClick={() => steer(subject)}
                  >
                    More {readable(subject)}
                  </Button>
                  <Button
                    disabled={
                      wanderKeyword(entries, current, visited, subject, false, travel) === null
                    }
                    onClick={() => steer(subject, false)}
                  >
                    Less {readable(subject)}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <form
            className={styles.keywordForm}
            onSubmit={(event) => {
              event.preventDefault();
              steer(keyword);
            }}
          >
            <Input
              aria-label="Wander keyword"
              placeholder="Keyword"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Button type="submit" disabled={!keyword.trim()}>
              Follow keyword
            </Button>
          </form>
          {linkedKeywords.length ? (
            <div className={styles.actions} role="group" aria-label="Linked keywords">
              {linkedKeywords.map((tag) => (
                <Button
                  key={tag}
                  variant="quiet"
                  onClick={() => {
                    setKeyword(readable(tag));
                    steer(tag);
                  }}
                >
                  {readable(tag)}
                </Button>
              ))}
            </div>
          ) : null}
          {keywordMessage ? <p role="status">{keywordMessage}</p> : null}
        </div>
        {scenes.length ? (
          <div className={styles.sceneJumps}>
            <Caption>Change scene</Caption>
            <div className={styles.actions} role="group" aria-label="Change scene">
              {scenes.map((scene) => (
                <Button
                  key={scene.id}
                  disabled={!canEscape}
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
