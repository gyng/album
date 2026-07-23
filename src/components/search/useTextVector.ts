import { useEffect, useReducer } from "react";
import { encodeSearchText, warmupTextEmbeddingModel } from "./textEmbeddings";
import { isEmbeddingWorkerSlowStart, isEmbeddingWorkerUnavailable } from "./embeddingWorkerClient";

export type SearchMode = "keyword" | "semantic" | "hybrid";

// A dead worker (its script/chunk 404'd after a redeploy) can never encode, so
// point the user at a reload rather than the generic "try later" wording.
export const SEARCH_UNAVAILABLE_MESSAGE =
  "Search could not start — the site may have been updated. Reload the page to try again.";
const SEMANTIC_UNAVAILABLE_MESSAGE = "Semantic search is unavailable right now.";
// A recoverable slow start (the worker chunk is still downloading): retrying
// is the designed recovery — reloading would restart the download from zero.
export const SEARCH_SLOW_START_MESSAGE =
  "The search engine is taking a while to load — check the connection and try again.";

type EncodeFailureOutcome = "unavailable" | "slow-start" | "generic";

const classifyEncodeFailure = (error: unknown): EncodeFailureOutcome =>
  isEmbeddingWorkerUnavailable(error)
    ? "unavailable"
    : isEmbeddingWorkerSlowStart(error)
      ? "slow-start"
      : "generic";

type ProgressDetails = {
  loaded: number;
  total: number;
  file?: string;
};

export type TextVectorState = {
  textVector: number[] | null;
  textVectorQuery: string | null;
  isTextVectorLoading: boolean;
  textVectorError: string | null;
  textModelProgress: number;
  textModelStage: string;
  textModelProgressDetails: ProgressDetails;
};

type Action =
  | { type: "warmup:start" }
  | {
      type: "progress";
      progress: number;
      stage: string;
      details?: ProgressDetails;
    }
  | { type: "warmup:ready" }
  | { type: "warmup:error"; outcome: EncodeFailureOutcome }
  | { type: "vector:clear" }
  | { type: "vector:start" }
  | { type: "vector:success"; vector: number[]; query: string }
  | { type: "vector:error"; outcome: EncodeFailureOutcome }
  | { type: "vector:done" };

const initialState: TextVectorState = {
  textVector: null,
  textVectorQuery: null,
  isTextVectorLoading: false,
  textVectorError: null,
  textModelProgress: 100,
  textModelStage: "Loading semantic search model…",
  textModelProgressDetails: { loaded: 0, total: 0 },
};

const reducer = (state: TextVectorState, action: Action): TextVectorState => {
  switch (action.type) {
    case "warmup:start":
      return {
        ...state,
        textModelProgress: 0,
        textModelStage: "Loading semantic search model…",
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "progress":
      return {
        ...state,
        textModelProgress: action.progress,
        textModelStage: action.stage,
        textModelProgressDetails: action.details ?? { loaded: 0, total: 0 },
      };
    case "warmup:ready":
      return {
        ...state,
        textModelProgress: 100,
        textModelStage: "Search model ready",
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "warmup:error":
      return {
        ...state,
        textModelProgress: 100,
        textModelProgressDetails: { loaded: 0, total: 0 },
        // A dead worker surfaces immediately so the vanished progress bar is
        // replaced by a reload prompt; a normal warmup failure stays silent and
        // degrades gracefully once the user actually runs a query.
        textVectorError:
          action.outcome === "unavailable"
            ? SEARCH_UNAVAILABLE_MESSAGE
            : action.outcome === "slow-start"
              ? SEARCH_SLOW_START_MESSAGE
              : state.textVectorError,
      };
    case "vector:clear":
      return {
        ...state,
        textVector: null,
        textVectorQuery: null,
        isTextVectorLoading: false,
        textVectorError: null,
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "vector:start":
      return {
        ...state,
        textVector: null,
        textVectorQuery: null,
        isTextVectorLoading: true,
        textVectorError: null,
      };
    case "vector:success":
      return {
        ...state,
        textVector: action.vector,
        textVectorQuery: action.query,
        textModelProgress: 100,
        textModelStage: "Search model ready",
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "vector:error":
      return {
        ...state,
        textVector: null,
        textVectorError:
          action.outcome === "unavailable"
            ? SEARCH_UNAVAILABLE_MESSAGE
            : action.outcome === "slow-start"
              ? SEARCH_SLOW_START_MESSAGE
              : SEMANTIC_UNAVAILABLE_MESSAGE,
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "vector:done":
      return {
        ...state,
        isTextVectorLoading: false,
      };
  }
};

export const useTextVector = ({
  isSimilarMode,
  searchMode,
  needsTextVector,
  trimmedQuery,
}: {
  isSimilarMode: boolean;
  searchMode: SearchMode;
  needsTextVector: boolean;
  trimmedQuery: string;
}): TextVectorState => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (isSimilarMode || searchMode === "keyword") {
      return;
    }

    dispatch({ type: "warmup:start" });

    void warmupTextEmbeddingModel((progress, stage, details) => {
      dispatch({ type: "progress", progress, stage, details });
    })
      .then(() => {
        dispatch({ type: "warmup:ready" });
      })
      .catch((err) => {
        console.warn("Failed to warm semantic search model", err);
        dispatch({ type: "warmup:error", outcome: classifyEncodeFailure(err) });
      });
  }, [isSimilarMode, searchMode]);

  useEffect(() => {
    if (!needsTextVector) {
      dispatch({ type: "vector:clear" });
      return;
    }

    let didCancel = false;
    const queryText = trimmedQuery;
    dispatch({ type: "vector:start" });

    encodeSearchText(queryText, (progress, stage, details) => {
      dispatch({ type: "progress", progress, stage, details });
    })
      .then((vector) => {
        if (!didCancel) {
          dispatch({ type: "vector:success", vector, query: queryText });
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error("Failed to encode semantic search text", err);
          dispatch({ type: "vector:error", outcome: classifyEncodeFailure(err) });
        }
      })
      .finally(() => {
        if (!didCancel) {
          dispatch({ type: "vector:done" });
        }
      });

    return () => {
      didCancel = true;
    };
  }, [needsTextVector, trimmedQuery]);

  return state;
};
