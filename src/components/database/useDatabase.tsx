import sqlite3InitModule, {
  Database,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import { useState, useEffect, useCallback, useReducer } from "react";

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

const reducer = (
  state: UseDatabaseState,
  action: Action,
): UseDatabaseState => {
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
    default:
      return state;
  }
};

const cachedDatabases = new Map<string, Database>();
const databasePromises = new Map<string, Promise<Database>>();

const fetchWithProgress = async (
  url: string,
  onProgress: (
    progress: number,
    details: { loaded: number; total: number },
  ) => void,
) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  if (!res.body) {
    onProgress(0, { loaded: 0, total: 0 });
    return res;
  }

  const contentLength = res.headers.get("content-length");
  if (!contentLength) {
    onProgress(0, { loaded: 0, total: 0 });
    return res;
  }

  const total = parseInt(contentLength, 10);
  let loaded = 0;

  const reader = res.body.getReader();
  const stream = new ReadableStream({
    start(controller) {
      function push() {
        reader.read().then(({ done, value }) => {
          if (done) {
            controller.close();
            return;
          }
          loaded += value.byteLength;
          onProgress((loaded / total) * 100, { loaded, total });
          controller.enqueue(value);
          push();
        });
      }
      push();
    },
  });

  return new Response(stream);
};

const loadRemoteDatabase = async (
  sqlite3: Sqlite3Static,
  url: string,
  setProgress?: (
    percent: number,
    details: { loaded: number; total: number },
  ) => void,
) => {
  console.log("Running SQLite3 version", sqlite3.version.libVersion);

  const response = await fetchWithProgress(url, setProgress || (() => {}));

  const arrayBuffer = await response.arrayBuffer();
  const p = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
  const db = new sqlite3.oo1.DB();
  if (db.pointer) {
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      p,
      arrayBuffer.byteLength,
      arrayBuffer.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
      // Optionally:
      // | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
    );
    db.checkRc(rc);
    return db;
  } else {
    throw new Error("Database pointer is undefined");
  }
};

const initializeSQLite = async (
  url: string,
  fallbackUrl?: string,
  setProgress?: (percent: number, details: ProgressDetails) => void,
): Promise<Database> => {
  let db: Database | undefined;
  try {
    console.log("Loading and initializing SQLite3 module...");
    const sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
    });
    try {
      db = await loadRemoteDatabase(sqlite3, url, setProgress);
    } catch (err) {
      const shouldFallback =
        fallbackUrl &&
        err instanceof Error &&
        err.message.includes(`Failed to fetch ${url}: 404`);

      if (!shouldFallback) {
        throw err;
      }

      console.info(
        `Database ${url} not found, falling back to ${fallbackUrl}`,
      );
      db = await loadRemoteDatabase(sqlite3, fallbackUrl, setProgress);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error("Initialization error:", err.name, err.message);
    } else {
      console.error("Initialization error:", err);
    }
  }

  if (!db) {
    throw new Error("Failed to initialise SQLite");
  }

  return db;
};

export const databaseLoaderInternals = {
  fetchWithProgress,
  initializeSQLite,
  resetForTesting: () => {
    cachedDatabases.clear();
    databasePromises.clear();
  },
};

const getDatabase = (
  url: string,
  fallbackUrl?: string,
  setProgress?: (percent: number, details: ProgressDetails) => void,
): Promise<Database> => {
  const cachedDatabase = cachedDatabases.get(url);
  if (cachedDatabase) {
    setProgress?.(100, { loaded: 0, total: 0 });
    return Promise.resolve(cachedDatabase);
  }

  const existingPromise = databasePromises.get(url);
  if (existingPromise) {
    return existingPromise;
  }

  const databasePromise = initializeSQLite(url, fallbackUrl, setProgress)
    .then((database) => {
      cachedDatabases.set(url, database);
      return database;
    })
    .catch((err) => {
      databasePromises.delete(url);
      throw err;
    });

  databasePromises.set(url, databasePromise);
  return databasePromise;
};

const useSqliteDatabase = (
  url: string,
  options?: { enabled?: boolean; fallbackUrl?: string },
): [
  Database | null,
  number,
  ProgressDetails,
  Error | null,
  () => void,
] => {
  const enabled = options?.enabled ?? true;
  const fallbackUrl = options?.fallbackUrl;
  const [{ database, progress, progressDetails, error }, dispatch] =
    useReducer(reducer, initialState);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCancelled = false;
    dispatch({ type: "load:start" });

    getDatabase(url, fallbackUrl, (percent, details) => {
      if (isCancelled) {
        return;
      }

      dispatch({ type: "load:progress", percent, details });
    })
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
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled, fallbackUrl, retryCount, url]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return [database, progress, progressDetails, error, retry];
};

export const useDatabase = () => {
  return useSqliteDatabase("/search.sqlite");
};

export const useEmbeddingsDatabase = (enabled = true) => {
  return useSqliteDatabase("/search-embeddings.sqlite", {
    enabled,
    fallbackUrl: "/search.sqlite",
  });
};
