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

const repeat = Number.parseInt(process.env.ROUTE_BENCH_REPEAT ?? "20", 10);
const sizes = (process.env.ROUTE_BENCH_SIZES ?? "20,80,200,1000")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 1);
const outputPath = path.join(process.cwd(), ".map-route-benchmark.json");

type BenchmarkPhoto = Parameters<typeof buildMapRoute>[0][number];

const makePhotos = (size: number): BenchmarkPhoto[] =>
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

const measureMs = (fn: () => void): number => {
  const startedAt = performance.now();
  fn();
  return Number((performance.now() - startedAt).toFixed(3));
};

const median = (values: number[]): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return Number(
    (((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(3),
  );
};

const runs: BenchmarkRun[] = sizes.map((size) => {
  const photos = makePhotos(size);
  const samples: number[] = [];
  let geotaggedCount = 0;
  let simplifiedPointCount = 0;

  for (let index = 0; index < repeat; index += 1) {
    samples.push(
      measureMs(() => {
        const result = buildMapRoute(photos);
        geotaggedCount = result.geotaggedCount;
        simplifiedPointCount = result.simplifiedPoints.length;
      }),
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
  generatedAt: new Date().toISOString(),
  repeat,
  routeSimplifyThreshold: ROUTE_SIMPLIFY_THRESHOLD,
  runs,
};

writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nMap route benchmark written to ${outputPath}`);
