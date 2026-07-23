import {
  appendShellEvent,
  describeShellEvent,
  detectHeartbeatGap,
  formatGapDuration,
  HEARTBEAT_GAP_THRESHOLD_MS,
  HEARTBEAT_STORAGE_KEY,
  readHeartbeat,
  readShellLog,
  readShellStatus,
  serialiseDiagnostics,
  SHELL_LOG_MAX_ENTRIES,
  SHELL_LOG_STORAGE_KEY,
  SHELL_STATUS_STORAGE_KEY,
  writeHeartbeat,
  writeShellStatus,
  type DiagnosticsReport,
  type ShellLogEntry,
} from "./shellDiagnosticsLog";

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

describe("shellDiagnosticsLog", () => {
  it("appends events across categories in order and reads them back", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "lost" }, 1000, storage);
    appendShellEvent({ category: "code", type: "reload", version: "abcdef1234" }, 2000, storage);
    appendShellEvent({ category: "network", type: "offline" }, 3000, storage);
    appendShellEvent({ category: "visibility", type: "hidden" }, 4000, storage);
    appendShellEvent({ category: "gap", type: "gap", durationMs: 120000 }, 5000, storage);
    expect(readShellLog(storage)).toEqual([
      { at: 1000, category: "wake", type: "lost" },
      { at: 2000, category: "code", type: "reload", version: "abcdef1234" },
      { at: 3000, category: "network", type: "offline" },
      { at: 4000, category: "visibility", type: "hidden" },
      { at: 5000, category: "gap", type: "gap", durationMs: 120000 },
    ]);
  });

  it("caps the log at the maximum, dropping the oldest entries (FIFO)", () => {
    const storage = makeStorage();
    const total = SHELL_LOG_MAX_ENTRIES + 10;
    for (let i = 0; i < total; i++) {
      // Alternate types so consecutive entries never coalesce — this test is
      // about the cap, not the coalescing behaviour.
      appendShellEvent({ category: "wake", type: i % 2 === 0 ? "lost" : "acquired" }, i, storage);
    }
    const log = readShellLog(storage);
    expect(log).toHaveLength(SHELL_LOG_MAX_ENTRIES);
    expect(log[0]?.at).toBe(10);
    expect(log.at(-1)?.at).toBe(total - 1);
  });

  it("returns an empty log when nothing is stored", () => {
    expect(readShellLog(makeStorage())).toEqual([]);
  });

  it("tolerates corrupt JSON and returns an empty log", () => {
    const storage = makeStorage({ [SHELL_LOG_STORAGE_KEY]: "{not json" });
    expect(readShellLog(storage)).toEqual([]);
  });

  it("tolerates a non-array payload and discards malformed entries", () => {
    const storage = makeStorage({
      [SHELL_LOG_STORAGE_KEY]: JSON.stringify({ nope: true }),
    });
    expect(readShellLog(storage)).toEqual([]);

    const mixed = makeStorage({
      [SHELL_LOG_STORAGE_KEY]: JSON.stringify([
        { at: 1, category: "wake", type: "lost" },
        { at: "bad", category: "wake", type: "lost" },
        { category: "wake", type: "acquired" },
        { at: 2, category: "wake", type: "not-a-real-type" },
        { at: 3, category: "not-a-category", type: "lost" },
        { at: 4, category: "gap", type: "gap" }, // gap missing durationMs
        null,
        { at: 5, category: "code", type: "version-skew", version: "deadbeef" },
      ]),
    });
    expect(readShellLog(mixed)).toEqual([
      { at: 1, category: "wake", type: "lost" },
      { at: 5, category: "code", type: "version-skew", version: "deadbeef" },
    ]);
  });

  it("silently tolerates a storage that throws on write (private mode)", () => {
    const storage = makeStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    const next = appendShellEvent({ category: "wake", type: "lost" }, 5, storage);
    expect(next).toEqual([{ at: 5, category: "wake", type: "lost" }]);
  });

  it("silently tolerates a storage that throws on read", () => {
    const storage = makeStorage();
    storage.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(readShellLog(storage)).toEqual([]);
  });

  it("returns an empty log when there is no storage at all", () => {
    expect(readShellLog(null)).toEqual([]);
    expect(appendShellEvent({ category: "wake", type: "lost" }, 1, null)).toEqual([
      { at: 1, category: "wake", type: "lost" },
    ]);
  });

  it("gives every event a British-English label", () => {
    const entries: ShellLogEntry[] = [
      { at: 0, category: "wake", type: "acquired" },
      { at: 0, category: "wake", type: "lost" },
      { at: 0, category: "wake", type: "reacquire-failed" },
      { at: 0, category: "wake", type: "cap-reached" },
      { at: 0, category: "wake", type: "cap-decayed" },
      { at: 0, category: "code", type: "reload", version: "abcdef1234" },
      { at: 0, category: "code", type: "reload" },
      { at: 0, category: "code", type: "retry-cap-reached" },
      { at: 0, category: "code", type: "version-skew", version: "abcdef1234" },
      { at: 0, category: "network", type: "online" },
      { at: 0, category: "network", type: "offline" },
      { at: 0, category: "visibility", type: "visible" },
      { at: 0, category: "visibility", type: "hidden" },
      { at: 0, category: "gap", type: "gap", durationMs: 120000 },
    ];
    for (const entry of entries) {
      expect(describeShellEvent(entry)).toMatch(/\S/);
    }
    // The reload label carries the short target version.
    expect(
      describeShellEvent({ at: 0, category: "code", type: "reload", version: "abcdef1234" }),
    ).toContain("abcdef12");
    // The gap label carries the humanised duration.
    expect(describeShellEvent({ at: 0, category: "gap", type: "gap", durationMs: 8100000 })).toBe(
      "Page was not running for 2 hours 15 minutes",
    );
  });
});

describe("heartbeat gap detection", () => {
  it("writes and reads a single rolling heartbeat key", () => {
    const storage = makeStorage();
    writeHeartbeat(12345, storage);
    expect(storage.getItem(HEARTBEAT_STORAGE_KEY)).toBe("12345");
    expect(readHeartbeat(storage)).toBe(12345);
  });

  it("reports no gap for the first-ever launch (no previous beat)", () => {
    expect(detectHeartbeatGap(null, 1_000_000)).toBeNull();
  });

  it("reports no gap for a beat within the threshold", () => {
    const now = 1_000_000;
    expect(detectHeartbeatGap(now - (HEARTBEAT_GAP_THRESHOLD_MS - 1000), now)).toBeNull();
  });

  it("reports the gap duration once the freeze threshold is exceeded", () => {
    const now = 1_000_000;
    const previous = now - (HEARTBEAT_GAP_THRESHOLD_MS + 30000);
    expect(detectHeartbeatGap(previous, now)).toBe(HEARTBEAT_GAP_THRESHOLD_MS + 30000);
  });

  it("tolerates a missing or corrupt heartbeat value", () => {
    const storage = makeStorage({ [HEARTBEAT_STORAGE_KEY]: "not-a-number" });
    expect(readHeartbeat(storage)).toBeNull();
    expect(readHeartbeat(makeStorage())).toBeNull();
    expect(readHeartbeat(null)).toBeNull();
  });
});

describe("formatGapDuration", () => {
  it("phrases sub-minute gaps in seconds", () => {
    expect(formatGapDuration(45000)).toBe("45 seconds");
    expect(formatGapDuration(1000)).toBe("1 second");
  });

  it("phrases minute and hour gaps in en-GB", () => {
    expect(formatGapDuration(3 * 60000)).toBe("3 minutes");
    expect(formatGapDuration(60 * 60000)).toBe("1 hour");
    expect(formatGapDuration((2 * 60 + 14) * 60000)).toBe("2 hours 14 minutes");
  });
});

describe("serialiseDiagnostics", () => {
  const baseReport = (): DiagnosticsReport => ({
    now: Date.UTC(2026, 6, 23, 2, 30, 0),
    sessionStart: Date.UTC(2026, 6, 22, 20, 0, 0),
    buildVersion: "build-current",
    runtimeVersion: "build-runtime",
    codeStatus: "current",
    wake: { supported: true, active: false, losses: 3 },
    online: true,
    device: {
      userAgent: "TestAgent/1.0",
      standalone: true,
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2,
    },
    log: [
      { at: Date.UTC(2026, 6, 23, 2, 14, 0), category: "wake", type: "cap-reached" },
      { at: Date.UTC(2026, 6, 23, 2, 15, 0), category: "gap", type: "gap", durationMs: 8100000 },
    ],
  });

  it("builds a text payload carrying the build version and a known event", () => {
    const text = serialiseDiagnostics(baseReport());
    expect(text).toContain("Shell build: build-current");
    expect(text).toContain("Gave up retrying");
    expect(text).toContain("Page was not running for 2 hours 15 minutes");
    expect(text).toContain("TestAgent/1.0");
    expect(text).toContain("Standalone: yes");
    expect(text).toContain("1920×1080 @2x");
    expect(text).toContain("Wake lock: off (losses: 3)");
  });

  it("handles an empty log without throwing", () => {
    const report = { ...baseReport(), log: [] };
    expect(serialiseDiagnostics(report)).toContain("(no events recorded)");
  });
});

describe("shell status snapshot", () => {
  const snapshot = () => ({
    at: 5000,
    sessionStart: 1000,
    shellVersion: "build-shell",
    runtimeVersion: "build-runtime",
    codeStatus: "current",
    online: true,
    wake: { supported: true, active: false, losses: 2 },
  });

  it("writes and reads back the shell's own view of its state", () => {
    const storage = makeStorage();
    writeShellStatus(snapshot(), storage);
    expect(readShellStatus(storage)).toEqual(snapshot());
  });

  it("returns null when nothing has been written", () => {
    expect(readShellStatus(makeStorage())).toBeNull();
  });

  it("tolerates corrupt or malformed snapshots", () => {
    expect(readShellStatus(makeStorage({ [SHELL_STATUS_STORAGE_KEY]: "{" }))).toBeNull();
    expect(
      readShellStatus(makeStorage({ [SHELL_STATUS_STORAGE_KEY]: JSON.stringify({ at: "soon" }) })),
    ).toBeNull();
    expect(
      readShellStatus(
        makeStorage({ [SHELL_STATUS_STORAGE_KEY]: JSON.stringify({ ...snapshot(), wake: null }) }),
      ),
    ).toBeNull();
  });

  it("silently tolerates a storage that throws", () => {
    const throwing = makeStorage();
    throwing.getItem = () => {
      throw new Error("denied");
    };
    throwing.setItem = () => {
      throw new Error("denied");
    };
    expect(() => writeShellStatus(snapshot(), throwing)).not.toThrow();
    expect(readShellStatus(throwing)).toBeNull();
  });
});

describe("coalescing repeated events", () => {
  it("coalesces consecutive identical events into one entry preserving the onset time", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 1000, storage);
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 61000, storage);
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 121000, storage);

    const log = readShellLog(storage);
    expect(log).toHaveLength(1);
    const entry = log[0] as Extract<ShellLogEntry, { category: "wake" }>;
    expect(entry.at).toBe(1000);
    expect(entry.count).toBe(3);
    expect(entry.lastAt).toBe(121000);
  });

  it("does not coalesce across different types, categories, or code versions", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "lost" }, 1000, storage);
    appendShellEvent({ category: "wake", type: "acquired" }, 2000, storage);
    appendShellEvent({ category: "code", type: "reload", version: "a" }, 3000, storage);
    appendShellEvent({ category: "code", type: "reload", version: "b" }, 4000, storage);

    expect(readShellLog(storage)).toHaveLength(4);
  });

  it("never coalesces gap events so each freeze keeps its own duration", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "gap", type: "gap", durationMs: 5000 }, 1000, storage);
    appendShellEvent({ category: "gap", type: "gap", durationMs: 5000 }, 2000, storage);

    expect(readShellLog(storage)).toHaveLength(2);
  });

  it("renders the repeat multiplier in the description", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 1000, storage);
    const log = appendShellEvent({ category: "wake", type: "reacquire-failed" }, 2000, storage);

    expect(describeShellEvent(log[0]!)).toContain("×2");
  });
});

describe("retry-cycle coalescing across the decay pattern", () => {
  it("keeps a whole night of decay cycles down to one entry per cycle type", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "lost" }, 0, storage);
    // Three full cycles: failed attempts, cap, decay, repeat.
    let t = 1000;
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 5; i++) {
        appendShellEvent({ category: "wake", type: "reacquire-failed" }, (t += 60000), storage);
      }
      appendShellEvent({ category: "wake", type: "cap-reached" }, (t += 1000), storage);
      appendShellEvent({ category: "wake", type: "cap-decayed" }, (t += 600000), storage);
    }

    const log = readShellLog(storage);
    // Onset entry plus one coalesced entry per cycle type — not 3 per cycle.
    expect(log).toHaveLength(4);
    const failed = log.find(
      (e): e is Extract<ShellLogEntry, { category: "wake" }> =>
        e.category === "wake" && e.type === "reacquire-failed",
    );
    expect(failed?.count).toBe(15);
    expect(failed?.lastAt).toBeGreaterThan(failed?.at ?? 0);
  });

  it("does not reach across non-cycle entries to coalesce", () => {
    const storage = makeStorage();
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 1000, storage);
    appendShellEvent({ category: "network", type: "offline" }, 2000, storage);
    appendShellEvent({ category: "wake", type: "reacquire-failed" }, 3000, storage);

    expect(readShellLog(storage)).toHaveLength(3);
  });
});
