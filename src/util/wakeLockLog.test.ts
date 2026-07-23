import {
  appendWakeEvent,
  describeWakeEvent,
  readWakeLog,
  WAKE_LOG_MAX_ENTRIES,
  WAKE_LOG_STORAGE_KEY,
  type WakeLogEventType,
} from "./wakeLockLog";

// A minimal in-memory Storage so the pure log core is testable without a DOM.
const makeStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe("wakeLockLog", () => {
  it("appends events in order and reads them back", () => {
    const storage = makeStorage();
    appendWakeEvent("lost", 1000, storage);
    appendWakeEvent("acquired", 2000, storage);
    const log = readWakeLog(storage);
    expect(log).toEqual([
      { at: 1000, type: "lost" },
      { at: 2000, type: "acquired" },
    ]);
  });

  it("caps the log at the maximum, dropping the oldest entries (FIFO)", () => {
    const storage = makeStorage();
    const total = WAKE_LOG_MAX_ENTRIES + 10;
    for (let i = 0; i < total; i++) {
      appendWakeEvent("lost", i, storage);
    }
    const log = readWakeLog(storage);
    expect(log).toHaveLength(WAKE_LOG_MAX_ENTRIES);
    // The oldest 10 fell off the front; the newest survives at the end.
    expect(log[0]?.at).toBe(10);
    expect(log.at(-1)?.at).toBe(total - 1);
  });

  it("returns an empty log when nothing is stored", () => {
    expect(readWakeLog(makeStorage())).toEqual([]);
  });

  it("tolerates corrupt JSON and returns an empty log", () => {
    const storage = makeStorage({ [WAKE_LOG_STORAGE_KEY]: "{not json" });
    expect(readWakeLog(storage)).toEqual([]);
  });

  it("tolerates a non-array payload and discards malformed entries", () => {
    const storage = makeStorage({
      [WAKE_LOG_STORAGE_KEY]: JSON.stringify({ nope: true }),
    });
    expect(readWakeLog(storage)).toEqual([]);

    const mixed = makeStorage({
      [WAKE_LOG_STORAGE_KEY]: JSON.stringify([
        { at: 1, type: "lost" },
        { at: "bad", type: "lost" },
        { type: "acquired" },
        { at: 2, type: "not-a-real-type" },
        null,
        { at: 3, type: "cap-decayed" },
      ]),
    });
    expect(readWakeLog(mixed)).toEqual([
      { at: 1, type: "lost" },
      { at: 3, type: "cap-decayed" },
    ]);
  });

  it("silently tolerates a storage that throws on write (private mode)", () => {
    const storage = makeStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    // Must not throw; still returns the computed next log to the caller.
    const next = appendWakeEvent("lost", 5, storage);
    expect(next).toEqual([{ at: 5, type: "lost" }]);
  });

  it("silently tolerates a storage that throws on read", () => {
    const storage = makeStorage();
    storage.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(readWakeLog(storage)).toEqual([]);
  });

  it("returns an empty log when there is no storage at all", () => {
    expect(readWakeLog(null)).toEqual([]);
    expect(appendWakeEvent("lost", 1, null)).toEqual([{ at: 1, type: "lost" }]);
  });

  it("gives every event type British-English copy", () => {
    const types: WakeLogEventType[] = [
      "acquired",
      "lost",
      "reacquire-failed",
      "cap-reached",
      "cap-decayed",
    ];
    for (const type of types) {
      expect(describeWakeEvent(type)).toMatch(/\S/);
    }
  });
});
