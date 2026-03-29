import { useEffect, useReducer } from "react";
import { encodeSearchText, warmupTextEmbeddingModel } from "./textEmbeddings";

export type SearchMode = "keyword" | "semantic" | "hybrid";

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
  | { type: "warmup:error" }
  | { type: "vector:clear" }
  | { type: "vector:start" }
  | { type: "vector:success"; vector: number[]; query: string }
  | { type: "vector:error" }
  | { type: "vector:done" };

const initialState: TextVectorState = {
  textVector: null,
  textVectorQuery: null,
  isTextVectorLoading: false,
  textVectorError: null,
  textModelProgress: 100,
  textModelStage: "Loading semantic search model...",
  textModelProgressDetails: { loaded: 0, total: 0 },
};

const reducer = (state: TextVectorState, action: Action): TextVectorState => {
  switch (action.type) {
    case "warmup:start":
      return {
        ...state,
        textModelProgress: 0,
        textModelStage: "Loading semantic search model...",
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
        textVectorError: "Semantic search is unavailable right now.",
        textModelProgressDetails: { loaded: 0, total: 0 },
      };
    case "vector:done":
      return {
        ...state,
        isTextVectorLoading: false,
      };
    default:
      return state;
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
        dispatch({ type: "warmup:error" });
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
          dispatch({ type: "vector:error" });
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
