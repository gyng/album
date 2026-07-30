/** @jest-environment node */

const indexCommand = require("./index.cjs");

const context = {
  srcDir: "/src",
  indexDir: "/repo/index",
  lastIndexStatsPath: "/repo/index/.last-index-stats.json",
};

const makeHarness = ({ probes = [], stats = null } = {}) => {
  const services = {
    env: {},
    runShellCommand: jest.fn(async () => {}),
    readJsonFile: jest.fn(() => stats),
    buildIndexProbes: jest.fn(() => probes),
  };

  return { services, log: jest.fn(), error: jest.fn(), setExitCode: jest.fn() };
};

const run = async (args, harness) =>
  indexCommand.run({
    args: { check: false, force: false, rest: [], ...args },
    context,
    services: harness.services,
    log: harness.log,
    error: harness.error,
    setExitCode: harness.setExitCode,
  });

const readyProbes = [{ label: "uv", level: "ok", value: "found", hint: null }];
const blockedProbes = [{ label: "uv", level: "block", value: "missing", hint: "Install uv" }];

describe("album index", () => {
  it("reports status from the stats file without touching the toolchain", async () => {
    const harness = makeHarness({ stats: { modelProfile: "hybrid", workItemCount: 7 } });
    await run({ mode: "status" }, harness);

    expect(harness.services.readJsonFile).toHaveBeenCalledWith(context.lastIndexStatsPath);
    expect(harness.services.buildIndexProbes).not.toHaveBeenCalled();
    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
    expect(harness.log.mock.calls.flat().join("\n")).toContain("hybrid");
  });

  it("prints the probes and stops when asked only to check", async () => {
    const harness = makeHarness({ probes: readyProbes });
    await run({ mode: "full", check: true }, harness);

    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("refuses to start a long run when the toolchain is blocked", async () => {
    const harness = makeHarness({ probes: blockedProbes });
    await run({ mode: "full" }, harness);

    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.error.mock.calls.flat().join("\n")).toContain("not ready");
  });

  it("runs anyway when the blocker is overridden", async () => {
    const harness = makeHarness({ probes: blockedProbes });
    await run({ mode: "full", force: true }, harness);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npm run index:update",
      cwd: "/src",
    });
  });

  it.each([
    ["full", "npm run index:update"],
    ["embeddings", "npm run index:embeddings:update"],
    ["retag", "npm run index:retag"],
  ])("delegates %s to the shell script that owns the lockfile", async (mode, command) => {
    const harness = makeHarness({ probes: readyProbes });
    await run({ mode }, harness);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({ command, cwd: "/src" });
  });

  it.each([["validate"], ["prune"], ["publish"]])(
    "passes %s straight through to the Python CLI",
    async (mode) => {
      const harness = makeHarness({ probes: readyProbes });
      await run({ mode }, harness);

      expect(harness.services.runShellCommand).toHaveBeenCalledWith({
        command: `uv run python index.py ${mode}`,
        cwd: context.indexDir,
      });
    },
  );

  it("forwards trailing arguments to the Python CLI", async () => {
    const harness = makeHarness({ probes: readyProbes });
    await run({ mode: "validate", rest: ["--glob", "x/*.jpg"] }, harness);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "uv run python index.py validate --glob x/*.jpg",
      cwd: context.indexDir,
    });
  });

  it("forwards trailing arguments through the npm script boundary", async () => {
    const harness = makeHarness({ probes: readyProbes });
    await run({ mode: "retag", rest: ["--match", "kanto"] }, harness);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npm run index:retag -- --match kanto",
      cwd: "/src",
    });
  });
});
