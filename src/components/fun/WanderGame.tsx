import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";
import {
  findWanderEntry,
  meetsQuest,
  wanderHunt,
  wanderKey,
  type WanderQuest,
} from "../../util/wander";
import { ExploreWander } from "../explore/ExploreWander";
import { AppLink, useUrlSearchParams } from "../platform";
import { Button, Caption, Heading, SegmentedToggle } from "../ui";
import { GameIntro } from "./GameIllustration";
import { GameReadinessProvider } from "./GameReadiness";
import { GameStatsLine } from "./GameRecord";
import { ResultNextSteps } from "./ResultNextSteps";
import { useGameSettings, type GameSettingsRegistry } from "./useGameSettings";
import { useGameStats } from "./useGameStats";
import styles from "./WanderGame.module.css";

type Mode = GameSettingsRegistry["wander"]["mode"];
type Goal = WanderQuest & { photo?: EmbeddingSpaceEntry };
const matches = (entry: EmbeddingSpaceEntry, goal: Goal) =>
  goal.photo ? entry.src === goal.photo.src : meetsQuest(entry, goal);
type Round = { id: number; mode: Mode; goals: Goal[]; initialIndex: number };
type Find = { goal: Goal; photo: EmbeddingSpaceEntry };
type Result = { mode: Mode; won: boolean; steps: number; photos: EmbeddingSpaceEntry[] };
const goalKey = (goal: Goal) => goal.photo?.src ?? goal.tags.join("\u0000");
const readable = (tag: string) => tag.replaceAll("_", " ");

export const WanderGame = ({ linkedMode }: { linkedMode?: Mode }) => {
  const [settings, setSettings, settingsReady] = useGameSettings(
    "wander",
    linkedMode ? { mode: linkedMode } : undefined,
  );
  const { ready, getSearchParam } = useUrlSearchParams();
  const { stats, record } = useGameStats("wander");
  const [entries, setEntries] = useState<EmbeddingSpaceEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showLoading, setShowLoading] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [found, setFound] = useState<Find[]>([]);
  const [steps, setSteps] = useState(0);
  const [message, setMessage] = useState("");
  const foundRef = useRef<Find[]>([]);
  const lastVisit = useRef<{ photo: EmbeddingSpaceEntry; steps: number } | null>(null);
  const completed = useRef(false),
    autoStarted = useRef(false),
    sequence = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
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
  }, [attempt]);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowLoading(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);
  const huntSize = settings.difficulty === "easy" ? 2 : settings.difficulty === "hard" ? 5 : 3;
  const maxMatches = settings.difficulty === "easy" ? 10 : settings.difficulty === "hard" ? 1 : 5;
  const count =
    settings.mode === "hunt" || settings.mode === "photos"
      ? huntSize
      : settings.mode === "quest"
        ? 1
        : 0;
  const available = useMemo(
    () =>
      entries && count && settings.mode !== "photos"
        ? wanderHunt(entries, count, () => 0, undefined, maxMatches)
        : [],
    [entries, count, settings.mode, maxMatches],
  );
  const canStart =
    !!entries?.length &&
    (settings.mode === "photos" ? entries.length > count : available.length === count);
  const start = () => {
    if (!entries?.length || !canStart) return;
    const linked = findWanderEntry(entries, getSearchParam("wander"));
    let goals: Goal[] =
      count && settings.mode !== "photos"
        ? wanderHunt(entries, count, Math.random, entries[linked], maxMatches)
        : [];
    if (settings.mode === "photos") {
      const seen = new Set<string>();
      const pool = entries.filter((entry, index) => {
        if (index === linked || seen.has(entry.src)) return false;
        seen.add(entry.src);
        return true;
      });
      goals = [];
      while (pool.length && goals.length < count) {
        const photo = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!;
        goals.push({ tags: ["", ""], photo });
      }
    } else if (goals.length < count) goals = available;
    const starts = entries.flatMap((entry, index) =>
      goals.some((goal) => matches(entry, goal)) ? [] : [index],
    );
    const initialIndex =
      linked >= 0 && starts.includes(linked)
        ? linked
        : starts[Math.floor(Math.random() * starts.length)];
    if (goals.length < count || initialIndex === undefined) {
      setMessage("There are not enough separate finds for this mode.");
      return;
    }
    sequence.current += 1;
    completed.current = false;
    foundRef.current = [];
    lastVisit.current = null;
    setFound([]);
    setSteps(0);
    setMessage("");
    setResult(null);
    setRound({ id: sequence.current, mode: settings.mode, goals, initialIndex });
  };
  useEffect(() => {
    if (
      autoStarted.current ||
      !ready ||
      !settingsReady ||
      !entries ||
      getSearchParam("play") !== "1"
    )
      return;
    autoStarted.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- An Explore quest link starts once its URL, preferences and photographs are ready.
    start();
  });
  const onVisit = useCallback(
    (photo: EmbeddingSpaceEntry, moves: number) => {
      lastVisit.current = { photo, steps: moves };
      setSteps(moves);
      if (!round || completed.current || round.mode === "roam") return;
      const newGoals = round.goals.filter(
        (goal) =>
          !foundRef.current.some((item) => goalKey(item.goal) === goalKey(goal)) &&
          matches(photo, goal),
      );
      if (!newGoals.length) return;
      foundRef.current = [...foundRef.current, ...newGoals.map((goal) => ({ goal, photo }))];
      setFound(foundRef.current);
      if (foundRef.current.length === round.goals.length) {
        completed.current = true;
        record({ won: true });
        setResult({
          mode: round.mode,
          won: true,
          steps: moves,
          photos: round.goals.map(
            (goal) => foundRef.current.find((item) => goalKey(item.goal) === goalKey(goal))!.photo,
          ),
        });
      }
    },
    [round, record],
  );
  const finish = () => {
    if (!round || !entries || completed.current || !lastVisit.current) return;
    completed.current = true;
    record({ won: false });
    const photos =
      round.mode === "roam"
        ? [lastVisit.current.photo]
        : round.goals.flatMap((goal) => {
            const photo =
              foundRef.current.find((item) => goalKey(item.goal) === goalKey(goal))?.photo ??
              entries.find((entry) => matches(entry, goal));
            return photo ? [photo] : [];
          });
    setResult({ mode: round.mode, won: false, steps: lastVisit.current.steps, photos });
  };
  if (result)
    return (
      <div
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Wander result"
        className={styles.game}
      >
        <Heading level={2}>
          {result.mode === "roam"
            ? "Your wander"
            : result.won
              ? result.mode === "hunt" || result.mode === "photos"
                ? "Every find, found"
                : "Quest complete"
              : "The hidden finds"}
        </Heading>
        <Caption>
          {result.steps} {result.steps === 1 ? "step" : "steps"}
          {result.mode === "hunt" || result.mode === "photos"
            ? ` · ${found.length} of ${round!.goals.length} found`
            : ""}
        </Caption>
        <div className={styles.finds}>
          {result.photos.map((photo, index) => (
            <figure key={photo.src}>
              <AppLink href={photo.href}>
                <img src={photo.src} alt={photo.label} />
              </AppLink>
              {round?.goals[index] ? (
                <figcaption>
                  {round.goals[index]!.photo?.label ??
                    round.goals[index]!.tags.map(readable).join(" + ")}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
        <ResultNextSteps
          photos={result.photos.flatMap((photo) => {
            const path = wanderKey(photo);
            return path ? [{ path }] : [];
          })}
        />
        <div className={styles.actions}>
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
          <Button
            onClick={() => {
              setResult(null);
              setRound(null);
            }}
          >
            Change mode
          </Button>
        </div>
      </div>
    );
  if (round)
    return (
      <div className={styles.game}>
        <div className={styles.actions}>
          <Button
            onClick={() => {
              completed.current = true;
              setRound(null);
            }}
          >
            Menu
          </Button>
          <Caption>
            {steps} {steps === 1 ? "step" : "steps"}
          </Caption>
          <Button variant="quiet" onClick={finish}>
            {round.mode === "roam" ? "End walk" : "Give up"}
          </Button>
        </div>
        {round.goals.length ? (
          <ul className={styles.targets} aria-label="Quest targets">
            {round.goals.map((goal) => {
              const done = found.some((item) => goalKey(item.goal) === goalKey(goal));
              return (
                <li key={goalKey(goal)}>
                  <span>{done ? "Found" : "Find"}</span>{" "}
                  {goal.photo ? (
                    <img
                      className={styles.targetPhoto}
                      src={goal.photo.src}
                      alt={`Target: ${goal.photo.label}`}
                    />
                  ) : (
                    <strong>{goal.tags.map(readable).join(" + ")}</strong>
                  )}
                  {done ? <span aria-label="Completed"> ✓</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <ExploreWander
          key={round.id}
          initialIndex={round.initialIndex}
          questLink={false}
          onVisit={onVisit}
        />
      </div>
    );
  return (
    <GameReadinessProvider
      value={{
        loading: !entries || !settingsReady || failed,
        showProgress: showLoading,
        progress: 0,
        error: failed ? "The walk could not be loaded." : null,
        retry: () => {
          setFailed(false);
          setAttempt((value) => value + 1);
        },
      }}
    >
      <GameIntro game="wander">
        <SegmentedToggle
          ariaLabel="Wander mode"
          value={settings.mode}
          options={[
            { value: "quest", label: "Quest" },
            { value: "roam", label: "Free roam" },
            { value: "hunt", label: "Scavenger hunt" },
            { value: "photos", label: "Photo hunt" },
          ]}
          onChange={(mode) => {
            setSettings((current) => ({ ...current, mode }));
            setMessage("");
          }}
        />
        {settings.mode !== "roam" ? (
          <SegmentedToggle
            ariaLabel="Difficulty"
            value={settings.difficulty}
            options={[
              { value: "easy", label: "Easy" },
              { value: "normal", label: "Normal" },
              { value: "hard", label: "Hard" },
            ]}
            onChange={(difficulty) => setSettings((current) => ({ ...current, difficulty }))}
          />
        ) : null}
        <p>
          {settings.mode === "roam"
            ? "Follow photographic connections without a destination."
            : settings.mode === "photos"
              ? `Find these ${huntSize} exact photographs in one walk.`
              : settings.mode === "hunt"
                ? `Find ${huntSize} different combinations of subjects in one walk.`
                : "Find a photograph that brings two subjects together."}
        </p>
        {settings.mode === "quest" ? (
          <Caption>
            {settings.difficulty === "easy"
              ? "Up to ten photographs can fulfil the quest."
              : settings.difficulty === "hard"
                ? "Only one photograph fulfils the quest."
                : "Up to five photographs can fulfil the quest."}
          </Caption>
        ) : null}
        {!canStart && entries ? (
          <p role="status">
            {entries.length
              ? "There are not enough separate finds for this mode. Try Free roam."
              : "There are no photographs available for a walk yet."}
          </p>
        ) : null}
        {message ? <p role="alert">{message}</p> : null}
        <Button variant="primary" disabled={!canStart} onClick={start}>
          {settings.mode === "roam"
            ? "Start wandering"
            : settings.mode === "hunt" || settings.mode === "photos"
              ? "Start hunt"
              : "Start quest"}
        </Button>
        <GameStatsLine stats={stats} best={null} wins={settings.mode !== "roam"} />
      </GameIntro>
    </GameReadinessProvider>
  );
};
