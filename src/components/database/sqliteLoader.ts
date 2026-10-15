import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { fetchWithDeadline } from "../../util/fetchWithDeadline";
type ProgressDetails = { loaded: number; total: number };

export const fetchWithProgress = async (
  url: string,
  onProgress: (progress: number, details: { loaded: number; total: number }) => void,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
) => {
  const res = init ? await fetcher(url, init) : await fetcher(url);
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
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            loaded += value.byteLength;
            onProgress((loaded / total) * 100, { loaded, total });
            controller.enqueue(value);
            push();
          })
          .catch((err) => {
            // A mid-download network error must surface: error the stream so the
            // downstream `response.arrayBuffer()` rejects instead of hanging
            // forever (which also leaves a stuck promise cached in
            // databasePromises). getDatabase's catch then evicts it so a retry
            // actually refetches.
            controller.error(err);
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
  setProgress?: (percent: number, details: { loaded: number; total: number }) => void,
  init?: RequestInit,
) => {
  console.log("Running SQLite3 version", sqlite3.version.libVersion);

  const response = await fetchWithProgress(url, setProgress || (() => {}), init, fetchWithDeadline);

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

export const initializeSQLite = async (
  url: string,
  fallbackUrl?: string,
  setProgress?: (percent: number, details: ProgressDetails) => void,
  forceRefresh = false,
): Promise<Database> => {
  let db: Database | undefined;
  try {
    console.log("Loading and initializing SQLite3 module...");
    const sqlite3 = await sqlite3InitModule();
    const requestInit = forceRefresh ? { cache: "no-store" as RequestCache } : undefined;
    try {
      db = await loadRemoteDatabase(sqlite3, url, setProgress, requestInit);
    } catch (err) {
      const shouldFallback =
        fallbackUrl && err instanceof Error && err.message.includes(`Failed to fetch ${url}: 404`);

      if (!shouldFallback) {
        throw err;
      }

      console.info(`Database ${url} not found, falling back to ${fallbackUrl}`);
      db = await loadRemoteDatabase(sqlite3, fallbackUrl, setProgress, requestInit);
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
