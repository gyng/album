import type { Database } from "@sqlite.org/sqlite-wasm";
import { registerDatabaseExecutor } from "./databaseExecution";
import type { DatabaseRequest, DatabaseResponse } from "./sqliteWorkerProtocol";

/** One worker owns one immutable database generation; only rows cross the port. */
export const openWorkerDatabase = (
  url: string,
  fallbackUrl?: string,
  onProgress?: (percent: number, details: { loaded: number; total: number }) => void,
  forceRefresh = false,
): Promise<Database> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url));
    let nextId = 0;
    let failed: Error | null = null;
    const pending = new Map<
      number,
      { resolve: (rows: unknown[][]) => void; reject: (error: Error) => void }
    >();
    const fail = (error: Error) => {
      failed = error;
      clearTimeout(deadline);
      worker.terminate();
      reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    // Progress resets an inactivity deadline, allowing large databases to download.
    let deadline: ReturnType<typeof setTimeout>;
    const armDeadline = () => {
      clearTimeout(deadline);
      deadline = setTimeout(() => fail(new Error("Database worker stopped responding")), 60_000);
    };
    const send = (request: DatabaseRequest) => worker.postMessage(request);
    armDeadline();
    worker.addEventListener("error", () => fail(new Error("Database worker could not load")));
    worker.addEventListener("messageerror", () =>
      fail(new Error("Database worker returned an unreadable response")),
    );
    worker.addEventListener("message", (event: MessageEvent<DatabaseResponse>) => {
      if (failed) return;
      const response = event.data;
      if (response.type === "progress") {
        armDeadline();
        onProgress?.(response.percent, response.details);
      } else if (response.type === "ready") {
        clearTimeout(deadline);
        // Synchronous compatibility probes use the schema snapshot from the worker.
        // Application data queries must go through executeDatabase.
        const database = {
          exec: ({ sql, callback }: { sql: string; callback: (row: unknown[]) => void }) => {
            const column =
              /^SELECT 1 FROM pragma_table_info\('metadata'\) WHERE name = '([^']+)' LIMIT 1$/.exec(
                sql,
              )?.[1];
            if (!column)
              throw new Error("Synchronous queries are unavailable on a worker database");
            if (response.metadataColumns.includes(column)) callback([1]);
          },
        } as unknown as Database;
        registerDatabaseExecutor(
          database,
          (sql, bind) =>
            new Promise((resolveRows, rejectRows) => {
              if (failed) {
                rejectRows(failed);
                return;
              }
              const id = ++nextId;
              pending.set(id, { resolve: resolveRows, reject: rejectRows });
              armDeadline();
              send({ type: "exec", id, sql, bind });
            }),
        );
        resolve(database);
      } else if (response.type === "error" && response.id === undefined) {
        fail(new Error(response.message));
      } else if (response.type === "result" || response.type === "error") {
        const request = response.id === undefined ? undefined : pending.get(response.id);
        if (!request) return;
        pending.delete(response.id!);
        if (pending.size === 0) clearTimeout(deadline);
        else armDeadline();
        if (response.type === "error") request.reject(new Error(response.message));
        else request.resolve(response.rows);
      }
    });
    send({ type: "open", url, ...(fallbackUrl ? { fallbackUrl } : {}), forceRefresh });
  });
