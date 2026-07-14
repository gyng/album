/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type BuildTimingModule = typeof import("./buildTiming");

const loadBuildTiming = (): BuildTimingModule => {
  let timing: BuildTimingModule | undefined;
  jest.isolateModules(() => {
    timing = require("./buildTiming") as BuildTimingModule;
  });
  return timing!;
};

describe("build timing instrumentation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALBUM_BUILD_PROFILE;
    delete process.env.ALBUM_BUILD_PROFILE_OUTPUT;
    delete process.env.ALBUM_BUILD_PROFILE_OUTPUT_DIR;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("is a transparent no-op when profiling is disabled", async () => {
    const timing = loadBuildTiming();
    const work = jest.fn(() => "result");

    expect(timing.isBuildTimingEnabled()).toBe(false);
    expect(timing.measureBuildSync("sync", work)).toBe("result");
    await expect(timing.measureBuild("async", async () => "async result")).resolves.toBe(
      "async result",
    );
    timing.incrementBuildCounter("photos");
    timing.recordBuildDuration("load", 12);
    timing.flushBuildProfile();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("records counters and successful and failed work before flushing once", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-timing-"));
    const outputPath = path.join(tempDir, "nested", "profile.json");
    process.env.ALBUM_BUILD_PROFILE = "1";
    process.env.ALBUM_BUILD_PROFILE_OUTPUT_DIR = path.join(tempDir, "unused-default-dir");
    process.env.ALBUM_BUILD_PROFILE_OUTPUT = outputPath;
    const handlers = new Map<string, () => void>();
    jest.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return process;
    }) as never);
    const timing = loadBuildTiming();

    expect(timing.isBuildTimingEnabled()).toBe(true);
    timing.incrementBuildCounter("photos");
    timing.incrementBuildCounter("photos", 2);
    timing.recordBuildDuration("manual", 4);
    timing.recordBuildDuration("manual", 9);
    expect(timing.measureBuildSync("sync", () => "ok")).toBe("ok");
    expect(() =>
      timing.measureBuildSync("sync-error", () => {
        throw new Error("sync failed");
      }),
    ).toThrow("sync failed");
    await expect(timing.measureBuild("async", async () => "ok")).resolves.toBe("ok");
    await expect(
      timing.measureBuild("async-error", async () => {
        throw new Error("async failed");
      }),
    ).rejects.toThrow("async failed");

    handlers.get("beforeExit")?.();
    handlers.get("exit")?.();
    timing.flushBuildProfile();

    const profile = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(profile.counters.photos).toBe(3);
    expect(profile.metrics.manual).toEqual({ count: 2, totalMs: 13, maxMs: 9 });
    expect(profile.metrics.sync.count).toBe(1);
    expect(profile.metrics["sync-error"].count).toBe(1);
    expect(profile.metrics.async.count).toBe(1);
    expect(profile.metrics["async-error"].count).toBe(1);
    expect(profile.finishedAt).toEqual(expect.any(String));
    expect(profile.durationMs).toEqual(expect.any(Number));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the configured output directory when no explicit file is supplied", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-timing-dir-"));
    process.env.ALBUM_BUILD_PROFILE = "1";
    process.env.ALBUM_BUILD_PROFILE_OUTPUT_DIR = tempDir;
    jest.spyOn(process, "once").mockImplementation((() => process) as never);
    const timing = loadBuildTiming();

    timing.flushBuildProfile();

    expect(fs.existsSync(path.join(tempDir, `${process.pid}.json`))).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
