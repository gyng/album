import { RandomPhotoRow } from "../components/search/api";
import { RemixStrategy } from "./slideshowAmbient";

// One shown slide: the seed photo plus any remix companions and the strategy
// that produced them. vectorScore is captured asynchronously for vector
// strategies (similar / juxtapose) and drives the "94% match" badge.
export type NavigationEntry = {
  seed: RandomPhotoRow;
  companions: RandomPhotoRow[];
  strategy: RemixStrategy | null;
  vectorScore?: number | null;
};

// The single source of truth for what is on screen: the history of shown
// slides plus a cursor. The current slide is history[index]; everything the
// page renders (seed, companions, strategy, score, can-go-back) derives from
// this, so there is no parallel current-slide state to keep in sync.
export type SlideshowHistoryState = {
  history: NavigationEntry[];
  index: number;
};

export const initialHistoryState = (): SlideshowHistoryState => ({
  history: [],
  index: -1,
});

export type HistoryAction =
  // Forward advance: drop any forward history, append the new slide, point at it.
  | { type: "commit"; entry: NavigationEntry }
  // History navigation (Previous / Next replay): just move the cursor.
  | { type: "goTo"; index: number }
  // Async vector remix resolved: attach companions + score to the matching slide.
  | {
      type: "patchEntry";
      seedPath: string;
      companions: RandomPhotoRow[];
      vectorScore: number | null;
    }
  // Remix toggled off: collapse the current slide to its lone seed.
  | { type: "clearCurrentRemix" }
  // Pool refetched: start over.
  | { type: "reset" }
  // Switched into similar mode: reset history to just the current seed.
  | { type: "replaceSingle"; seed: RandomPhotoRow };

export const advanceHistory = (
  state: SlideshowHistoryState,
  action: HistoryAction,
): SlideshowHistoryState => {
  switch (action.type) {
    case "commit": {
      const history = [
        ...state.history.slice(0, state.index + 1),
        action.entry,
      ];
      return { history, index: history.length - 1 };
    }
    case "goTo": {
      return { ...state, index: action.index };
    }
    case "patchEntry": {
      // Patch the CURRENT slide (the one the async vector fetch was started
      // for), validated by seedPath so a resolve that lands after the user has
      // navigated away is a no-op. Targeting the current index — not the first
      // path match — keeps the visible slide correct even if the same photo
      // path happens to occupy another history position.
      const target = state.index;
      if (target < 0 || state.history[target]?.seed.path !== action.seedPath) {
        return state;
      }
      const history = state.history.slice();
      history[target] = {
        ...history[target],
        companions: action.companions,
        vectorScore: action.vectorScore,
      };
      return { ...state, history };
    }
    case "clearCurrentRemix": {
      if (state.index < 0 || !state.history[state.index]) {
        return state;
      }
      const history = state.history.slice();
      history[state.index] = {
        ...history[state.index],
        companions: [],
        strategy: null,
        vectorScore: null,
      };
      return { ...state, history };
    }
    case "reset": {
      return initialHistoryState();
    }
    case "replaceSingle": {
      return {
        history: [{ seed: action.seed, companions: [], strategy: null }],
        index: 0,
      };
    }
  }
};

// --- Derived selectors (pure) -------------------------------------------

export const currentEntry = (
  state: SlideshowHistoryState,
): NavigationEntry | null =>
  state.index >= 0 ? (state.history[state.index] ?? null) : null;

export const canGoBack = (state: SlideshowHistoryState): boolean =>
  state.index > 0;

export const hasForwardEntry = (state: SlideshowHistoryState): boolean =>
  state.index < state.history.length - 1;

export const upcomingSeed = (
  state: SlideshowHistoryState,
): RandomPhotoRow | null =>
  hasForwardEntry(state)
    ? (state.history[state.index + 1]?.seed ?? null)
    : null;
