import type { Database } from "@sqlite.org/sqlite-wasm";
import { initializeSQLite } from "./sqliteLoader";
import type { DatabaseRequest, DatabaseResponse } from "./sqliteWorkerProtocol";

const reply = (response: DatabaseResponse) => globalThis.postMessage(response);
let database: Database | null = null;
globalThis.addEventListener("message", async (event: MessageEvent<DatabaseRequest>) => {
  const request = event.data;
  try {
    if (request.type === "open") {
      database = await initializeSQLite(
        request.url,
        request.fallbackUrl,
        (percent, details) => reply({ type: "progress", percent, details }),
        request.forceRefresh,
      );
      const metadataColumns: string[] = [];
      database.exec({
        sql: "PRAGMA table_info(metadata)",
        callback: (row) => {
          if (typeof row[1] === "string") metadataColumns.push(row[1]);
        },
      });
      reply({ type: "ready", metadataColumns });
    } else {
      if (!database) throw new Error("Database is not ready");
      const rows: unknown[][] = [];
      database.exec({
        sql: request.sql,
        bind: request.bind,
        callback: (row) => {
          rows.push(row);
        },
      });
      reply({ type: "result", id: request.id, rows });
    }
  } catch (error) {
    reply({
      type: "error",
      ...(request.type === "exec" ? { id: request.id } : {}),
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
