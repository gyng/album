/** @jest-environment jsdom */
import { openWorkerDatabase } from "./sqliteWorkerClient";
import { executeDatabase } from "./databaseExecution";
import type { DatabaseResponse } from "./sqliteWorkerProtocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, (event: any) => void>();
  postMessage = jest.fn();
  terminate = jest.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, listener);
  }
  reply(data: DatabaseResponse) {
    this.listeners.get("message")?.({ data });
  }
}
beforeEach(() => {
  jest.useFakeTimers();
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
});
afterEach(() => {
  jest.useRealTimers();
});

it("reports downloads, exposes schema compatibility and routes concurrent query rows", async () => {
  const progress = jest.fn();
  const opening = openWorkerDatabase("/core.sqlite", undefined, progress);
  const worker = FakeWorker.instances[0]!;
  worker.reply({ type: "progress", percent: 50, details: { loaded: 1, total: 2 } });
  expect(progress).toHaveBeenCalledWith(50, { loaded: 1, total: 2 });
  worker.reply({ type: "ready", metadataColumns: ["geo_city"] });
  const database = await opening;
  const callback = jest.fn();
  database.exec({
    sql: "SELECT 1 FROM pragma_table_info('metadata') WHERE name = 'geo_city' LIMIT 1",
    callback,
  });
  expect(callback).toHaveBeenCalledWith([1]);
  callback.mockClear();
  database.exec({
    sql: "SELECT 1 FROM pragma_table_info('metadata') WHERE name = 'media_kind' LIMIT 1",
    callback,
  });
  expect(callback).not.toHaveBeenCalled();
  const first = executeDatabase(database, "SELECT ?", ["cat"]);
  const second = executeDatabase(database, "SELECT ?", ["fox"]);
  worker.reply({ type: "result", id: 2, rows: [["fox"]] });
  worker.reply({ type: "result", id: 1, rows: [["cat"]] });
  expect(await first).toEqual([["cat"]]);
  expect(await second).toEqual([["fox"]]);
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: "exec",
    id: 1,
    sql: "SELECT ?",
    bind: ["cat"],
  });
  expect(jest.getTimerCount()).toBe(0);
});

it("keeps query errors isolated and rejects outstanding work if the worker dies", async () => {
  const opening = openWorkerDatabase("/core.sqlite");
  const worker = FakeWorker.instances[0]!;
  worker.reply({ type: "ready", metadataColumns: [] });
  const database = await opening;
  const bad = executeDatabase(database, "bad SQL", []);
  worker.reply({ type: "error", id: 1, message: "syntax error" });
  await expect(bad).rejects.toThrow("syntax error");
  const next = executeDatabase(database, "SELECT 1", []);
  worker.listeners.get("error")?.({});
  await expect(next).rejects.toThrow("could not load");
  await expect(executeDatabase(database, "SELECT 2", [])).rejects.toThrow("could not load");
  expect(worker.terminate).toHaveBeenCalled();
});

it("times out silent loads while allowing a download that continues to progress", async () => {
  const opening = openWorkerDatabase("/core.sqlite");
  const worker = FakeWorker.instances[0]!;
  jest.advanceTimersByTime(59_000);
  worker.reply({ type: "progress", percent: 10, details: { loaded: 1, total: 10 } });
  jest.advanceTimersByTime(59_000);
  expect(worker.terminate).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1_000);
  await expect(opening).rejects.toThrow("stopped responding");
  const retry = openWorkerDatabase("/core.sqlite");
  FakeWorker.instances[1]!.reply({ type: "ready", metadataColumns: [] });
  await expect(retry).resolves.toBeDefined();
});
