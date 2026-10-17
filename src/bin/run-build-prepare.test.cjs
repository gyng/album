const { BUILD_PREPARE_LANES, runLanes } = require("./run-build-prepare.cjs");

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("runLanes", () => {
  it("keeps each lane's order while the lanes overlap", async () => {
    const events = [];
    await runLanes(
      [
        ["a1", "a2"],
        ["b1", "b2"],
      ],
      async (step) => {
        events.push(`start ${step}`);
        await tick();
        events.push(`end ${step}`);
      },
    );
    expect(events.indexOf("end a1")).toBeLessThan(events.indexOf("start a2"));
    expect(events.indexOf("end b1")).toBeLessThan(events.indexOf("start b2"));
    // Both lanes were under way before either finished its first step.
    expect(events.indexOf("start b1")).toBeLessThan(events.indexOf("end a1"));
  });

  it("starts nothing new after a step fails, and rejects with that failure", async () => {
    const started = [];
    await expect(
      runLanes(
        [
          ["fails", "never-a"],
          ["slow", "never-b"],
        ],
        async (step) => {
          started.push(step);
          await tick();
          if (step === "fails") throw new Error("typecheck failed");
          await tick();
        },
      ),
    ).rejects.toThrow("typecheck failed");
    expect(started).toEqual(["fails", "slow"]);
  });
});

describe("BUILD_PREPARE_LANES", () => {
  const steps = BUILD_PREPARE_LANES.flat();
  const laneOf = (step) => BUILD_PREPARE_LANES.findIndex((lane) => lane.includes(step));
  const before = (first, second) => {
    const lane = BUILD_PREPARE_LANES[laneOf(first)];
    return laneOf(first) === laneOf(second) && lane.indexOf(first) < lane.indexOf(second);
  };

  it("runs every step the serial chain ran, once", () => {
    expect([...steps].sort()).toEqual(
      [
        "prepare:build-manifest",
        "typecheck",
        "prepare:images",
        "prepare:posters",
        "prepare:embedding-atlas",
        "prepare:search-framing",
        "prepare:feeds",
        "prepare:map-styles",
        "prepare:pwa-icons",
        "prepare:vendor-maplibre",
      ].sort(),
    );
  });

  it("orders the steps that read each other's output", () => {
    // The atlas packs the 800px variants of photographs and video posters alike.
    expect(before("prepare:images", "prepare:posters")).toBe(true);
    expect(before("prepare:posters", "prepare:embedding-atlas")).toBe(true);
    // Map styles read the search database that search framing writes.
    expect(before("prepare:search-framing", "prepare:map-styles")).toBe(true);
    // The typecheck imports lib/buildVersion.ts, which the build manifest step
    // generates. A fresh checkout has no copy, so a typecheck that won the race
    // failed CI on "Cannot find module '../lib/buildVersion'".
    expect(before("prepare:build-manifest", "typecheck")).toBe(true);
  });
});
