import fs from "node:fs";
import path from "node:path";

type BuildMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type BuildProfile = {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  pid: number;
  metrics: Record<string, BuildMetric>;
  counters: Record<string, number>;
};

const enabled = process.env.ALBUM_BUILD_PROFILE === "1";
const startedAtMs = Date.now();
const outputDir =
  process.env.ALBUM_BUILD_PROFILE_OUTPUT_DIR ??
  path.join(process.cwd(), ".next", "album-build-profiles");
const outputPath =
  process.env.ALBUM_BUILD_PROFILE_OUTPUT ?? path.join(outputDir, `${process.pid}.json`);

const profile: BuildProfile = {
  startedAt: new Date(startedAtMs).toISOString(),
  pid: process.pid,
  metrics: {},
  counters: {},
};

let hasRegisteredExitHandlers = false;
let pendingWrite: ReturnType<typeof setTimeout> | null = null;
// Next 16 ends its build workers without running exit handlers, so the profile
// is also written shortly after each measurement: a worker that is terminated
// loses at most this window, rather than everything it measured.
const WRITE_DELAY_MS = 250;

const getMetric = (name: string): BuildMetric => {
  const existing = profile.metrics[name];

  if (existing) {
    return existing;
  }

  const created: BuildMetric = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };
  profile.metrics[name] = created;
  return created;
};

const flushProfileSync = () => {
  if (!enabled) {
    return;
  }

  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
  }
  profile.finishedAt = new Date().toISOString();
  profile.durationMs = Date.now() - startedAtMs;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(profile, null, 2));
};

const scheduleWrite = () => {
  if (!enabled || pendingWrite) {
    return;
  }

  pendingWrite = setTimeout(flushProfileSync, WRITE_DELAY_MS);
  // Never the reason a build process stays alive.
  pendingWrite.unref?.();
};

const registerExitHandlers = () => {
  if (!enabled || hasRegisteredExitHandlers) {
    return;
  }

  hasRegisteredExitHandlers = true;
  process.once("beforeExit", flushProfileSync);
  process.once("exit", flushProfileSync);
};

registerExitHandlers();

export const isBuildTimingEnabled = (): boolean => enabled;

export const incrementBuildCounter = (name: string, delta = 1) => {
  if (!enabled) {
    return;
  }

  profile.counters[name] = (profile.counters[name] ?? 0) + delta;
  scheduleWrite();
};

export const recordBuildDuration = (name: string, durationMs: number) => {
  if (!enabled) {
    return;
  }

  const metric = getMetric(name);
  metric.count += 1;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  scheduleWrite();
};

export const measureBuildSync = <T>(name: string, fn: () => T): T => {
  if (!enabled) {
    return fn();
  }

  const startedAt = process.hrtime.bigint();

  try {
    return fn();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordBuildDuration(name, durationMs);
  }
};

export const measureBuild = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  if (!enabled) {
    return fn();
  }

  const startedAt = process.hrtime.bigint();

  try {
    return await fn();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordBuildDuration(name, durationMs);
  }
};

export const flushBuildProfile = () => {
  flushProfileSync();
};
