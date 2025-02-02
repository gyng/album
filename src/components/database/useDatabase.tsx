import sqlite3InitModule, {
  Database,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import { useState, useEffect } from "react";

const fetchWithProgress = async (
  url: string,
  onProgress: (
    progress: number,
    details: { loaded: number; total: number },
  ) => void,
) => {
  const res = await fetch(url);
  if (!res.body)
    throw new Error("ReadableStream not yet supported in this browser.");
  const contentLength = res.headers.get("content-length");
  if (!contentLength)
    throw new Error("Content-Length response header unavailable");

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
  setProgress?: (
    percent: number,
    details: { loaded: number; total: number },
  ) => void,
) => {
  console.log("Running SQLite3 version", sqlite3.version.libVersion);

  const response = await fetchWithProgress(
    "/search.sqlite",
    setProgress || (() => {}),
  );

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
  setProgress?: (percent: number) => void,
): Promise<Database> => {
  let db;
  try {
    console.log("Loading and initializing SQLite3 module...");
    const sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
    });
    db = loadRemoteDatabase(sqlite3, setProgress);
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

export const useDatabase = (): [Database | null, number] => {
  const [database, setDatabase] = useState<Database | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    initializeSQLite(setProgress).then((db) => {
      setDatabase(db);
    });
  }, []);

  return [database, progress];
};
