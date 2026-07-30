/** @jest-environment node */

const deploy = require("./deploy.cjs");

const context = {
  srcDir: "/src",
  repoDir: "/repo",
  albumsDir: "/repo/albums",
  indexDir: "/repo/index",
  dbPath: "/src/public/search.sqlite",
  embeddingsDbPath: "/src/public/search-embeddings.sqlite",
  lastIndexStatsPath: "/repo/index/.last-index-stats.json",
};

const makeReport = (blockers = []) => ({ albums: [{ name: "kanto", blockers }] });

const target = {
  name: "vercel",
  preflightCommand: () => "vercel whoami",
  planSteps: () => [
    { label: "build", command: "vercel build --prod", cwd: "/src" },
    { label: "deploy", command: "vercel deploy --prebuilt --prod", cwd: "/src" },
  ],
};

const makeHarness = ({ report = makeReport(), targets = [target] } = {}) => ({
  services: {
    targets,
    createPreflightReport: jest.fn(async () => report),
    printPreflightReport: jest.fn(),
    runShellCommand: jest.fn(async () => {}),
  },
  log: jest.fn(),
  error: jest.fn(),
  setExitCode: jest.fn(),
});

const run = async (args, harness) =>
  deploy.run({
    args: {
      target: "vercel",
      dryRun: false,
      skipPreflight: false,
      skipPull: false,
      skipBuild: false,
      archive: false,
      force: false,
      ...args,
    },
    context,
    services: harness.services,
    log: harness.log,
    error: harness.error,
    setExitCode: harness.setExitCode,
  });

const commands = (harness) =>
  harness.services.runShellCommand.mock.calls.map((call) => call[0].command);

describe("album deploy", () => {
  it("preflights, then runs the credential check and every planned step in order", async () => {
    const harness = makeHarness();
    await run({}, harness);

    expect(harness.services.createPreflightReport).toHaveBeenCalledWith(
      expect.objectContaining({ albumsDir: "/repo/albums", repoDir: "/repo" }),
    );
    expect(commands(harness)).toEqual([
      "vercel whoami",
      "vercel build --prod",
      "vercel deploy --prebuilt --prod",
    ]);
    expect(harness.log.mock.calls.flat().join("\n")).toContain("Deploy complete (vercel).");
  });

  it("refuses to deploy when preflight reports a blocker", async () => {
    const harness = makeHarness({ report: makeReport(["missing EXIF"]) });
    await run({}, harness);

    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });

  it("deploys past a blocker when forced", async () => {
    const harness = makeHarness({ report: makeReport(["missing EXIF"]) });
    await run({ force: true }, harness);

    expect(harness.services.runShellCommand).toHaveBeenCalled();
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("skips the preflight entirely on request", async () => {
    const harness = makeHarness();
    await run({ skipPreflight: true }, harness);

    expect(harness.services.createPreflightReport).not.toHaveBeenCalled();
    expect(harness.services.runShellCommand).toHaveBeenCalled();
  });

  it("prints the plan and runs nothing for a dry run", async () => {
    const harness = makeHarness();
    await run({ dryRun: true }, harness);

    const printed = harness.log.mock.calls.flat().join("\n");
    expect(printed).toContain("Deploy plan (vercel):");
    expect(printed).toContain("build: vercel build --prod");
    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
  });

  it("reports an unknown target and exits non-zero", async () => {
    const harness = makeHarness();
    await run({ target: "s3" }, harness);

    expect(harness.error.mock.calls.flat().join("\n")).toContain("Unknown deploy target: s3");
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.services.createPreflightReport).not.toHaveBeenCalled();
  });

  it("skips the credential check when the target declares none", async () => {
    const harness = makeHarness({
      targets: [{ ...target, preflightCommand: () => null }],
    });
    await run({ skipPreflight: true }, harness);

    expect(commands(harness)).toEqual(["vercel build --prod", "vercel deploy --prebuilt --prod"]);
  });
});
