const { writeFileSync } = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { buildMapRoute, ROUTE_SIMPLIFY_THRESHOLD } =
  require("../components/mapRoute.ts") as typeof import("../components/mapRoute");

type BenchmarkRun = {
  size: number;
  routeBuildMs: number;
  geotaggedCount: number;
  simplifiedPointCount: number;
};

export const getBenchmarkConfig = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) => ({
  repeat: Number.parseInt(env.ROUTE_BENCH_REPEAT ?? "20", 10),
  sizes: (env.ROUTE_BENCH_SIZES ?? "20,80,200,1000")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 1),
  outputPath: path.join(cwd, ".map-route-benchmark.json"),
});

type BenchmarkPhoto = Parameters<typeof buildMapRoute>[0][number];

export const makePhotos = (size: number): BenchmarkPhoto[] =>
  Array.from({ length: size }, (_, index) => ({
    album: "benchmark-trip",
    src: {
      src: `/benchmark/${index}.jpg`,
      width: 100,
      height: 100,
    },
    decLat: 35 + index * 0.0008 + (index % 5 === 0 ? 0.00004 : 0),
    decLng: 139 + index * 0.0008 + (index % 5 === 0 ? 0.00004 : 0),
    date: new Date(1_704_067_200_000 + index * 60_000).toISOString(),
    href: `/album/benchmark-trip#${index}.jpg`,
    placeholderColor: "transparent",
    placeholderWidth: 100,
    placeholderHeight: 100,
  }));

export const measureMs = (fn: () => void, clock = () => performance.now()): number => {
  const startedAt = clock();
  fn();
  return Number((clock() - startedAt).toFixed(3));
};

export const median = (values: number[]): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }

  return Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(3));
};

export const runBenchmark = ({
  repeat,
  sizes,
  outputPath,
  clock = () => performance.now(),
  now = () => new Date(),
  buildRoute = buildMapRoute,
  write = writeFileSync,
  log = console.log,
}: {
  repeat: number;
  sizes: number[];
  outputPath: string;
  clock?: () => number;
  now?: () => Date;
  buildRoute?: typeof buildMapRoute;
  write?: typeof writeFileSync;
  log?: typeof console.log;
}) => {
  const runs: BenchmarkRun[] = sizes.map((size) => {
    const photos = makePhotos(size);
    const samples: number[] = [];
    let geotaggedCount = 0;
    let simplifiedPointCount = 0;

    for (let index = 0; index < repeat; index += 1) {
      samples.push(
        measureMs(() => {
          const result = buildRoute(photos);
          geotaggedCount = result.geotaggedCount;
          simplifiedPointCount = result.simplifiedPoints.length;
        }, clock),
      );
    }

    return {
      size,
      routeBuildMs: median(samples),
      geotaggedCount,
      simplifiedPointCount,
    };
  });

  const report = {
    generatedAt: now().toISOString(),
    repeat,
    routeSimplifyThreshold: ROUTE_SIMPLIFY_THRESHOLD,
    runs,
  };

  write(outputPath, JSON.stringify(report, null, 2));
  log(JSON.stringify(report, null, 2));
  log(`\nMap route benchmark written to ${outputPath}`);
  return report;
};

/* istanbul ignore next -- direct CLI dispatch; runBenchmark is tested independently */
if (require.main === module) {
  runBenchmark(getBenchmarkConfig());
}
