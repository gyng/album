import { RandomPhotoRow } from "../components/search/api";
import { SlideshowMode } from "./slideshowUrl";

// Pure decision core for topical slideshow seeding. A topic is a free-text
// query the user types (e.g. "cat"): the screen encodes it with the SigLIP v1
// text tower and ranks the library semantically, then feeds the ranked paths
// here. This module reconciles those results against the in-memory photo pool
// and decides how to seed the existing similar-mode flow — the async encode /
// fetch and all ref/state mutations stay in the component, mirroring
// slideshowRemix.ts. The topic seeds the flow; the existing image-similarity
// drift takes over from the best match.

// The pre-topic state a dismiss must restore. Only the playback mode is
// restored — the album filter is deliberately NOT captured: topic seeding never
// changes the filter, so restoring it could only silently revert a filter the
// user changed while a topic was active (and force a full pool reload).
export type TopicSnapshot = {
  mode: SlideshowMode;
};

// Collapse a raw topic input to a trimmed string, or null when blank.
export const normaliseTopic = (raw: string): string | null => {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Whether the embeddings database must be loaded. Topic seeding ranks against
// the embeddings table, which lives in the split-out embeddings DB in
// production — with it absent, fetchSemanticResults falls back to search.sqlite
// (no embeddings table) and returns an empty success, which reads as a bogus
// "no photos match" and burns a shared topic= seed. So enable the embeddings DB
// whenever a topic is active, pending, or requested via the URL — not only for
// similar mode / remixes.
export const shouldEnableTopicEmbeddings = (input: {
  mode: SlideshowMode;
  remixEnabled: boolean;
  activeTopic: string | null;
  topicPending: boolean;
  initialTopicPending: boolean;
}): boolean =>
  input.mode === "similar" ||
  input.remixEnabled ||
  input.activeTopic !== null ||
  input.topicPending ||
  input.initialTopicPending;

// A topic encode+rank is asynchronous and can take seconds on a cold model
// load. By the time it lands the user may have changed the playback mode,
// navigated the slideshow themselves, or submitted a newer topic — committing
// the stale result would clobber those newer choices. Capture a token, the
// mode, and the USER-navigation count at submit; abandon the landed result when
// any of them has moved on. Crucially the count keys on user intent, NOT on all
// commits: an app-driven advance (the cadence timer, a pool reload, the seed's
// own commit) must not stale a topic the user just typed. Mirrors the
// vector-remix stale guard in commitNextPhoto.
export const isTopicSeedStale = (input: {
  seedToken: number;
  currentToken: number;
  modeAtSubmit: SlideshowMode;
  currentMode: SlideshowMode;
  userNavAtSubmit: number;
  currentUserNav: number;
}): boolean =>
  input.seedToken !== input.currentToken ||
  input.modeAtSubmit !== input.currentMode ||
  input.userNavAtSubmit !== input.currentUserNav;

// Slide changes come from two sources. USER navigation — a manual next/previous,
// a gesture, a keyboard shortcut, or a history replay — is a fresh intent that
// supersedes an in-flight topic seed. APP-driven advances — the cadence timer,
// pool (re)loads, permalink/seed commits — are not: a topic the user just typed
// must survive an automatic slide change. Only user navigation advances the
// counter the topic stale-guard compares.
export type SlideChangeSource = "user" | "app";
export const advanceUserNavCount = (current: number, source: SlideChangeSource): number =>
  source === "user" ? current + 1 : current;

// The topic encode is async; a cancel or a newer submit bumps the seed token.
// Only the CURRENT token may write the busy / progress / error UI, so a
// cancelled or superseded seed's finally / catch / onProgress cannot clobber a
// newer seed's state.
export const isSeedCurrent = (seedToken: number, currentToken: number): boolean =>
  seedToken === currentToken;

// Worker progress is mapped into per-file phase spans and can momentarily
// regress; the busy chip must never count backwards within a single seed. Clamp
// each reported value up to the highest already shown; the caller resets the
// floor to 0 when a new seed starts.
export const clampTopicProgress = (floor: number, next: number): number => Math.max(floor, next);

// A topic is "active" for dismissal purposes when the chip is showing, an encode
// is in flight, a topic is deferred waiting on the embeddings DB, or an
// unconsumed `topic=` URL seed is still pending. All four must be dismissed when
// the user (or a cross-tab localStorage sync) selects a non-topic playback mode,
// otherwise a still-pending topic later hijacks that explicit choice.
export const isTopicActive = (input: {
  topic: string | null;
  topicBusy: boolean;
  hasDeferredTopic: boolean;
  hasUnconsumedInitialTopic: boolean;
}): boolean =>
  input.topic !== null ||
  input.topicBusy ||
  input.hasDeferredTopic ||
  input.hasUnconsumedInitialTopic;

// Copy shown when the embeddings DB fails to load while a topic is waiting on
// it. British English; distinct from the model-encode failure message so the
// two failure modes are told apart.
export const TOPIC_EMBEDDINGS_UNAVAILABLE_MESSAGE =
  "Couldn't load the similarity data — check the connection and try again.";

// A topic deferred (or an initial URL seed) waiting on the embeddings DB is
// abandoned when that DB load fails: there is nothing to rank against, so the
// caller clears the busy state and surfaces the error rather than spinning
// "Loading embeddings…" forever. Only act when the error is real AND something
// is actually waiting on the DB.
export const shouldAbortPendingTopicOnEmbeddingsError = (input: {
  hasEmbeddingsError: boolean;
  topicAwaitingEmbeddings: boolean;
  hasDeferredTopic: boolean;
  hasPendingInitialTopic: boolean;
}): boolean =>
  input.hasEmbeddingsError &&
  (input.topicAwaitingEmbeddings || input.hasDeferredTopic || input.hasPendingInitialTopic);

// Map ranked semantic results onto the in-memory pool, preserving ranked
// (best-first) order and respecting the active album filter — the same
// pool/filter intersection the similar path applies. Returns the pool's own row
// objects so colours/exif/geocode carry through, de-duplicated by path.
export const mapTopicSeedResults = (input: {
  resultData: ReadonlyArray<{ path: string }>;
  pool: RandomPhotoRow[];
  filter?: string;
}): RandomPhotoRow[] => {
  const byPath = new Map(input.pool.map((photo) => [photo.path, photo]));
  const seen = new Set<string>();
  const seeded: RandomPhotoRow[] = [];

  for (const item of input.resultData) {
    if (seen.has(item.path)) {
      continue;
    }
    if (input.filter && !item.path.startsWith(`../albums/${input.filter}/`)) {
      continue;
    }
    const match = byPath.get(item.path);
    if (match) {
      seen.add(item.path);
      seeded.push(match);
    }
  }

  return seeded;
};

export type TopicSeedPlan =
  | { kind: "empty" }
  | {
      kind: "seed";
      seed: RandomPhotoRow;
      snapshot: TopicSnapshot;
      // Whether the caller should commit the best match as the current slide.
      // False when a `photo=` permalink is present: the topic still activates
      // (chip, snapshot, mode=similar) but the flow must keep drifting from the
      // pinned photo rather than jumping to the topic's best match.
      commit: boolean;
    };

// Decide how to seed topic mode from ranked results. Returns "empty" when
// nothing in the pool matches (the caller keeps the previous mode and surfaces
// an error), otherwise the best match to commit as the current slide and the
// snapshot a later dismiss restores. `previousMode` is passed as a value — the
// caller preserves the ORIGINAL snapshot across a re-seed so restore always
// returns to the pre-topic mode, never to "similar". `preserveCurrentPhoto`
// keeps a `photo=` permalink's starting slide on screen (see `commit`).
export const decideTopicSeed = (input: {
  resultData: ReadonlyArray<{ path: string }>;
  pool: RandomPhotoRow[];
  previousMode: SlideshowMode;
  filter?: string;
  preserveCurrentPhoto?: boolean;
}): TopicSeedPlan => {
  const seeded = mapTopicSeedResults({
    resultData: input.resultData,
    pool: input.pool,
    filter: input.filter,
  });

  if (seeded.length === 0) {
    return { kind: "empty" };
  }

  const [seed] = seeded;
  return {
    kind: "seed",
    seed: seed!,
    snapshot: { mode: input.previousMode },
    commit: !input.preserveCurrentPhoto,
  };
};

/**
 * A deferred topic (waiting on the embeddings database) staled if the playback
 * mode changed while it waited — e.g. a cross-tab flip via localStorage sync,
 * which bypasses the toolbar dismissal path entirely. The mode captured at
 * deferral is the user-intent baseline the eventual seed must still match;
 * running it after a flip would hijack the newer mode choice back to similar.
 */
export const isDeferredTopicStale = (input: {
  modeAtDefer: SlideshowMode;
  currentMode: SlideshowMode;
}): boolean => input.currentMode !== input.modeAtDefer;
