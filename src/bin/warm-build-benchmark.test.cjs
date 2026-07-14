/**
 * @jest-environment node
 */

jest.mock("child_process", () => ({ spawnSync: jest.fn() }));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  aggregateProfiles,
  evaluateBudget,
  findLastDurationMs,
  formatMs,
  median,
  parseTraceEntries,
  readBudget,
  runBenchmark,
  runBuild,
  summarizeMetrics,
} = require("./warm-build-benchmark.cjs");

describe("warm build benchmark", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    spawnSync.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("parses line-delimited trace arrays and ignores absent or malformed content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "warm-trace-"));
    const trace = path.join(root, "trace");

    expect(parseTraceEntries(path.join(root, "missing"))).toEqual([]);
    fs.writeFileSync(trace, "  ");
    expect(parseTraceEntries(trace)).toEqual([]);
    fs.writeFileSync(trace, '[{"name":"one","duration":1000}]\nnot-json\n{"name":"ignored"}');
    expect(parseTraceEntries(trace)).toEqual([{ name: "one", duration: 1000 }]);
  });

  it("finds the final trace duration and calculates robust medians", () => {
    const entries = [
      { name: "build", duration: 1000 },
      { name: "other", duration: 9000 },
      { name: "build", duration: 3000 },
    ];
    expect(findLastDurationMs(entries, "build")).toBe(3);
    expect(findLastDurationMs(entries, "missing")).toBeNull();
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 3, 1, 2])).toBe(2);
    expect(median([4, 2])).toBe(3);
    expect(formatMs(1.234)).toBe("1.23ms");
  });

  it("summarises and aggregates profile counters and metrics", () => {
    expect(aggregateProfiles([])).toBeNull();
    expect(summarizeMetrics()).toEqual({});
    expect(
      summarizeMetrics({
        zero: { count: 0, totalMs: 0, maxMs: 0 },
        work: { count: 2, totalMs: 5.555, maxMs: 4.444 },
      }),
    ).toEqual({
      work: { count: 2, totalMs: 5.55, maxMs: 4.44, averageMs: 2.78 },
      zero: { count: 0, totalMs: 0, maxMs: 0, averageMs: 0 },
    });

    expect(
      aggregateProfiles([
        {
          startedAt: "2026-01-02",
          finishedAt: "2026-01-03",
          durationMs: 10,
          counters: { photos: 2 },
          metrics: { work: { count: 1, totalMs: 3, maxMs: 3 } },
        },
        {
          startedAt: "2026-01-01",
          finishedAt: "2026-01-04",
          durationMs: undefined,
          counters: { photos: 1, videos: 2 },
          metrics: {
            work: { count: 2, totalMs: 5, maxMs: 4 },
            partial: {},
          },
        },
        {},
      ]),
    ).toMatchObject({
      startedAt: "2026-01-01",
      finishedAt: "2026-01-04",
      durationMs: 10,
      processCount: 3,
      counters: { photos: 3, videos: 2 },
      metrics: {
        partial: { count: 0, totalMs: 0, maxMs: 0, averageMs: 0 },
        work: { count: 3, totalMs: 8, maxMs: 4, averageMs: 2.67 },
      },
    });
  });

  it("evaluates only finite, positive regressions beyond configured budgets", () => {
    expect(evaluateBudget({}, null)).toEqual([]);
    expect(evaluateBudget({}, {})).toEqual([]);
    const budget = {
      metrics: {
        missing: { baselineMs: 10, maxRegressionMs: 1 },
        invalid: { baselineMs: Number.NaN, maxRegressionMs: 1 },
        improved: { baselineMs: 100, maxRegressionMs: 1 },
        within: { baselineMs: 100, maxRegressionMs: 20, maxRegressionPercent: 20 },
        absolute: { baselineMs: 100, maxRegressionMs: 5 },
        percent: { baselineMs: 100, maxRegressionPercent: 5 },
      },
    };

    expect(
      evaluateBudget(
        {
          invalid: 120,
          improved: 90,
          within: 110,
          absolute: 110,
          percent: 110,
        },
        budget,
      ),
    ).toEqual([
      {
        metric: "absolute",
        actualMs: 110,
        baselineMs: 100,
        regressionMs: 10,
        regressionPercent: 10,
        allowedRegressionMs: 5,
        allowedRegressionPercent: null,
      },
      {
        metric: "percent",
        actualMs: 110,
        baselineMs: 100,
        regressionMs: 10,
        regressionPercent: 10,
        allowedRegressionMs: null,
        allowedRegressionPercent: 5,
      },
    ]);
  });

  it("reads valid budgets and warns on Error and non-Error parse failures", () => {
    jest.spyOn(fs, "existsSync").mockReturnValueOnce(false).mockReturnValue(true);
    expect(readBudget()).toBeNull();

    jest.spyOn(fs, "readFileSync").mockReturnValueOnce('{"metrics":{}}');
    expect(readBudget()).toEqual({ metrics: {} });

    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.readFileSync.mockReturnValueOnce("{");
    expect(readBudget()).toBeNull();
    fs.readFileSync.mockImplementationOnce(() => {
      throw "unreadable";
    });
    expect(readBudget()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("collects successful build traces and profiles", () => {
    const trace = [
      { name: "next-build", duration: 10000 },
      { name: "next-build", duration: 20000 },
      { name: "static-check", duration: 5000 },
      { name: "check-page", duration: 3000, tags: { page: "/slow" } },
      { name: "check-page", duration: 1000, tags: { page: "/fast" } },
      { name: "check-page", duration: 9000, tags: {} },
    ];
    jest.spyOn(fs, "rmSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readdirSync").mockReturnValue(["one.json", "ignored.txt"]);
    jest.spyOn(fs, "readFileSync").mockImplementation((file) =>
      String(file).endsWith("trace")
        ? JSON.stringify(trace)
        : JSON.stringify({
            startedAt: "2026-01-01",
            finishedAt: "2026-01-02",
            durationMs: 20,
            counters: {},
            metrics: {},
          }),
    );
    const times = [10n, 5_000_010n];
    jest.spyOn(process.hrtime, "bigint").mockImplementation(() => times.shift());
    spawnSync.mockReturnValue({ status: 0 });

    const result = runBuild(1);

    expect(result).toMatchObject({
      run: 1,
      wallTimeMs: 5,
      trace: {
        nextBuildMs: 20,
        staticCheckMs: 5,
        slowestPages: [
          { page: "/slow", durationMs: 3 },
          { page: "/fast", durationMs: 1 },
        ],
      },
      profile: { processCount: 1 },
    });
    expect(spawnSync).toHaveBeenCalledWith("npm", ["run", "build"], expect.any(Object));
  });

  it("reports failed builds and an absent profile directory", () => {
    jest.spyOn(fs, "rmSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const times = [0n, 1n];
    jest.spyOn(process.hrtime, "bigint").mockImplementation(() => times.shift());
    spawnSync.mockReturnValueOnce({ status: 2 });
    expect(() => runBuild(2)).toThrow("Warm build run 2 failed with exit code 2");

    spawnSync.mockReturnValueOnce({ status: 0 });
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const result = runBuild(3);
    expect(result.profile).toBeNull();
    expect(result.trace.slowestPages).toEqual([]);
  });

  it("writes benchmark summaries and marks strict budget regressions as failed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "warm-benchmark-"));
    const outputPath = path.join(root, "report.json");
    const build = jest.fn((index) => ({
      run: index,
      wallTimeMs: index * 100,
      trace: {
        nextBuildMs: index * 10,
        staticCheckMs: null,
        staticGenerationMs: index * 5,
        slowestPages: [{ page: "/", durationMs: index }],
      },
      profile: null,
    }));
    const log = jest.fn();
    const warn = jest.fn();
    const markFailed = jest.fn();

    const report = runBenchmark({
      runCount: 2,
      build,
      now: () => new Date("2026-01-02T03:04:05Z"),
      budget: {
        warnOnly: false,
        metrics: { medianWallTimeMs: { baselineMs: 100, maxRegressionMs: 10 } },
      },
      outputPath,
      log,
      warn,
      markFailed,
    });

    expect(report.summary).toEqual({
      medianWallTimeMs: 150,
      medianNextBuildMs: 15,
      medianStaticCheckMs: null,
      medianStaticGenerationMs: 7.5,
    });
    expect(report.budget).toMatchObject({ warnOnly: false, warnings: [expect.any(Object)] });
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("uses default adapters and supports environment-forced budget failure", () => {
    const write = jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    const emptyReport = runBenchmark({ runCount: 0 });
    expect(emptyReport.runs).toEqual([]);

    const relaxedFailure = jest.fn();
    const relaxed = runBenchmark({
      runCount: 1,
      build: () => ({
        wallTimeMs: 10,
        trace: {
          nextBuildMs: null,
          staticCheckMs: null,
          staticGenerationMs: null,
          slowestPages: [],
        },
      }),
      budget: {
        warnOnly: true,
        metrics: { medianWallTimeMs: { baselineMs: 1, maxRegressionMs: 0 } },
      },
      markFailed: relaxedFailure,
    });
    expect(relaxed.budget).not.toBeNull();
    expect(relaxedFailure).not.toHaveBeenCalled();

    const withoutBudget = runBenchmark({ runCount: 0, budget: null });
    expect(withoutBudget.budget).toBeNull();

    process.env.ALBUM_BENCHMARK_FAIL_ON_BUDGET = "1";
    const report = runBenchmark({
      runCount: 1,
      build: () => ({
        wallTimeMs: 10,
        trace: {
          nextBuildMs: null,
          staticCheckMs: null,
          staticGenerationMs: null,
          slowestPages: [],
        },
      }),
      budget: {
        warnOnly: true,
        metrics: { medianWallTimeMs: { baselineMs: 1, maxRegressionMs: 0 } },
      },
    });

    expect(report.runs).toHaveLength(1);
    expect(process.exitCode).toBe(1);
    expect(write).toHaveBeenCalled();
    process.exitCode = previousExitCode;
  });
});
