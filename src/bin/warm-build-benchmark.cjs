const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectDir = path.resolve(__dirname, "..");
const runs = Number.parseInt(process.env.ALBUM_WARM_BUILD_RUNS ?? "3", 10);
const benchmarkOutputPath = path.join(projectDir, ".warm-build-benchmark.json");
const benchmarkProfilesRoot = path.join(projectDir, ".album-build-profiles");
const budgetPath = path.join(projectDir, "warm-build-budget.json");

const removeNextDir = () => {
  fs.rmSync(path.join(projectDir, ".next"), { recursive: true, force: true });
};

const parseTraceEntries = (tracePath) => {
  if (!fs.existsSync(tracePath)) {
    return [];
  }

  const content = fs.readFileSync(tracePath, "utf8").trim();
  if (!content) {
    return [];
  }

  return content
    .split(/\n+/)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    });
};

const findLastDurationMs = (entries, name) => {
  const matches = entries.filter((entry) => entry.name === name);
  const last = matches.at(-1);
  return last ? last.duration / 1000 : null;
};

const median = (values) => {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) {
    return null;
  }

  const middle = Math.floor(usable.length / 2);
  if (usable.length % 2 === 1) {
    return usable[middle];
  }

  return (usable[middle - 1] + usable[middle]) / 2;
};

const readBudget = () => {
  if (!fs.existsSync(budgetPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(budgetPath, "utf8"));
};

const formatMs = (value) => `${Number(value).toFixed(2)}ms`;

const evaluateBudget = (summary, budget) => {
  if (!budget?.metrics) {
    return [];
  }

  return Object.entries(budget.metrics).flatMap(([name, rule]) => {
    const actualMs = summary[name];

    if (!Number.isFinite(actualMs) || !Number.isFinite(rule?.baselineMs)) {
      return [];
    }

    const regressionMs = actualMs - rule.baselineMs;
    if (regressionMs <= 0) {
      return [];
    }

    const regressionPercent = (regressionMs / rule.baselineMs) * 100;
    const absoluteExceeded =
      Number.isFinite(rule.maxRegressionMs) &&
      regressionMs > rule.maxRegressionMs;
    const percentExceeded =
      Number.isFinite(rule.maxRegressionPercent) &&
      regressionPercent > rule.maxRegressionPercent;

    if (!absoluteExceeded && !percentExceeded) {
      return [];
    }

    return [
      {
        metric: name,
        actualMs: Number(actualMs.toFixed(2)),
        baselineMs: Number(rule.baselineMs.toFixed(2)),
        regressionMs: Number(regressionMs.toFixed(2)),
        regressionPercent: Number(regressionPercent.toFixed(1)),
        allowedRegressionMs: rule.maxRegressionMs ?? null,
        allowedRegressionPercent: rule.maxRegressionPercent ?? null,
      },
    ];
  });
};

const summarizeMetrics = (metrics = {}) => {
  return Object.fromEntries(
    Object.entries(metrics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, metric]) => [
        name,
        {
          count: metric.count,
          totalMs: Number(metric.totalMs.toFixed(2)),
          maxMs: Number(metric.maxMs.toFixed(2)),
          averageMs:
            metric.count > 0
              ? Number((metric.totalMs / metric.count).toFixed(2))
              : 0,
        },
      ]),
  );
};

const aggregateProfiles = (profiles) => {
  if (profiles.length === 0) {
    return null;
  }

  const aggregate = {
    startedAt: profiles
      .map((profile) => profile.startedAt)
      .filter(Boolean)
      .sort()[0],
    finishedAt: profiles
      .map((profile) => profile.finishedAt)
      .filter(Boolean)
      .sort()
      .at(-1),
    durationMs: Math.max(
      ...profiles.map((profile) => Number(profile.durationMs) || 0),
    ),
    processCount: profiles.length,
    counters: {},
    metrics: {},
  };

  for (const profile of profiles) {
    for (const [name, value] of Object.entries(profile.counters ?? {})) {
      aggregate.counters[name] = (aggregate.counters[name] ?? 0) + value;
    }

    for (const [name, metric] of Object.entries(profile.metrics ?? {})) {
      const existing = aggregate.metrics[name] ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };

      existing.count += metric.count ?? 0;
      existing.totalMs += metric.totalMs ?? 0;
      existing.maxMs = Math.max(existing.maxMs, metric.maxMs ?? 0);
      aggregate.metrics[name] = existing;
    }
  }

  aggregate.metrics = summarizeMetrics(aggregate.metrics);

  return aggregate;
};

const runBuild = (index) => {
  const profileDir = path.join(
    benchmarkProfilesRoot,
    `album-build-profiles-run-${index}`,
  );

  removeNextDir();
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const startedAt = process.hrtime.bigint();
  const result = spawnSync("npm", ["run", "build"], {
    cwd: projectDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ALBUM_BUILD_PROFILE: "1",
      ALBUM_BUILD_PROFILE_OUTPUT_DIR: profileDir,
    },
  });
  const wallTimeMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  if (result.status !== 0) {
    throw new Error(`Warm build run ${index} failed with exit code ${result.status}`);
  }

  const traceEntries = parseTraceEntries(path.join(projectDir, ".next", "trace"));
  const pageChecks = traceEntries
    .filter((entry) => entry.name === "check-page" && entry.tags?.page)
    .map((entry) => ({
      page: entry.tags.page,
      durationMs: Number((entry.duration / 1000).toFixed(2)),
    }))
    .sort((left, right) => right.durationMs - left.durationMs);

  const profiles = fs.existsSync(profileDir)
    ? fs
        .readdirSync(profileDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => {
          return JSON.parse(fs.readFileSync(path.join(profileDir, file), "utf8"));
        })
    : [];
  const profile = aggregateProfiles(profiles);

  return {
    run: index,
    wallTimeMs: Number(wallTimeMs.toFixed(2)),
    trace: {
      nextBuildMs: findLastDurationMs(traceEntries, "next-build"),
      staticCheckMs: findLastDurationMs(traceEntries, "static-check"),
      staticGenerationMs: findLastDurationMs(traceEntries, "static-generation"),
      runTypescriptMs: findLastDurationMs(traceEntries, "run-typescript"),
      runTurbopackMs: findLastDurationMs(traceEntries, "run-turbopack"),
      slowestPages: pageChecks.slice(0, 10),
    },
    profile: profile
      ? {
          startedAt: profile.startedAt,
          finishedAt: profile.finishedAt,
          durationMs: profile.durationMs,
          processCount: profile.processCount,
          counters: profile.counters,
          metrics: profile.metrics,
        }
      : null,
  };
};

const benchmark = {
  generatedAt: new Date().toISOString(),
  runs: [],
};

for (let index = 1; index <= runs; index += 1) {
  console.log(`\n=== Warm build benchmark run ${index}/${runs} ===`);
  benchmark.runs.push(runBuild(index));
}

benchmark.summary = {
  medianWallTimeMs: median(benchmark.runs.map((run) => run.wallTimeMs)),
  medianNextBuildMs: median(
    benchmark.runs.map((run) => run.trace.nextBuildMs).filter(Boolean),
  ),
  medianStaticCheckMs: median(
    benchmark.runs.map((run) => run.trace.staticCheckMs).filter(Boolean),
  ),
  medianStaticGenerationMs: median(
    benchmark.runs.map((run) => run.trace.staticGenerationMs).filter(Boolean),
  ),
};

const budget = readBudget();
const budgetWarnings = evaluateBudget(benchmark.summary, budget);

benchmark.budget = budget
  ? {
      path: path.relative(projectDir, budgetPath),
      warnOnly: budget.warnOnly !== false,
      warnings: budgetWarnings,
    }
  : null;

fs.writeFileSync(benchmarkOutputPath, JSON.stringify(benchmark, null, 2));

console.log("\nWarm build benchmark written to", benchmarkOutputPath);
console.log(
  JSON.stringify(
    {
      medianWallTimeMs: benchmark.summary.medianWallTimeMs,
      medianNextBuildMs: benchmark.summary.medianNextBuildMs,
      medianStaticCheckMs: benchmark.summary.medianStaticCheckMs,
      medianStaticGenerationMs: benchmark.summary.medianStaticGenerationMs,
      budgetWarnings,
      slowestPagesLastRun: benchmark.runs.at(-1)?.trace.slowestPages ?? [],
    },
    null,
    2,
  ),
);

if (budgetWarnings.length > 0) {
  console.warn("\nWarm build performance budget warnings:");
  for (const warning of budgetWarnings) {
    console.warn(
      `- ${warning.metric}: actual ${formatMs(warning.actualMs)} vs baseline ${formatMs(warning.baselineMs)} (+${formatMs(warning.regressionMs)}, +${warning.regressionPercent}%)`,
    );
  }

  if (
    budget?.warnOnly === false ||
    process.env.ALBUM_BENCHMARK_FAIL_ON_BUDGET === "1"
  ) {
    process.exitCode = 1;
  }
}