import type { Database } from "@sqlite.org/sqlite-wasm";
import { useState, useEffect, useCallback, useReducer, useRef } from "react";
import { publicConfig, usePublicConfig } from "../platform";

export const SEARCH_DATABASE_URL = publicConfig.searchDatabaseUrl;
export const EMBEDDINGS_DATABASE_URL = publicConfig.searchEmbeddingsDatabaseUrl;

type ProgressDetails = {
  loaded: number;
  total: number;
};

type UseDatabaseState = {
  database: Database | null;
  progress: number;
  progressDetails: ProgressDetails;
  error: Error | null;
};

type Action =
  | { type: "load:start" }
  | { type: "load:progress"; percent: number; details: ProgressDetails }
  | { type: "load:success"; database: Database }
  | { type: "load:error"; error: Error };

const initialState: UseDatabaseState = {
  database: null,
  progress: 0,
  progressDetails: {
    loaded: 0,
    total: 0,
  },
  error: null,
};

const reducer = (state: UseDatabaseState, action: Action): UseDatabaseState => {
  switch (action.type) {
    case "load:start":
      return {
        ...state,
        error: null,
        progress: 0,
        progressDetails: { loaded: 0, total: 0 },
      };
    case "load:progress":
      return {
        ...state,
        progress: action.percent,
        progressDetails: action.details,
      };
    case "load:success":
      return {
        ...state,
        database: action.database,
        progress: 100,
      };
    case "load:error":
      return {
        ...state,
        error: action.error,
      };
  }
};

const cachedDatabases = new Map<string, Database>();
const databasePromises = new Map<string, Promise<Database>>();

const fetchWithProgress: typeof import("./sqliteLoader").fetchWithProgress = async (...args) =>
  (await import("./sqliteLoader")).fetchWithProgress(...args);

const initializeSQLite: typeof import("./sqliteLoader").initializeSQLite = async (...args) => {
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    const { openWorkerDatabase } = await import("./sqliteWorkerClient");
    return openWorkerDatabase(...args);
  }
  return (await import("./sqliteLoader")).initializeSQLite(...args);
};

export const databaseLoaderInternals = {
  fetchWithProgress,
  initializeSQLite,
  getDatabase: (
    url: string,
    fallbackUrl?: string,
    setProgress?: (percent: number, details: ProgressDetails) => void,
    forceRefresh?: boolean,
  ) => getDatabase(url, fallbackUrl, setProgress, forceRefresh),
  resetForTesting: () => {
    cachedDatabases.clear();
    databasePromises.clear();
  },
};

const getDatabase = (
  url: string,
  fallbackUrl?: string,
  setProgress?: (percent: number, details: ProgressDetails) => void,
  forceRefresh = false,
): Promise<Database> => {
  const cachedDatabase = cachedDatabases.get(url);
  if (cachedDatabase && !forceRefresh) {
    setProgress?.(100, { loaded: 0, total: 0 });
    return Promise.resolve(cachedDatabase);
  }

  const existingPromise = databasePromises.get(url);
  if (existingPromise && !forceRefresh) {
    return existingPromise;
  }

  if (forceRefresh) {
    databasePromises.delete(url);
  }

  const databasePromise = initializeSQLite(url, fallbackUrl, setProgress, forceRefresh)
    .then((database) => {
      if (databasePromises.get(url) === databasePromise) {
        cachedDatabases.set(url, database);
      }
      return database;
    })
    .catch((err) => {
      if (databasePromises.get(url) === databasePromise) {
        databasePromises.delete(url);
      }
      throw err;
    });

  databasePromises.set(url, databasePromise);
  return databasePromise;
};

export type DatabasePair = { database: Database; embeddingsDatabase: Database | null };

// A live catalogue is one promotion: never return fresh rows with old vectors.
// Dormant vectors stay lazy, but their cached generation must be invalidated.
export const refreshDatabasePair = async (
  coreUrl: string,
  embeddingsUrl: string,
  includeEmbeddings: boolean,
): Promise<DatabasePair> => {
  if (!includeEmbeddings) {
    cachedDatabases.delete(embeddingsUrl);
    databasePromises.delete(embeddingsUrl);
  }
  const [database, embeddingsDatabase] = await Promise.all([
    getDatabase(coreUrl, undefined, undefined, true),
    includeEmbeddings ? getDatabase(embeddingsUrl, coreUrl, undefined, true) : null,
  ]);
  return { database, embeddingsDatabase };
};

const useSqliteDatabase = (
  url: string,
  options?: { enabled?: boolean; fallbackUrl?: string },
): [Database | null, number, ProgressDetails, Error | null, (forceRefresh?: boolean) => void] => {
  const enabled = options?.enabled ?? true;
  const fallbackUrl = options?.fallbackUrl;
  const [{ database, progress, progressDetails, error }, dispatch] = useReducer(
    reducer,
    initialState,
  );
  const [retryCount, setRetryCount] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCancelled = false;
    dispatch({ type: "load:start" });

    const forceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false;

    getDatabase(
      url,
      fallbackUrl,
      (percent, details) => {
        if (isCancelled) {
          return;
        }

        dispatch({ type: "load:progress", percent, details });
      },
      forceRefresh,
    )
      .then((db) => {
        if (isCancelled) {
          return;
        }

        dispatch({ type: "load:success", database: db });
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }

        console.error("Failed to load database", err);
        dispatch({
          type: "load:error",
          error: err as Error,
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled, fallbackUrl, retryCount, url]);

  const retry = useCallback((forceRefresh = false) => {
    forceRefreshRef.current = forceRefresh;
    setRetryCount((c) => c + 1);
  }, []);

  return [database, progress, progressDetails, error, retry];
};

export const useDatabase = () => {
  const { searchDatabaseUrl } = usePublicConfig();
  return useSqliteDatabase(searchDatabaseUrl);
};

export const useEmbeddingsDatabase = (enabled = true) => {
  const { searchDatabaseUrl, searchEmbeddingsDatabaseUrl } = usePublicConfig();
  return useSqliteDatabase(searchEmbeddingsDatabaseUrl, {
    enabled,
    fallbackUrl: searchDatabaseUrl,
  });
};
