/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getBenchmarkConfig,
  makePhotos,
  measureMs,
  median,
  runBenchmark,
} from "./map-route-benchmark";

describe("map route benchmark", () => {
  it("parses default and custom benchmark configuration", () => {
    expect(getBenchmarkConfig({} as NodeJS.ProcessEnv, "/tmp/gallery")).toEqual({
      repeat: 20,
      sizes: [20, 80, 200, 1000],
      outputPath: path.join("/tmp/gallery", ".map-route-benchmark.json"),
    });
    expect(
      getBenchmarkConfig(
        {
          ROUTE_BENCH_REPEAT: "3",
          ROUTE_BENCH_SIZES: "1, 2, nope, 5",
        } as unknown as NodeJS.ProcessEnv,
        "/tmp/gallery",
      ),
    ).toMatchObject({ repeat: 3, sizes: [2, 5] });
    expect(getBenchmarkConfig()).toMatchObject({ outputPath: expect.stringContaining(".json") });
  });

  it("creates deterministic geotagged benchmark photos", () => {
    const photos = makePhotos(6);

    expect(photos).toHaveLength(6);
    expect(photos[0]).toMatchObject({ album: "benchmark-trip", decLat: 35.00004 });
    expect(photos[1]).toMatchObject({ decLat: 35.0008 });
    expect(photos[5]?.decLat).toBeCloseTo(35.00404);
  });

  it("measures elapsed milliseconds and calculates odd, even, and empty medians", () => {
    const values = [10, 11.23456];
    expect(measureMs(jest.fn(), () => values.shift()!)).toBe(1.235);
    expect(measureMs(() => undefined)).toBeGreaterThanOrEqual(0);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([10, 2, 8, 4])).toBe(6);
    expect(median([])).toBe(0);
  });

  it("runs with injected timing, routing, output, and logging adapters", () => {
    const clockValues = [0, 2, 2, 8];
    const buildRoute = jest.fn(() => ({ geotaggedCount: 3, simplifiedPoints: [{}, {}] }));
    const write = jest.fn();
    const log = jest.fn();

    const report = runBenchmark({
      repeat: 2,
      sizes: [3],
      outputPath: "/tmp/report.json",
      clock: () => clockValues.shift()!,
      now: () => new Date("2026-01-02T03:04:05Z"),
      buildRoute: buildRoute as never,
      write: write as never,
      log,
    });

    expect(report).toEqual({
      generatedAt: "2026-01-02T03:04:05.000Z",
      repeat: 2,
      routeSimplifyThreshold: expect.any(Number),
      runs: [{ size: 3, routeBuildMs: 4, geotaggedCount: 3, simplifiedPointCount: 2 }],
    });
    expect(buildRoute).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith("/tmp/report.json", expect.stringContaining('"size": 3'));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("uses the production adapters by default", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-route-benchmark-"));
    const outputPath = path.join(directory, "report.json");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const report = runBenchmark({ repeat: 1, sizes: [2], outputPath });

    expect(report.runs).toHaveLength(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
