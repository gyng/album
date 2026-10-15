import type { Database } from "@sqlite.org/sqlite-wasm";

type Execute = (sql: string, bind: (string | number)[]) => Promise<unknown[][]>;
const remoteExecutors = new WeakMap<Database, Execute>();

export const registerDatabaseExecutor = (database: Database, execute: Execute): void => {
  remoteExecutors.set(database, execute);
};

export const executeDatabase = async (
  database: Database,
  sql: string,
  bind: (string | number)[],
): Promise<unknown[][]> => {
  const remote = remoteExecutors.get(database);
  if (remote) return remote(sql, bind);
  const rows: unknown[][] = [];
  database.exec({
    sql,
    bind,
    callback: (row) => {
      rows.push(row);
    },
  });
  return rows;
};
